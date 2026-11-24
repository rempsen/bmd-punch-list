-- Material lands in Ordering when a quote or change order is accepted, whatever stage the job is in, and starts as
-- "to order": it becomes "on order" when someone marks it ordered or pushes a purchase order to QuickBooks.
ALTER TABLE public.material_orders DROP CONSTRAINT IF EXISTS material_orders_status_check;
--> statement-breakpoint
ALTER TABLE public.material_orders ADD CONSTRAINT material_orders_status_check CHECK (status IN ('to_order','on_order','received','on_site'));
--> statement-breakpoint
ALTER TABLE public.material_orders ALTER COLUMN status SET DEFAULT 'to_order';
--> statement-breakpoint
ALTER TABLE public.material_orders ALTER COLUMN ordered_at DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.material_orders ALTER COLUMN ordered_at DROP DEFAULT;
--> statement-breakpoint
-- The estimate version a line came from, so a version is never seeded twice.
ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS source_version_id uuid REFERENCES public.estimate_versions(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS material_orders_source_version ON public.material_orders (project_id, source_version_id);
--> statement-breakpoint
-- Lines seeded before this change carry their estimate line: stamp the version they came from, so neither the
-- backfill below nor a later acceptance seeds that version again.
UPDATE public.material_orders mo SET source_version_id = l.version_id
  FROM public.estimate_lines l
 WHERE mo.estimate_line_id = l.id AND mo.source_version_id IS NULL;
--> statement-breakpoint

-- One row per material component of a version's required lines, sized the same way the estimate sizes it.
-- Does nothing if that version was already seeded for the job.
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
  CROSS JOIN LATERAL (SELECT coalesce(l.driver_qty, 0) * coalesce(c.qty_per_driver, 1) * (1 + coalesce(c.waste_pct, 0) / 100) AS d) dq
  CROSS JOIN LATERAL (SELECT CASE
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

-- Acceptance is the moment the scope is fixed: seed then, for quotes and change orders alike, at any stage.
CREATE OR REPLACE FUNCTION public.quote_accepted_seed_materials() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind IN ('quote','change_order') AND NEW.status = 'accepted' AND NEW.accepted_version_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted' OR OLD.accepted_version_id IS DISTINCT FROM NEW.accepted_version_id) THEN
    PERFORM public.seed_material_orders(NEW.project_id, NEW.accepted_version_id);
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS quotes_change_order_materials ON public.quotes;
--> statement-breakpoint
DROP TRIGGER IF EXISTS quotes_accepted_materials ON public.quotes;
--> statement-breakpoint
CREATE TRIGGER quotes_accepted_materials AFTER INSERT OR UPDATE OF status, accepted_version_id ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quote_accepted_seed_materials();
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.change_order_seed_materials();
--> statement-breakpoint

-- Entering Won still seeds a job that has no accepted quote yet (from its base estimate); seed_material_orders skips a version already seeded.
CREATE OR REPLACE FUNCTION public.projects_seed_materials() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  IF NEW.stage = 'won' AND OLD.stage IS DISTINCT FROM 'won'
     AND NOT EXISTS (SELECT 1 FROM public.material_orders WHERE project_id = NEW.id) THEN
    SELECT accepted_version_id INTO v FROM public.quotes
     WHERE project_id = NEW.id AND kind = 'quote' AND status = 'accepted' AND accepted_version_id IS NOT NULL
     ORDER BY accepted_at DESC NULLS LAST LIMIT 1;
    IF v IS NULL THEN
      SELECT id INTO v FROM public.estimate_versions WHERE project_id = NEW.id AND kind = 'estimate' AND is_base LIMIT 1;
    END IF;
    IF v IS NOT NULL THEN PERFORM public.seed_material_orders(NEW.id, v); END IF;
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint

-- Quotes accepted before this change whose material never arrived (e.g. Test Take Off, accepted while in progress).
SELECT public.seed_material_orders(q.project_id, q.accepted_version_id)
  FROM public.quotes q
 WHERE q.status = 'accepted' AND q.kind IN ('quote','change_order') AND q.accepted_version_id IS NOT NULL;
