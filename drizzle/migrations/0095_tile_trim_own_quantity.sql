-- Schluter and other tile trims as catalogue items, and parts with their own quantity.
--
-- A part with its own quantity is priced in a measured unit that does not convert to its line's (a Schluter edge by
-- the LF on a wall tiled by the SF), has no coverage, and is never the finish's own material. Its quantity is how much
-- of it there is, not so much per unit of the line. The estimate asks yes or no for it on each line; here it is
-- ordered, and listed for the crew, by that quantity. The same rule is in src/lib/estimating/calc.ts (ownQty).

-- 1. A catalogue category for tile trims, so each SKU and its price changes are kept in Materials.
ALTER TABLE public.catalogue_materials DROP CONSTRAINT IF EXISTS catalogue_materials_category_check;
--> statement-breakpoint
ALTER TABLE public.catalogue_materials ADD CONSTRAINT catalogue_materials_category_check CHECK (category = ANY (ARRAY['carpet_broadloom','carpet_tile','lvp','lvt','sheet_vinyl','rubber','floor_tile','wall_tile','wall_base','transitions','tile_trim','adhesive','underlay','prep','window_coverings','other']));
--> statement-breakpoint
ALTER TABLE public.assembly_templates DROP CONSTRAINT IF EXISTS assembly_templates_category_check;
--> statement-breakpoint
ALTER TABLE public.assembly_templates ADD CONSTRAINT assembly_templates_category_check CHECK (category = ANY (ARRAY['carpet_broadloom','carpet_tile','lvp','lvt','sheet_vinyl','rubber','floor_tile','wall_tile','wall_base','transitions','tile_trim','adhesive','underlay','prep','window_coverings','other']));
--> statement-breakpoint

