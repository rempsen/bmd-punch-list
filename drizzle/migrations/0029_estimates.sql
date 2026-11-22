-- BMD Projects: job finishes, estimates (Base and alternates), lines and their component snapshots.
-- Costs live here: readable only with view_pricing; every change goes through functions that need manage_estimates.
-- Idempotent.

ALTER TABLE public.catalogue_materials ADD COLUMN IF NOT EXISTS coverage_uom text
  CHECK (coverage_uom IS NULL OR coverage_uom IN ('SF','SY','LF','EA'));
--> statement-breakpoint
UPDATE public.catalogue_materials SET coverage_uom = cost_uom
 WHERE coverage_per_purchase_unit IS NOT NULL AND coverage_uom IS NULL AND cost_uom IN ('SF','SY','LF','EA');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.project_finishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (btrim(tag) <> ''),
  description text,
  assembly_template_id uuid REFERENCES public.assembly_templates(id) ON DELETE SET NULL,
  catalogue_material_id uuid REFERENCES public.catalogue_materials(id) ON DELETE SET NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_finishes_tag_key ON public.project_finishes (project_id, lower(btrim(tag)));
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.estimate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'estimate' CHECK (kind IN ('estimate','change_order')),
  co_number int,
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text,
  default_markup_pct numeric NOT NULL DEFAULT 35 CHECK (default_markup_pct >= 0 AND default_markup_pct <= 1000),
  sort_order int NOT NULL DEFAULT 0,
  is_base boolean NOT NULL DEFAULT false,
  locked boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','not_taken')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS estimate_versions_one_base ON public.estimate_versions (project_id) WHERE is_base AND kind = 'estimate';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS estimate_versions_co_number ON public.estimate_versions (project_id, co_number) WHERE kind = 'change_order';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.estimate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.estimate_versions(id) ON DELETE CASCADE,
  section text NOT NULL DEFAULT 'General',
  finish_id uuid REFERENCES public.project_finishes(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'assembly' CHECK (kind IN ('assembly','prep','misc','delivery','subcontract','allowance','lump_sum')),
  description text NOT NULL DEFAULT '',
  driver_qty numeric NOT NULL DEFAULT 0 CHECK (driver_qty >= 0),
  driver_uom text NOT NULL DEFAULT 'SF' CHECK (driver_uom IN ('SF','SY','LF','EA','carton','roll','pail','hour','LS')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','takeoff')),
  waste_pct numeric NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct <= 100),
  markup_pct numeric NOT NULL DEFAULT 0 CHECK (markup_pct >= 0 AND markup_pct <= 1000),
  price_basis text NOT NULL DEFAULT 'markup' CHECK (price_basis IN ('markup','margin','fixed_sell')),
  margin_pct numeric CHECK (margin_pct IS NULL OR (margin_pct >= 0 AND margin_pct < 100)),
  fixed_sell_cents bigint CHECK (fixed_sell_cents IS NULL OR fixed_sell_cents >= 0),
  cost_code text REFERENCES public.cost_codes(code),
  tax_code text NOT NULL DEFAULT 'GST' CHECK (tax_code IN ('GST','HST','EXEMPT','ZERO')),
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  takeoff_condition_id uuid,
  detached boolean NOT NULL DEFAULT false,
  selection text NOT NULL DEFAULT 'required' CHECK (selection IN ('required','optional','choose_one')),
  selection_group text,
  is_allowance boolean NOT NULL DEFAULT false,
  subject_to_measure boolean NOT NULL DEFAULT false,
  row_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS estimate_lines_version_idx ON public.estimate_lines (version_id, sort_order);
--> statement-breakpoint

-- A snapshot of the assembly at the time the line was added. unit_cost_cents null = not known yet.
CREATE TABLE IF NOT EXISTS public.estimate_line_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.estimate_lines(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('material','labour','fixed')),
  label text NOT NULL,
  source text NOT NULL CHECK (source IN ('finish_material','catalogue','labour_rate','fixed')),
  catalogue_material_id uuid REFERENCES public.catalogue_materials(id) ON DELETE SET NULL,
  labour_rate_id uuid REFERENCES public.labour_rates(id) ON DELETE SET NULL,
  unit_cost_cents bigint CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  cost_uom text NOT NULL,
  purchase_uom text NOT NULL,
  coverage_per_purchase_unit numeric CHECK (coverage_per_purchase_unit IS NULL OR coverage_per_purchase_unit > 0),
  qty_per_driver numeric NOT NULL DEFAULT 1 CHECK (qty_per_driver >= 0),
  waste_pct numeric NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct <= 100),
  round_up boolean NOT NULL DEFAULT false,
  pst_applies boolean NOT NULL DEFAULT false,
  on_gross boolean NOT NULL DEFAULT false,
  cost_overridden boolean NOT NULL DEFAULT false,
  not_applicable boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS estimate_line_components_line_idx ON public.estimate_line_components (line_id, sort_order);
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_finishes','estimate_versions','estimate_lines','estimate_line_components'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_capability(''view_pricing''))', t || ' read', t);
  END LOOP;
  -- Finish tags are edited directly; estimate rows only through the functions below.
  GRANT INSERT, UPDATE, DELETE ON public.project_finishes TO authenticated;
  DROP POLICY IF EXISTS "project_finishes write" ON public.project_finishes;
  CREATE POLICY "project_finishes write" ON public.project_finishes FOR ALL TO authenticated
    USING (public.has_capability('manage_estimates')) WITH CHECK (public.has_capability('manage_estimates'));
  GRANT UPDATE (name, description, default_markup_pct, sort_order) ON public.estimate_versions TO authenticated;
  DROP POLICY IF EXISTS "estimate_versions rename" ON public.estimate_versions;
  CREATE POLICY "estimate_versions rename" ON public.estimate_versions FOR UPDATE TO authenticated
    USING (public.has_capability('manage_estimates') AND NOT locked) WITH CHECK (public.has_capability('manage_estimates') AND NOT locked);
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.create_estimate_version(_project uuid, _name text, _kind text DEFAULT 'estimate')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE vid uuid; first boolean; n int; co int;
BEGIN
  IF NOT public.has_capability('manage_estimates') THEN RAISE EXCEPTION 'Not allowed to edit estimates'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = _project) THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF _kind NOT IN ('estimate','change_order') THEN RAISE EXCEPTION 'Unknown kind'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('estimate_versions' || _project::text));
  SELECT count(*) INTO n FROM public.estimate_versions WHERE project_id = _project AND kind = _kind;
  first := _kind = 'estimate' AND n = 0;
  IF _kind = 'change_order' THEN
    SELECT coalesce(max(co_number), 0) + 1 INTO co FROM public.estimate_versions WHERE project_id = _project AND kind = 'change_order';
  END IF;
  INSERT INTO public.estimate_versions (project_id, kind, co_number, name, is_base, sort_order)
  VALUES (_project, _kind, co, coalesce(nullif(btrim(_name), ''), CASE WHEN _kind = 'change_order' THEN 'CO-' || co WHEN first THEN 'Base' ELSE 'Alternate ' || n END), first, n + 1)
  RETURNING id INTO vid;
  RETURN vid;
