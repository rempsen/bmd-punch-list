-- First load from another system into BMD's catalogue. The plan is worked out in the app and shown as a dry run;
-- this applies it in one step. Imported materials and labour arrive with their unit still to confirm, because
-- QuickBooks has no unit of measure.
ALTER TABLE public.catalogue_materials ADD COLUMN IF NOT EXISTS uom_confirmed boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE public.labour_rates ADD COLUMN IF NOT EXISTS uom_confirmed boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sync_import_apply(_system text, _actions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a jsonb; f jsonb; k text; op text; ext text; nm text; bid text; sup uuid; created int := 0; linked int := 0; skipped int := 0; today date := current_date;
BEGIN
  IF NOT (public.has_capability('manage_integrations') OR public.has_capability('manage_catalogue')) THEN RAISE EXCEPTION 'Not allowed to import into the catalogue'; END IF;
  IF _system NOT IN ('quickbooks','arriveping','companycam') THEN RAISE EXCEPTION 'Unknown system'; END IF;
  IF jsonb_typeof(_actions) <> 'array' OR jsonb_array_length(_actions) > 20000 THEN RAISE EXCEPTION 'Invalid import'; END IF;
  -- What arrives from outside is not queued to be sent back out.
  PERFORM set_config('bmd.sync_inbound', 'on', true);

  FOR a IN SELECT * FROM jsonb_array_elements(_actions) LOOP
    op := a->>'op'; k := a->>'kind'; ext := btrim(coalesce(a->>'external_id', '')); nm := left(btrim(coalesce(a->>'name', '')), 300); f := coalesce(a->'fields', '{}'::jsonb); bid := a->>'bmd_id';
    IF op NOT IN ('create','link') OR k NOT IN ('supplier','material','labour','cost_code') OR ext = '' THEN skipped := skipped + 1; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.sync_links l WHERE l.kind = k AND l.system = _system AND l.external_id = ext) THEN skipped := skipped + 1; CONTINUE; END IF;

    IF k = 'supplier' THEN
      IF op = 'create' THEN
        SELECT id::text INTO bid FROM public.suppliers WHERE lower(btrim(name)) = lower(nm);
        IF bid IS NULL THEN
          INSERT INTO public.suppliers (name, contact_name, email, phone, account_number, active)
          VALUES (nm, nullif(f->>'contact_name', ''), nullif(f->>'email', ''), nullif(f->>'phone', ''), nullif(f->>'account_number', ''), coalesce((f->>'active')::boolean, true)) RETURNING id::text INTO bid;
          created := created + 1;
        ELSE linked := linked + 1; END IF;
      ELSE
        UPDATE public.suppliers SET contact_name = coalesce(contact_name, nullif(f->>'contact_name', '')), email = coalesce(email, nullif(f->>'email', '')), phone = coalesce(phone, nullif(f->>'phone', '')), account_number = coalesce(account_number, nullif(f->>'account_number', '')) WHERE id::text = bid;
        IF NOT FOUND THEN skipped := skipped + 1; CONTINUE; END IF;
        linked := linked + 1;
      END IF;

    ELSIF k = 'material' THEN
      IF op = 'create' THEN
        sup := NULL;
        IF nullif(f->>'supplier_external_id', '') IS NOT NULL THEN
          SELECT l.bmd_id::uuid INTO sup FROM public.sync_links l WHERE l.kind = 'supplier' AND l.system = _system AND l.external_id = f->>'supplier_external_id';
        END IF;
        INSERT INTO public.catalogue_materials (name, sku, category, supplier_id, cost_uom, purchase_uom, unit_cost_cents, active, uom_confirmed, price_date, price_source)
        VALUES (nm, nullif(f->>'sku', ''), coalesce(nullif(f->>'category', ''), 'other'), sup, 'EA', 'EA', (f->>'unit_cost_cents')::bigint, coalesce((f->>'active')::boolean, true), false,
          CASE WHEN (f->>'unit_cost_cents') IS NOT NULL THEN today END, CASE WHEN (f->>'unit_cost_cents') IS NOT NULL THEN (CASE _system WHEN 'quickbooks' THEN 'QuickBooks' WHEN 'arriveping' THEN 'ArrivePing' ELSE 'CompanyCam' END) END) RETURNING id::text INTO bid;
        created := created + 1;
      ELSE
        -- BMD is the receiver only for what it does not have: a cost or SKU BMD already holds is left alone.
        UPDATE public.catalogue_materials SET
          price_date = CASE WHEN unit_cost_cents IS NULL AND (f->>'unit_cost_cents') IS NOT NULL THEN today ELSE price_date END,
          price_source = CASE WHEN unit_cost_cents IS NULL AND (f->>'unit_cost_cents') IS NOT NULL THEN (CASE _system WHEN 'quickbooks' THEN 'QuickBooks' WHEN 'arriveping' THEN 'ArrivePing' ELSE 'CompanyCam' END) ELSE price_source END,
          unit_cost_cents = coalesce(unit_cost_cents, (f->>'unit_cost_cents')::bigint), sku = coalesce(sku, nullif(f->>'sku', '')), updated_at = now()
        WHERE id::text = bid;
        IF NOT FOUND THEN skipped := skipped + 1; CONTINUE; END IF;
        linked := linked + 1;
      END IF;

    ELSIF k = 'labour' THEN
      IF op = 'create' THEN
        SELECT id::text INTO bid FROM public.labour_rates WHERE lower(btrim(name)) = lower(nm);
        IF bid IS NULL THEN
          INSERT INTO public.labour_rates (name, uom, unit_cost_cents, active, uom_confirmed) VALUES (nm, 'SF', (f->>'unit_cost_cents')::bigint, coalesce((f->>'active')::boolean, true), false) RETURNING id::text INTO bid;
          created := created + 1;
        ELSE linked := linked + 1; END IF;
      ELSE
        UPDATE public.labour_rates SET unit_cost_cents = coalesce(unit_cost_cents, (f->>'unit_cost_cents')::bigint) WHERE id::text = bid;
        IF NOT FOUND THEN skipped := skipped + 1; CONTINUE; END IF;
        linked := linked + 1;
      END IF;

    ELSE
      bid := btrim(coalesce(bid, f->>'code', ''));
      IF bid = '' THEN skipped := skipped + 1; CONTINUE; END IF;
      INSERT INTO public.cost_codes (code, name, qbo_item_id, sort_order) VALUES (bid, coalesce(nullif(nm, ''), bid), ext, (SELECT coalesce(max(sort_order), 0) + 1 FROM public.cost_codes))
      ON CONFLICT (code) DO UPDATE SET qbo_item_id = EXCLUDED.qbo_item_id;
      IF op = 'create' THEN created := created + 1; ELSE linked := linked + 1; END IF;
    END IF;

    INSERT INTO public.sync_links (kind, bmd_id, system, external_id, external_name, last_synced, synced_at)
    VALUES (k, bid, _system, ext, nm, f, now()) ON CONFLICT DO NOTHING;
    INSERT INTO public.sync_log (direction, system, kind, bmd_id, external_id, label, outcome, detail)
    VALUES ('in', _system, k, bid, ext, nm, CASE WHEN jsonb_array_length(coalesce(a->'kept', '[]'::jsonb)) > 0 THEN 'bmd_kept' ELSE 'applied' END, jsonb_build_object('op', op, 'fields', f, 'kept', coalesce(a->'kept', '[]'::jsonb)));
  END LOOP;
  RETURN jsonb_build_object('created', created, 'linked', linked, 'skipped', skipped);
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sync_import_apply(text, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.sync_import_apply(text, jsonb) TO authenticated;
