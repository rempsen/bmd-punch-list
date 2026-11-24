-- search_catalogue_names (0068) matched the whole query as one phrase; it now matches the words in order with anything
-- between, like the catalogue search pricing staff get ("Acme Premium Tile" finds "Acme tile").
CREATE OR REPLACE FUNCTION public.search_catalogue_names(_q text, _limit int DEFAULT 25)
RETURNS TABLE (kind text, id uuid, name text, category text, manufacturer text, product_line text, sku text, colour text, cost_code text, purchase_uom text, cost_uom text, coverage_per_purchase_unit numeric, coverage_uom text, uom text, pst_applies boolean, active boolean, supplier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pat AS (SELECT '%' || regexp_replace(trim(coalesce(_q, '')), '\s+', '%', 'g') || '%' AS p)
  SELECT * FROM (
    SELECT 'material'::text AS kind, m.id, m.name, m.category, m.manufacturer, m.product_line, m.sku, m.colour, m.cost_code, m.purchase_uom, m.cost_uom, m.coverage_per_purchase_unit, m.coverage_uom, NULL::text AS uom, m.pst_applies, m.active, s.name AS supplier
      FROM public.catalogue_materials m LEFT JOIN public.suppliers s ON s.id = m.supplier_id, pat
     WHERE public.has_capability('view_pipeline')
       AND (m.name ILIKE pat.p OR m.manufacturer ILIKE pat.p OR m.product_line ILIKE pat.p OR m.sku ILIKE pat.p OR m.cost_code ILIKE pat.p OR m.category ILIKE pat.p)
    UNION ALL
    SELECT 'labour'::text, l.id, l.name, NULL, NULL, NULL, NULL, NULL, l.cost_code, NULL, NULL, NULL, NULL, l.uom, NULL, l.active, NULL
      FROM public.labour_rates l, pat
     WHERE public.has_capability('view_pipeline') AND (l.name ILIKE pat.p OR l.cost_code ILIKE pat.p)
  ) x ORDER BY kind, name LIMIT greatest(1, least(coalesce(_limit, 25), 100));
$$;
