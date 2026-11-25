-- Subcontractor purchase orders: the labour a work order covers (its lines) becomes a purchase order to the
-- subcontractor, sent to QuickBooks; the bill QuickBooks raises against it, and its payment, are read back.
-- install_visit_lines is created by the work-order-lines change too (same columns); whichever lands first wins.
-- Every policy here is scoped to the row's job (has_capability(cap, project)) and recreated idempotently.

CREATE TABLE IF NOT EXISTS public.install_visit_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.install_visits(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  estimate_line_id uuid REFERENCES public.estimate_lines(id) ON DELETE SET NULL,
  finish_id uuid REFERENCES public.project_finishes(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  uom text NOT NULL DEFAULT 'SF',
  cost_code text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS install_visit_lines_visit_idx ON public.install_visit_lines (visit_id, sort_order);
--> statement-breakpoint
ALTER TABLE public.install_visit_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "visit lines read" ON public.install_visit_lines;
--> statement-breakpoint
-- Same text as migration 0089 (which also creates this table), so the policy is the same whichever runs last.
CREATE POLICY "visit lines read" ON public.install_visit_lines FOR SELECT TO authenticated
  USING (public.can_project_documents(project_id, false) OR public.has_capability('view_pipeline', project_id));
--> statement-breakpoint
DROP POLICY IF EXISTS "visit lines write" ON public.install_visit_lines;
--> statement-breakpoint
CREATE POLICY "visit lines write" ON public.install_visit_lines FOR ALL TO authenticated
  USING (public.has_capability('manage_projects', project_id)) WITH CHECK (public.has_capability('manage_projects', project_id));
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.subcontract_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  visit_id uuid REFERENCES public.install_visits(id) ON DELETE SET NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  po_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','billed','paid','cancelled')),
  subtotal_cents bigint NOT NULL DEFAULT 0,
  notes text,
  qbo_po_id text,
  qbo_po_sent_at timestamptz,
  qbo_bill_id text,
  qbo_bill_total_cents bigint,
  billed_at timestamptz,
  paid_at timestamptz,
  -- Set while a send to QuickBooks is in flight (the claim that stops a double send); cleared when it ends.
  sending_since timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS sending_since timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subcontract_orders_project_idx ON public.subcontract_orders (project_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS subcontract_orders_po_number_key ON public.subcontract_orders (po_number);
--> statement-breakpoint
-- One live purchase order per work order; a cancelled one may be replaced.
CREATE UNIQUE INDEX IF NOT EXISTS subcontract_orders_one_open_per_visit ON public.subcontract_orders (visit_id) WHERE status <> 'cancelled';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.subcontract_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.subcontract_orders(id) ON DELETE CASCADE,
  visit_line_id uuid REFERENCES public.install_visit_lines(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  uom text NOT NULL DEFAULT 'SF',
  unit_cost_cents bigint CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  cost_code text,
  sort_order int NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subcontract_order_lines_order_idx ON public.subcontract_order_lines (order_id, sort_order);
--> statement-breakpoint
ALTER TABLE public.subcontract_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.subcontract_order_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "subcontract orders read" ON public.subcontract_orders;
--> statement-breakpoint
CREATE POLICY "subcontract orders read" ON public.subcontract_orders FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline', project_id));
--> statement-breakpoint
DROP POLICY IF EXISTS "subcontract orders write" ON public.subcontract_orders;
--> statement-breakpoint
CREATE POLICY "subcontract orders write" ON public.subcontract_orders FOR ALL TO authenticated
  USING (public.has_capability('manage_projects', project_id)) WITH CHECK (public.has_capability('manage_projects', project_id));
--> statement-breakpoint
-- Lines carry unit costs: pricing staff only, like estimate costs. Everyone else sees the order's status on the work order.
DROP POLICY IF EXISTS "subcontract order lines read" ON public.subcontract_order_lines;
--> statement-breakpoint
CREATE POLICY "subcontract order lines read" ON public.subcontract_order_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.subcontract_orders o WHERE o.id = order_id AND public.has_capability('view_pricing', o.project_id)));
--> statement-breakpoint
DROP POLICY IF EXISTS "subcontract order lines write" ON public.subcontract_order_lines;
--> statement-breakpoint
CREATE POLICY "subcontract order lines write" ON public.subcontract_order_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.subcontract_orders o WHERE o.id = order_id AND public.has_capability('manage_projects', o.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.subcontract_orders o WHERE o.id = order_id AND public.has_capability('manage_projects', o.project_id)));
--> statement-breakpoint
-- The money columns are not readable through the API at all (same pattern as deficiencies in 0003): a table-level
-- grant would override a column revoke, so the grant is rebuilt without them. Pricing staff read them via the RPC below.
REVOKE SELECT ON public.subcontract_orders FROM authenticated;
--> statement-breakpoint
GRANT SELECT (id, project_id, visit_id, supplier_id, po_number, status, notes, qbo_po_id, qbo_po_sent_at, qbo_bill_id,
  billed_at, paid_at, sending_since, created_by, created_at, updated_at) ON public.subcontract_orders TO authenticated;
--> statement-breakpoint
-- A job's order totals, for people who may see costs on that job. Empty for anyone else.
CREATE OR REPLACE FUNCTION public.subcontract_order_totals(_project uuid)
RETURNS TABLE (order_id uuid, subtotal_cents bigint, qbo_bill_total_cents bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.subtotal_cents, o.qbo_bill_total_cents
    FROM public.subcontract_orders o
   WHERE o.project_id = _project AND public.has_capability('view_pricing', _project);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.subcontract_order_totals(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.subcontract_order_totals(uuid) TO authenticated;
--> statement-breakpoint
-- Replaces a draft's lines and notes in one transaction and returns the new subtotal (sum of round(rate × qty) over
-- costed lines, the same rule as orderTotal in src/lib/subcontract/logic.ts). Lines without a rate add nothing.
CREATE OR REPLACE FUNCTION public.subcontract_replace_lines(_order uuid, _lines jsonb, _notes text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.subcontract_orders%ROWTYPE; total bigint;
BEGIN
  SELECT * INTO o FROM public.subcontract_orders WHERE id = _order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That purchase order could not be found.'; END IF;
  IF NOT public.has_capability('manage_projects', o.project_id) THEN RAISE EXCEPTION 'You don''t have permission to edit purchase orders.'; END IF;
  IF o.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft can be changed; this one has been sent.'; END IF;
  IF jsonb_typeof(_lines) <> 'array' THEN RAISE EXCEPTION 'Lines must be a list.'; END IF;
  DELETE FROM public.subcontract_order_lines WHERE order_id = _order;
  INSERT INTO public.subcontract_order_lines (order_id, visit_line_id, description, quantity, uom, unit_cost_cents, cost_code, sort_order)
  SELECT _order, l.visit_line_id, coalesce(l.description, ''), coalesce(l.quantity, 0), coalesce(nullif(l.uom, ''), 'EA'), l.unit_cost_cents, nullif(l.cost_code, ''), coalesce(l.sort_order, ord::int - 1)
    FROM jsonb_array_elements(_lines) WITH ORDINALITY AS e(line, ord)
    CROSS JOIN LATERAL jsonb_to_record(e.line) AS l(visit_line_id uuid, description text, quantity numeric, uom text, unit_cost_cents bigint, cost_code text, sort_order int);
  SELECT coalesce(sum(round(unit_cost_cents * quantity)), 0)::bigint INTO total
    FROM public.subcontract_order_lines WHERE order_id = _order AND unit_cost_cents IS NOT NULL;
  UPDATE public.subcontract_orders SET subtotal_cents = total, notes = _notes WHERE id = _order;
  RETURN total;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.subcontract_replace_lines(uuid, jsonb, text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.subcontract_replace_lines(uuid, jsonb, text) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.subcontract_orders_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS subcontract_orders_touch ON public.subcontract_orders;
--> statement-breakpoint
CREATE TRIGGER subcontract_orders_touch BEFORE UPDATE ON public.subcontract_orders FOR EACH ROW EXECUTE FUNCTION public.subcontract_orders_touch();