-- 2. Material orders on acceptance: a part with its own quantity is ordered by that quantity, with its waste.
CREATE OR REPLACE FUNCTION public.seed_material_orders(_project uuid, _version uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.material_orders WHERE project_id = _project AND source_version_id = _version) THEN RETURN 0; END IF;
  INSERT INTO public.material_orders (project_id, estimate_line_id, catalogue_item_id, supplier_id, description, quantity, unit, unit_cost_cents, status, ordered_at, source_version_id)
  SELECT _project, l.id, c.catalogue_material_id, m.supplier_id,
         coalesce(nullif(btrim(concat_ws(' ', m.name, m.colour)), ''), nullif(c.label, ''), l.description),
         round(q.qty, 2), coalesce(c.purchase_uom, l.driver_uom, ''),
         CASE WHEN c.cost_uom IS NOT DISTINCT FROM c.purchase_uom THEN c.unit_cost_cents::integer
              WHEN coalesce(c.coverage_per_purchase_unit, 0) > 0 THEN round(c.unit_cost_cents * c.coverage_per_purchase_unit)::integer END,
         'to_order', NULL, _version
  FROM public.estimate_lines l
  JOIN public.estimate_line_components c ON c.line_id = l.id
  LEFT JOIN public.catalogue_materials m ON m.id = c.catalogue_material_id
  CROSS JOIN LATERAL (SELECT coalesce(c.cost_uom, c.purchase_uom) AS u) cu
  CROSS JOIN LATERAL (SELECT (c.source IS DISTINCT FROM 'finish_material' AND coalesce(c.coverage_per_purchase_unit, 0) = 0
                              AND l.driver_uom IN ('SF','SY','LF','EA') AND cu.u IN ('SF','SY','LF','EA')
                              AND NOT (l.driver_uom = cu.u OR (l.driver_uom IN ('SF','SY') AND cu.u IN ('SF','SY')))) AS own) o
  CROSS JOIN LATERAL (SELECT CASE WHEN o.own THEN coalesce(c.qty_per_driver, 0) * (1 + coalesce(c.waste_pct, 0) / 100)
                                  ELSE coalesce(l.driver_qty, 0) * coalesce(c.qty_per_driver, 1) * (1 + coalesce(c.waste_pct, 0) / 100) END AS d) dq
  CROSS JOIN LATERAL (SELECT CASE
      WHEN o.own THEN CASE WHEN c.round_up THEN ceil(dq.d - 1e-9) ELSE dq.d END
      WHEN coalesce(c.coverage_per_purchase_unit, 0) > 0 THEN
        CASE WHEN c.round_up THEN ceil(dq.d / c.coverage_per_purchase_unit - 1e-9) ELSE dq.d / c.coverage_per_purchase_unit END
      ELSE (SELECT CASE WHEN c.round_up THEN ceil(x - 1e-9) ELSE x END FROM (SELECT CASE
             WHEN l.driver_uom = 'SF' AND c.purchase_uom = 'SY' THEN dq.d / 9
             WHEN l.driver_uom = 'SY' AND c.purchase_uom = 'SF' THEN dq.d * 9
             ELSE dq.d END AS x) s)
    END AS qty) q
  WHERE l.version_id = _version AND c.kind = 'material' AND NOT coalesce(c.not_applicable, false)
    AND coalesce(l.selection, 'required') = 'required' AND q.qty > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.seed_material_orders(uuid, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- 3. The crew's material list also says where each part came from, so the browser can tell a part with its own
--    quantity from the finish's own material. Still no cost, markup, price or supplier.
DROP FUNCTION IF EXISTS public.job_material_list(uuid);
--> statement-breakpoint
CREATE FUNCTION public.job_material_list(_project uuid)
RETURNS TABLE(item_key text, section text, description text, line_description text, driver_qty numeric, driver_uom text,
              qty_per_driver numeric, waste_pct numeric, coverage_per_purchase_unit numeric, round_up boolean, purchase_uom text,
              sort_a integer, sort_b integer, sort_c integer, source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.job_crew_can(_project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  WITH vers AS (
    SELECT v.id, v.sort_order FROM public.estimate_versions v
     WHERE v.project_id = _project
       AND (v.status = 'accepted' OR (v.is_base AND NOT EXISTS (SELECT 1 FROM public.estimate_versions a WHERE a.project_id = _project AND a.status = 'accepted')))
  )
  SELECT l.id::text || ':' || c.sort_order::text || ':' || coalesce(c.catalogue_material_id::text, md5(coalesce(c.label, ''))),
         coalesce(nullif(btrim(l.section), ''), 'General'),
         coalesce(nullif(btrim(concat_ws(' ', m.name, m.colour)), ''), nullif(btrim(c.label), ''), l.description),
         l.description,
         l.driver_qty, l.driver_uom, c.qty_per_driver, c.waste_pct, c.coverage_per_purchase_unit, coalesce(c.round_up, false), c.purchase_uom,
         vers.sort_order, l.sort_order, c.sort_order, c.source
    FROM vers
    JOIN public.estimate_lines l ON l.version_id = vers.id AND coalesce(l.selection, 'required') = 'required'
    JOIN public.estimate_line_components c ON c.line_id = l.id AND c.kind = 'material' AND NOT coalesce(c.not_applicable, false)
    LEFT JOIN public.catalogue_materials m ON m.id = c.catalogue_material_id
   ORDER BY vers.sort_order, l.sort_order, c.sort_order;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.job_material_list(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.job_material_list(uuid) TO authenticated;
--> statement-breakpoint

-- 4. The Schluter edge on wall tile assemblies becomes a catalogue item priced per LF (the SKU is chosen in the
--    assembly or on each line), instead of a set amount.
UPDATE public.assembly_template_components ac
   SET kind = 'material', source = 'catalogue', cost_uom = 'LF'
  FROM public.assembly_templates t
 WHERE t.id = ac.template_id AND t.category = 'wall_tile' AND ac.label = 'Schluter edge' AND ac.source = 'fixed';
--> statement-breakpoint

-- 5. Lines not yet sent or accepted that carry a Schluter edge built the old way: as a set amount, or in the line's
--    own unit with nothing to answer. They become the catalogue part per LF; an answer or a typed cost is kept.
UPDATE public.estimate_line_components c
   SET kind = 'material', source = 'catalogue',
       cost_uom = 'LF', purchase_uom = 'LF', coverage_per_purchase_unit = NULL, round_up = false
  FROM public.estimate_lines l
  JOIN public.estimate_versions v ON v.id = l.version_id
 WHERE c.line_id = l.id AND NOT v.locked AND c.label = 'Schluter edge' AND c.catalogue_material_id IS NULL
   AND l.driver_uom IN ('SF','SY')
   AND (c.source = 'fixed' OR (c.qty_per_driver = 0 AND NOT c.not_applicable AND c.cost_uom IN ('SF','SY')));
