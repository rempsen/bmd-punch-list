-- Work orders are valued: each line carries the labour rate it was created with (per unit of its quantity), taken from
-- the approved estimate's labour component when the line was added, else the catalogue's rate for its cost code, else
-- entered by pricing staff. The rate is a snapshot: later edits to the estimate or the catalogue leave it alone.
-- A blank rate is null, never 0. The rate column is readable only through the RPC below (view_pricing on the job).
ALTER TABLE public.install_visit_lines
  ADD COLUMN IF NOT EXISTS unit_labour_cost_cents bigint CHECK (unit_labour_cost_cents IS NULL OR unit_labour_cost_cents >= 0),
  ADD COLUMN IF NOT EXISTS labour_rate_source text CHECK (labour_rate_source IS NULL OR labour_rate_source IN ('estimate','catalogue','manual')),
  ADD COLUMN IF NOT EXISTS labour_rate_id uuid REFERENCES public.labour_rates(id) ON DELETE SET NULL;
--> statement-breakpoint
-- Same pattern as subcontract_orders in 0090: a table-level grant would override a column revoke, so the grant is
-- rebuilt without the money column. The source and rate id carry no price and stay readable.
REVOKE SELECT ON public.install_visit_lines FROM authenticated;
--> statement-breakpoint
GRANT SELECT (id, visit_id, project_id, estimate_line_id, finish_id, description, quantity, uom, cost_code, sort_order,
  created_at, labour_rate_source, labour_rate_id) ON public.install_visit_lines TO authenticated;
--> statement-breakpoint
-- Each work-order line's rate and value, and the per-visit totals, for people who may see costs on that job; empty for
-- anyone else. Rows with visit_id and a null line_id are the per-visit totals (line_value_cents = sum of the costed
-- lines, uncosted = lines with no rate).
CREATE OR REPLACE FUNCTION public.work_order_values(_project uuid)
RETURNS TABLE (visit_id uuid, line_id uuid, unit_labour_cost_cents bigint, labour_rate_source text, labour_rate_id uuid, line_value_cents bigint, uncosted int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH l AS (
    SELECT il.visit_id, il.id AS line_id, il.unit_labour_cost_cents, il.labour_rate_source, il.labour_rate_id,
           CASE WHEN il.unit_labour_cost_cents IS NULL THEN NULL ELSE round(il.unit_labour_cost_cents * il.quantity)::bigint END AS line_value_cents
      FROM public.install_visit_lines il
     WHERE il.project_id = _project AND public.has_capability('view_pricing', _project)
  )
  SELECT l.visit_id, l.line_id, l.unit_labour_cost_cents, l.labour_rate_source, l.labour_rate_id, l.line_value_cents, 0 FROM l
  UNION ALL
  SELECT l.visit_id, NULL, NULL, NULL, NULL, coalesce(sum(l.line_value_cents), 0)::bigint, count(*) FILTER (WHERE l.unit_labour_cost_cents IS NULL)::int
    FROM l GROUP BY l.visit_id;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.work_order_values(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.work_order_values(uuid) TO authenticated;
--> statement-breakpoint
-- The approved estimate's items, now with each line's labour components (the estimate's own snapshot of rate, unit and
-- quantity per driver unit) so the app can price labour per driver unit with the estimate's arithmetic
-- (src/lib/estimating/calc.ts) rather than a second copy of it in SQL. Components come back null without view_pricing.
DROP FUNCTION IF EXISTS public.work_order_items(uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.work_order_items(_project uuid)
RETURNS TABLE (estimate_line_id uuid, finish_id uuid, finish_tag text, section text, kind text, description text, quantity numeric, uom text, cost_code text, sort_order int, version_status text,
               labour_components jsonb, labour_rate_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (
    SELECT id, status FROM public.estimate_versions
     WHERE project_id = _project AND kind = 'estimate' AND (status = 'accepted' OR is_base)
     ORDER BY (status = 'accepted') DESC, is_base DESC, sort_order, created_at
     LIMIT 1
  ), p AS (
    SELECT public.has_capability('view_pricing', _project) AS ok
  )
  SELECT l.id, l.finish_id, f.tag, l.section, l.kind, l.description, l.driver_qty, l.driver_uom, l.cost_code, l.sort_order, v.status,
         CASE WHEN p.ok THEN (
           SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'unit_cost_cents', c.unit_cost_cents, 'cost_uom', c.cost_uom, 'purchase_uom', c.purchase_uom,
                    'coverage_per_purchase_unit', c.coverage_per_purchase_unit, 'qty_per_driver', c.qty_per_driver,
                    'waste_pct', c.waste_pct, 'round_up', c.round_up, 'on_gross', c.on_gross, 'labour_rate_id', c.labour_rate_id)
                    ORDER BY c.sort_order), '[]'::jsonb)
             FROM public.estimate_line_components c
            WHERE c.line_id = l.id AND c.kind = 'labour' AND NOT c.not_applicable) END,
         CASE WHEN p.ok THEN (
           SELECT c.labour_rate_id FROM public.estimate_line_components c
            WHERE c.line_id = l.id AND c.kind = 'labour' AND NOT c.not_applicable AND c.labour_rate_id IS NOT NULL
            ORDER BY c.sort_order LIMIT 1) END
    FROM v JOIN public.estimate_lines l ON l.version_id = v.id
    LEFT JOIN public.project_finishes f ON f.id = l.finish_id
    CROSS JOIN p
   WHERE public.has_capability('manage_projects', _project) OR public.has_capability('view_pipeline', _project)
   ORDER BY l.sort_order, l.created_at;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.work_order_items(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.work_order_items(uuid) TO authenticated;
--> statement-breakpoint
-- Same signature as 0091; each line object may now carry unit_labour_cost_cents, labour_rate_source and labour_rate_id.
-- The app sets them (keeping a saved line's rate when it is re-saved); a blank rate is stored as null.
CREATE OR REPLACE FUNCTION public.install_visit_replace_lines(_visit uuid, _lines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  _project uuid;
  l jsonb;
  i int := 0;
  _rate bigint;
BEGIN
  SELECT project_id INTO _project FROM public.install_visits WHERE id = _visit;
  IF _project IS NULL THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF NOT public.has_capability('manage_projects', _project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' THEN RAISE EXCEPTION 'Lines must be a list'; END IF;
  DELETE FROM public.install_visit_lines WHERE visit_id = _visit;
  FOR l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _rate := (l->>'unit_labour_cost_cents')::bigint;
    INSERT INTO public.install_visit_lines (visit_id, project_id, estimate_line_id, finish_id, description, quantity, uom, cost_code, sort_order,
                                            unit_labour_cost_cents, labour_rate_source, labour_rate_id)
    VALUES (_visit, _project, (l->>'estimate_line_id')::uuid, (l->>'finish_id')::uuid, coalesce(l->>'description', ''),
            coalesce((l->>'quantity')::numeric, 0), coalesce(nullif(btrim(l->>'uom'), ''), 'EA'), nullif(btrim(l->>'cost_code'), ''), coalesce((l->>'sort_order')::int, i),
            _rate, CASE WHEN _rate IS NULL THEN NULL ELSE nullif(btrim(l->>'labour_rate_source'), '') END, (l->>'labour_rate_id')::uuid);
    i := i + 1;
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.install_visit_replace_lines(uuid, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.install_visit_replace_lines(uuid, jsonb) TO authenticated;
--> statement-breakpoint
