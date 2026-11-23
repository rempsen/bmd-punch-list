-- Sync foundation. BMD Projects is the source of truth; QuickBooks, ArrivePing and CompanyCam are kept in step with it.
-- sync_links: which outside record each BMD record is, and the values both sides last agreed on.
-- sync_outbox: every change made in BMD that the other systems need, queued until it is sent.
-- sync_log: everything pulled, pushed, or overruled, for review.
CREATE TABLE IF NOT EXISTS public.sync_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('material','labour','supplier','client','cost_code','project')),
  bmd_id text NOT NULL,
  system text NOT NULL CHECK (system IN ('quickbooks','arriveping','companycam')),
  external_id text NOT NULL,
  external_name text,
  last_synced jsonb NOT NULL DEFAULT '{}',
  linked_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz,
  UNIQUE (kind, bmd_id, system),
  UNIQUE (kind, system, external_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  bmd_id text NOT NULL,
  label text,
  op text NOT NULL CHECK (op IN ('create','update','delete')),
  changes jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','sent','failed','cancelled')),
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sync_outbox_status_idx ON public.sync_outbox (status, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sync_outbox_one_waiting ON public.sync_outbox (kind, bmd_id) WHERE status = 'waiting';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  system text NOT NULL,
  kind text NOT NULL,
  bmd_id text,
  external_id text,
  label text,
  outcome text NOT NULL CHECK (outcome IN ('applied','sent','bmd_kept','failed','skipped')),
  detail jsonb NOT NULL DEFAULT '{}',
  reviewed_by uuid,
  reviewed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sync_log_at_idx ON public.sync_log (at DESC);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sync_links','sync_outbox','sync_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_capability(''manage_integrations'') OR public.has_capability(''manage_catalogue''))', t || ' read', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Queues a change for the other systems. The columns to watch are the trigger's arguments; the first is the kind.
-- Several edits to one record before it is sent become one queued change, from the first old value to the latest new one.
CREATE OR REPLACE FUNCTION public.sync_queue_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text := TG_ARGV[0]; o jsonb; n jsonb; diff jsonb := '{}'; col text; i int; rid text; lbl text; operation text; prior jsonb;
BEGIN
  IF current_setting('bmd.sync_inbound', true) = 'on' THEN RETURN coalesce(NEW, OLD); END IF;   -- a change that came from outside is not sent back out
  o := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  n := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    col := TG_ARGV[i];
    IF (o->col) IS DISTINCT FROM (n->col) THEN diff := diff || jsonb_build_object(col, jsonb_build_object('from', o->col, 'to', n->col)); END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND diff = '{}'::jsonb THEN RETURN NEW; END IF;
  rid := coalesce(n->>'id', o->>'id');
  lbl := coalesce(n->>'name', o->>'name');
  operation := CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'DELETE' THEN 'delete' ELSE 'update' END;
  SELECT changes INTO prior FROM public.sync_outbox WHERE kind = k AND bmd_id = rid AND status = 'waiting';
  IF FOUND THEN
    -- keep each field's first "from", take the latest "to"
    SELECT coalesce(jsonb_object_agg(key, jsonb_build_object('from', coalesce(prior->key->'from', value->'from'), 'to', value->'to')), '{}'::jsonb) INTO diff FROM jsonb_each(diff);
    UPDATE public.sync_outbox SET changes = prior || diff, label = lbl, updated_at = now(),
      op = CASE WHEN operation = 'delete' THEN 'delete' WHEN op = 'create' THEN 'create' ELSE operation END
    WHERE kind = k AND bmd_id = rid AND status = 'waiting';
  ELSE
    INSERT INTO public.sync_outbox (kind, bmd_id, label, op, changes, created_by) VALUES (k, rid, lbl, operation, diff, auth.uid());
  END IF;
  RETURN coalesce(NEW, OLD);
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS sync_queue_materials ON public.catalogue_materials;
--> statement-breakpoint
CREATE TRIGGER sync_queue_materials AFTER INSERT OR UPDATE OR DELETE ON public.catalogue_materials
FOR EACH ROW EXECUTE FUNCTION public.sync_queue_change('material', 'name', 'sku', 'unit_cost_cents', 'cost_uom', 'supplier_id', 'cost_code', 'active');
--> statement-breakpoint
DROP TRIGGER IF EXISTS sync_queue_labour ON public.labour_rates;
--> statement-breakpoint
CREATE TRIGGER sync_queue_labour AFTER INSERT OR UPDATE OR DELETE ON public.labour_rates
FOR EACH ROW EXECUTE FUNCTION public.sync_queue_change('labour', 'name', 'unit_cost_cents', 'uom', 'cost_code', 'active');
--> statement-breakpoint
DROP TRIGGER IF EXISTS sync_queue_suppliers ON public.suppliers;
--> statement-breakpoint
CREATE TRIGGER sync_queue_suppliers AFTER INSERT OR UPDATE OR DELETE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.sync_queue_change('supplier', 'name', 'contact_name', 'email', 'phone', 'account_number', 'active');
--> statement-breakpoint
-- Marks a "BMD kept its value" entry as looked at.
CREATE OR REPLACE FUNCTION public.sync_mark_reviewed(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('manage_integrations') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.sync_log SET reviewed_by = auth.uid(), reviewed_at = now() WHERE id = _id;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sync_mark_reviewed(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.sync_mark_reviewed(uuid) TO authenticated;
