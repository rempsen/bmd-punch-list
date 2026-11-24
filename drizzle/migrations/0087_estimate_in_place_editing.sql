ALTER TABLE public.estimate_lines ADD COLUMN IF NOT EXISTS unit_cost_override_cents bigint;
ALTER TABLE public.estimate_lines ADD COLUMN IF NOT EXISTS sell_override_cents bigint;
ALTER TABLE public.estimate_lines ADD COLUMN IF NOT EXISTS markup_overridden boolean NOT NULL DEFAULT false;

ALTER TABLE public.estimate_line_components ADD COLUMN IF NOT EXISTS order_uom text;
ALTER TABLE public.estimate_line_components ADD COLUMN IF NOT EXISTS order_uom_factor numeric;
ALTER TABLE public.estimate_line_components ADD COLUMN IF NOT EXISTS price_per text NOT NULL DEFAULT 'cost_unit';
ALTER TABLE public.estimate_line_components ADD COLUMN IF NOT EXISTS overridden_by uuid;
ALTER TABLE public.estimate_line_components ADD COLUMN IF NOT EXISTS overridden_at timestamptz;
DO $$ BEGIN
  ALTER TABLE public.estimate_line_components ADD CONSTRAINT estimate_line_components_price_per_check CHECK (price_per IN ('cost_unit','order_unit'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.estimate_line_components ADD CONSTRAINT estimate_line_components_order_factor_check CHECK (order_uom_factor IS NULL OR order_uom_factor > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.estimate_versions ADD COLUMN IF NOT EXISTS unlocked_by uuid;
ALTER TABLE public.estimate_versions ADD COLUMN IF NOT EXISTS unlocked_at timestamptz;
ALTER TABLE public.estimate_versions ADD COLUMN IF NOT EXISTS unlock_reason text;
ALTER TABLE public.estimate_versions ADD COLUMN IF NOT EXISTS section_markups jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.estimate_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.estimate_versions(id) ON DELETE CASCADE,
  line_id uuid REFERENCES public.estimate_lines(id) ON DELETE CASCADE,
  component_index int,
  line_label text NOT NULL DEFAULT '',
  field text NOT NULL,
  field_label text NOT NULL DEFAULT '',
  from_value jsonb,
  to_value jsonb,
  changed_by uuid DEFAULT auth.uid(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_by uuid
);
CREATE INDEX IF NOT EXISTS estimate_changes_version_idx ON public.estimate_changes (version_id, changed_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.estimate_changes TO authenticated;
GRANT ALL ON public.estimate_changes TO service_role;
ALTER TABLE public.estimate_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "estimate_changes read" ON public.estimate_changes;
CREATE POLICY "estimate_changes read" ON public.estimate_changes FOR SELECT TO authenticated USING (public.has_capability('view_pricing'));
DROP POLICY IF EXISTS "estimate_changes add" ON public.estimate_changes;
CREATE POLICY "estimate_changes add" ON public.estimate_changes FOR INSERT TO authenticated
  WITH CHECK (public.has_capability('manage_estimates') AND changed_by = auth.uid());
DROP POLICY IF EXISTS "estimate_changes revert" ON public.estimate_changes;
CREATE POLICY "estimate_changes revert" ON public.estimate_changes FOR UPDATE TO authenticated
  USING (public.has_capability('manage_estimates')) WITH CHECK (public.has_capability('manage_estimates'));

DROP POLICY IF EXISTS "estimate_versions rename" ON public.estimate_versions;
CREATE POLICY "estimate_versions rename" ON public.estimate_versions FOR UPDATE
  USING (public.has_capability('manage_estimates') AND (NOT locked OR unlocked_at IS NOT NULL))
  WITH CHECK (public.has_capability('manage_estimates') AND (NOT locked OR unlocked_at IS NOT NULL));

CREATE OR REPLACE FUNCTION public.estimate_versions_unlock_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.unlocked_by, NEW.unlocked_at, NEW.unlock_reason) IS DISTINCT FROM (OLD.unlocked_by, OLD.unlocked_at, OLD.unlock_reason)
     AND coalesce(current_setting('bmd.estimate_unlock', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Use Unlock to fix an error or Re-lock';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS estimate_versions_unlock_guard ON public.estimate_versions;
CREATE TRIGGER estimate_versions_unlock_guard BEFORE UPDATE ON public.estimate_versions FOR EACH ROW EXECUTE FUNCTION public.estimate_versions_unlock_guard();

CREATE OR REPLACE FUNCTION public.unlock_estimate_version(_id uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; is_locked boolean;
BEGIN
  SELECT project_id, locked INTO pid, is_locked FROM public.estimate_versions WHERE id = _id;
  IF pid IS NULL THEN RAISE EXCEPTION 'Estimate not found'; END IF;
  IF NOT public.has_capability('manage_projects', pid) THEN RAISE EXCEPTION 'Only people who manage projects can unlock an accepted price'; END IF;
  IF NOT is_locked THEN RAISE EXCEPTION 'This price is not locked'; END IF;
  IF coalesce(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'Give a reason for unlocking'; END IF;
  PERFORM set_config('bmd.estimate_unlock', 'on', true);
  UPDATE public.estimate_versions SET unlocked_by = auth.uid(), unlocked_at = now(), unlock_reason = btrim(_reason) WHERE id = _id;
  INSERT INTO public.estimate_changes (version_id, field, field_label, to_value, changed_by) VALUES (_id, 'unlock', 'Unlocked for corrections', to_jsonb(btrim(_reason)), auth.uid());
  PERFORM set_config('bmd.estimate_unlock', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.relock_estimate_version(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid;
BEGIN
  SELECT project_id INTO pid FROM public.estimate_versions WHERE id = _id;
  IF pid IS NULL THEN RAISE EXCEPTION 'Estimate not found'; END IF;
  IF NOT public.has_capability('manage_projects', pid) THEN RAISE EXCEPTION 'Only people who manage projects can re-lock a price'; END IF;
  PERFORM set_config('bmd.estimate_unlock', 'on', true);
  UPDATE public.estimate_versions SET unlocked_by = NULL, unlocked_at = NULL, unlock_reason = NULL WHERE id = _id;
  INSERT INTO public.estimate_changes (version_id, field, field_label, changed_by) VALUES (_id, 'relock', 'Re-locked', auth.uid());
  PERFORM set_config('bmd.estimate_unlock', '', true);
END; $$;
REVOKE ALL ON FUNCTION public.unlock_estimate_version(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.relock_estimate_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_estimate_version(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.relock_estimate_version(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_estimate_line(_id uuid, _row_version integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE is_locked boolean;
BEGIN
  IF NOT public.has_capability('manage_estimates') THEN RAISE EXCEPTION 'Not allowed to edit estimates'; END IF;
  SELECT v.locked AND v.unlocked_at IS NULL INTO is_locked FROM public.estimate_lines l JOIN public.estimate_versions v ON v.id = l.version_id WHERE l.id = _id;
  IF is_locked IS NULL THEN RETURN; END IF;
  IF is_locked THEN RAISE EXCEPTION 'This price has been sent or accepted and can no longer be changed.'; END IF;
  DELETE FROM public.estimate_lines WHERE id = _id AND row_version = _row_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'RELOAD: someone else changed this line. Reload to see their change, then make yours again.'; END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.save_estimate_line(_p jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE lid uuid := nullif(_p->>'id', '')::uuid; vid uuid; l jsonb := coalesce(_p->'line', '{}'::jsonb); c jsonb; i int := 0; rv int; is_locked boolean; ovr boolean;
BEGIN
  IF NOT public.has_capability('manage_estimates') THEN RAISE EXCEPTION 'Not allowed to edit estimates'; END IF;
  IF lid IS NULL THEN vid := (_p->>'version_id')::uuid; ELSE SELECT version_id INTO vid FROM public.estimate_lines WHERE id = lid; END IF;
  SELECT locked AND unlocked_at IS NULL INTO is_locked FROM public.estimate_versions WHERE id = vid;
  IF is_locked IS NULL THEN RAISE EXCEPTION 'Estimate not found'; END IF;
  IF is_locked THEN RAISE EXCEPTION 'This price has been sent or accepted and can no longer be changed. Copy it as an alternate or revise the quote.'; END IF;

  IF lid IS NULL THEN
    INSERT INTO public.estimate_lines (version_id, section, finish_id, kind, description, driver_qty, driver_uom, source, waste_pct, markup_pct, price_basis,
      margin_pct, fixed_sell_cents, cost_code, tax_code, notes, sort_order, takeoff_condition_id, detached, selection, selection_group, is_allowance, subject_to_measure,
      unit_cost_override_cents, sell_override_cents, markup_overridden)
    VALUES (vid, coalesce(nullif(btrim(l->>'section'), ''), 'General'), nullif(l->>'finish_id', '')::uuid, coalesce(l->>'kind', 'assembly'), coalesce(l->>'description', ''),
      coalesce((l->>'driver_qty')::numeric, 0), coalesce(l->>'driver_uom', 'SF'), coalesce(l->>'source', 'manual'), coalesce((l->>'waste_pct')::numeric, 0),
      coalesce((l->>'markup_pct')::numeric, 0), coalesce(l->>'price_basis', 'markup'), (l->>'margin_pct')::numeric, (l->>'fixed_sell_cents')::bigint,
      nullif(l->>'cost_code', ''), coalesce(l->>'tax_code', 'GST'), nullif(l->>'notes', ''),
      coalesce((l->>'sort_order')::int, (SELECT coalesce(max(sort_order), 0) + 1 FROM public.estimate_lines WHERE version_id = vid)),
      nullif(l->>'takeoff_condition_id', '')::uuid, coalesce((l->>'detached')::boolean, false), coalesce(l->>'selection', 'required'), nullif(l->>'selection_group', ''),
      coalesce((l->>'is_allowance')::boolean, false), coalesce((l->>'subject_to_measure')::boolean, false),
      (l->>'unit_cost_override_cents')::bigint, (l->>'sell_override_cents')::bigint, coalesce((l->>'markup_overridden')::boolean, false))
    RETURNING id, row_version INTO lid, rv;
  ELSE
    UPDATE public.estimate_lines SET
      section = CASE WHEN l ? 'section' THEN coalesce(nullif(btrim(l->>'section'), ''), 'General') ELSE section END,
      finish_id = CASE WHEN l ? 'finish_id' THEN nullif(l->>'finish_id', '')::uuid ELSE finish_id END,
      kind = coalesce(l->>'kind', kind),
      description = coalesce(l->>'description', description),
      driver_qty = coalesce((l->>'driver_qty')::numeric, driver_qty),
      driver_uom = coalesce(l->>'driver_uom', driver_uom),
      source = coalesce(l->>'source', source),
      waste_pct = coalesce((l->>'waste_pct')::numeric, waste_pct),
      markup_pct = coalesce((l->>'markup_pct')::numeric, markup_pct),
      price_basis = coalesce(l->>'price_basis', price_basis),
      margin_pct = CASE WHEN l ? 'margin_pct' THEN (l->>'margin_pct')::numeric ELSE margin_pct END,
      fixed_sell_cents = CASE WHEN l ? 'fixed_sell_cents' THEN (l->>'fixed_sell_cents')::bigint ELSE fixed_sell_cents END,
      cost_code = CASE WHEN l ? 'cost_code' THEN nullif(l->>'cost_code', '') ELSE cost_code END,
      tax_code = coalesce(l->>'tax_code', tax_code),
      notes = CASE WHEN l ? 'notes' THEN nullif(l->>'notes', '') ELSE notes END,
      sort_order = coalesce((l->>'sort_order')::int, sort_order),
      takeoff_condition_id = CASE WHEN l ? 'takeoff_condition_id' THEN nullif(l->>'takeoff_condition_id', '')::uuid ELSE takeoff_condition_id END,
      detached = coalesce((l->>'detached')::boolean, detached),
      selection = coalesce(l->>'selection', selection),
      selection_group = CASE WHEN l ? 'selection_group' THEN nullif(l->>'selection_group', '') ELSE selection_group END,
      is_allowance = coalesce((l->>'is_allowance')::boolean, is_allowance),
      subject_to_measure = coalesce((l->>'subject_to_measure')::boolean, subject_to_measure),
      unit_cost_override_cents = CASE WHEN l ? 'unit_cost_override_cents' THEN (l->>'unit_cost_override_cents')::bigint ELSE unit_cost_override_cents END,
      sell_override_cents = CASE WHEN l ? 'sell_override_cents' THEN (l->>'sell_override_cents')::bigint ELSE sell_override_cents END,
      markup_overridden = coalesce((l->>'markup_overridden')::boolean, markup_overridden),
      row_version = row_version + 1,
      updated_at = now()
    WHERE id = lid AND row_version = (_p->>'row_version')::int
    RETURNING row_version INTO rv;
    IF rv IS NULL THEN RAISE EXCEPTION 'RELOAD: someone else changed this line. Reload to see their change, then make yours again.'; END IF;
  END IF;

  IF jsonb_typeof(_p->'components') = 'array' THEN
    DELETE FROM public.estimate_line_components WHERE line_id = lid;
    FOR c IN SELECT * FROM jsonb_array_elements(_p->'components') LOOP
      i := i + 1;
      ovr := coalesce((c->>'cost_overridden')::boolean, false);
      INSERT INTO public.estimate_line_components (line_id, kind, label, source, catalogue_material_id, labour_rate_id, unit_cost_cents, cost_uom, purchase_uom,
        coverage_per_purchase_unit, qty_per_driver, waste_pct, round_up, pst_applies, on_gross, cost_overridden, not_applicable, sort_order,
        order_uom, order_uom_factor, price_per, overridden_by, overridden_at)
      VALUES (lid, c->>'kind', coalesce(c->>'label', ''), c->>'source', nullif(c->>'catalogue_material_id', '')::uuid, nullif(c->>'labour_rate_id', '')::uuid,
        (c->>'unit_cost_cents')::bigint, c->>'cost_uom', c->>'purchase_uom', (c->>'coverage_per_purchase_unit')::numeric, coalesce((c->>'qty_per_driver')::numeric, 1),
        coalesce((c->>'waste_pct')::numeric, 0), coalesce((c->>'round_up')::boolean, false), coalesce((c->>'pst_applies')::boolean, false),
        coalesce((c->>'on_gross')::boolean, false), ovr, coalesce((c->>'not_applicable')::boolean, false), i,
        nullif(c->>'order_uom', ''), (c->>'order_uom_factor')::numeric, coalesce(nullif(c->>'price_per', ''), 'cost_unit'),
        CASE WHEN ovr THEN coalesce(nullif(c->>'overridden_by', '')::uuid, auth.uid()) END,
        CASE WHEN ovr THEN coalesce((c->>'overridden_at')::timestamptz, now()) END);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('id', lid, 'row_version', rv);
END; $function$;