END; $$;
--> statement-breakpoint

-- Saves one line and (when given) its component rows. A stale row_version is refused so two people never overwrite each other.
CREATE OR REPLACE FUNCTION public.save_estimate_line(_p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lid uuid := nullif(_p->>'id', '')::uuid; vid uuid; l jsonb := coalesce(_p->'line', '{}'::jsonb); c jsonb; i int := 0; rv int; is_locked boolean;
BEGIN
  IF NOT public.has_capability('manage_estimates') THEN RAISE EXCEPTION 'Not allowed to edit estimates'; END IF;
  IF lid IS NULL THEN vid := (_p->>'version_id')::uuid; ELSE SELECT version_id INTO vid FROM public.estimate_lines WHERE id = lid; END IF;
  SELECT locked INTO is_locked FROM public.estimate_versions WHERE id = vid;
  IF is_locked IS NULL THEN RAISE EXCEPTION 'Estimate not found'; END IF;
  IF is_locked THEN RAISE EXCEPTION 'This price has been sent or accepted and can no longer be changed. Copy it as an alternate or revise the quote.'; END IF;

  IF lid IS NULL THEN
    INSERT INTO public.estimate_lines (version_id, section, finish_id, kind, description, driver_qty, driver_uom, source, waste_pct, markup_pct, price_basis,
      margin_pct, fixed_sell_cents, cost_code, tax_code, notes, sort_order, takeoff_condition_id, detached, selection, selection_group, is_allowance, subject_to_measure)
    VALUES (vid, coalesce(nullif(btrim(l->>'section'), ''), 'General'), nullif(l->>'finish_id', '')::uuid, coalesce(l->>'kind', 'assembly'), coalesce(l->>'description', ''),
      coalesce((l->>'driver_qty')::numeric, 0), coalesce(l->>'driver_uom', 'SF'), coalesce(l->>'source', 'manual'), coalesce((l->>'waste_pct')::numeric, 0),
      coalesce((l->>'markup_pct')::numeric, 0), coalesce(l->>'price_basis', 'markup'), (l->>'margin_pct')::numeric, (l->>'fixed_sell_cents')::bigint,
      nullif(l->>'cost_code', ''), coalesce(l->>'tax_code', 'GST'), nullif(l->>'notes', ''),
      coalesce((l->>'sort_order')::int, (SELECT coalesce(max(sort_order), 0) + 1 FROM public.estimate_lines WHERE version_id = vid)),
      nullif(l->>'takeoff_condition_id', '')::uuid, coalesce((l->>'detached')::boolean, false), coalesce(l->>'selection', 'required'), nullif(l->>'selection_group', ''),
      coalesce((l->>'is_allowance')::boolean, false), coalesce((l->>'subject_to_measure')::boolean, false))
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
      INSERT INTO public.estimate_line_components (line_id, kind, label, source, catalogue_material_id, labour_rate_id, unit_cost_cents, cost_uom, purchase_uom,
        coverage_per_purchase_unit, qty_per_driver, waste_pct, round_up, pst_applies, on_gross, cost_overridden, not_applicable, sort_order)
      VALUES (lid, c->>'kind', coalesce(c->>'label', ''), c->>'source', nullif(c->>'catalogue_material_id', '')::uuid, nullif(c->>'labour_rate_id', '')::uuid,
        (c->>'unit_cost_cents')::bigint, c->>'cost_uom', c->>'purchase_uom', (c->>'coverage_per_purchase_unit')::numeric, coalesce((c->>'qty_per_driver')::numeric, 1),
        coalesce((c->>'waste_pct')::numeric, 0), coalesce((c->>'round_up')::boolean, false), coalesce((c->>'pst_applies')::boolean, false),
        coalesce((c->>'on_gross')::boolean, false), coalesce((c->>'cost_overridden')::boolean, false), coalesce((c->>'not_applicable')::boolean, false), i);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('id', lid, 'row_version', rv);
END; $$;
--> statement-breakpoint

-- Several lines at once (paste, import, bulk waste or markup). All or nothing.
CREATE OR REPLACE FUNCTION public.save_estimate_lines(_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it jsonb; out jsonb := '[]'::jsonb;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    out := out || jsonb_build_array(public.save_estimate_line(it));
  END LOOP;
  RETURN out;
END; $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.delete_estimate_line(_id uuid, _row_version int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_locked boolean;
BEGIN
  IF NOT public.has_capability('manage_estimates') THEN RAISE EXCEPTION 'Not allowed to edit estimates'; END IF;
  SELECT v.locked INTO is_locked FROM public.estimate_lines l JOIN public.estimate_versions v ON v.id = l.version_id WHERE l.id = _id;
  IF is_locked IS NULL THEN RETURN; END IF;
  IF is_locked THEN RAISE EXCEPTION 'This price has been sent or accepted and can no longer be changed.'; END IF;
  DELETE FROM public.estimate_lines WHERE id = _id AND row_version = _row_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'RELOAD: someone else changed this line. Reload to see their change, then make yours again.'; END IF;
END; $$;
--> statement-breakpoint

-- "Copy as alternate": a complete, separate copy that can then be changed.
CREATE OR REPLACE FUNCTION public.copy_estimate_version(_from uuid, _name text, _description text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE src public.estimate_versions; vid uuid; l record; nl uuid; n int;
BEGIN
  IF NOT public.has_capability('manage_estimates') THEN RAISE EXCEPTION 'Not allowed to edit estimates'; END IF;
  SELECT * INTO src FROM public.estimate_versions WHERE id = _from;
  IF src.id IS NULL THEN RAISE EXCEPTION 'Estimate not found'; END IF;
  IF src.kind <> 'estimate' THEN RAISE EXCEPTION 'Change orders are not copied as alternates'; END IF;
  SELECT count(*) INTO n FROM public.estimate_versions WHERE project_id = src.project_id AND kind = 'estimate';
  INSERT INTO public.estimate_versions (project_id, kind, name, description, default_markup_pct, sort_order)
  VALUES (src.project_id, 'estimate', coalesce(nullif(btrim(_name), ''), 'Alternate ' || n), nullif(btrim(coalesce(_description, '')), ''), src.default_markup_pct, n + 1)
  RETURNING id INTO vid;
  FOR l IN SELECT * FROM public.estimate_lines WHERE version_id = _from ORDER BY sort_order LOOP
    INSERT INTO public.estimate_lines (version_id, section, finish_id, kind, description, driver_qty, driver_uom, source, waste_pct, markup_pct, price_basis, margin_pct,
      fixed_sell_cents, cost_code, tax_code, notes, sort_order, takeoff_condition_id, detached, selection, selection_group, is_allowance, subject_to_measure)
    VALUES (vid, l.section, l.finish_id, l.kind, l.description, l.driver_qty, l.driver_uom, l.source, l.waste_pct, l.markup_pct, l.price_basis, l.margin_pct,
      l.fixed_sell_cents, l.cost_code, l.tax_code, l.notes, l.sort_order, l.takeoff_condition_id, l.detached, l.selection, l.selection_group, l.is_allowance, l.subject_to_measure)
    RETURNING id INTO nl;
    INSERT INTO public.estimate_line_components (line_id, kind, label, source, catalogue_material_id, labour_rate_id, unit_cost_cents, cost_uom, purchase_uom,
      coverage_per_purchase_unit, qty_per_driver, waste_pct, round_up, pst_applies, on_gross, cost_overridden, not_applicable, sort_order)
    SELECT nl, kind, label, source, catalogue_material_id, labour_rate_id, unit_cost_cents, cost_uom, purchase_uom,
      coverage_per_purchase_unit, qty_per_driver, waste_pct, round_up, pst_applies, on_gross, cost_overridden, not_applicable, sort_order
    FROM public.estimate_line_components WHERE line_id = l.id;
  END LOOP;
  RETURN vid;
END; $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.delete_estimate_version(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.estimate_versions;
BEGIN
  IF NOT public.has_capability('manage_estimates') THEN RAISE EXCEPTION 'Not allowed to edit estimates'; END IF;
  SELECT * INTO v FROM public.estimate_versions WHERE id = _id;
  IF v.id IS NULL THEN RETURN; END IF;
  IF v.locked OR v.status <> 'draft' THEN RAISE EXCEPTION 'A price that has been sent or accepted cannot be deleted.'; END IF;
  IF v.is_base THEN RAISE EXCEPTION 'The Base price cannot be deleted.'; END IF;
  DELETE FROM public.estimate_versions WHERE id = _id;
END; $$;
--> statement-breakpoint

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['create_estimate_version(uuid, text, text)','save_estimate_line(jsonb)','save_estimate_lines(jsonb)','delete_estimate_line(uuid, int)',
                           'copy_estimate_version(uuid, text, text)','delete_estimate_version(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
