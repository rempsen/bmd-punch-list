CREATE TABLE public.material_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  estimate_line_id uuid REFERENCES public.estimate_lines(id) ON DELETE SET NULL,
  catalogue_item_id uuid REFERENCES public.catalogue_materials(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT '',
  unit_cost_cents integer,
  status text NOT NULL DEFAULT 'on_order' CHECK (status IN ('on_order','received','on_site')),
  ordered_at timestamptz NOT NULL DEFAULT now(),
  po_number text, qbo_po_id text, qbo_po_sent_at timestamptz,
  received_at timestamptz, received_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  received_qty numeric, received_note text,
  on_site_at timestamptz, on_site_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX material_orders_project_status ON public.material_orders (project_id, status);
CREATE INDEX material_orders_supplier_status ON public.material_orders (supplier_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_orders TO authenticated;
GRANT ALL ON public.material_orders TO service_role;
ALTER TABLE public.material_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "material_orders read" ON public.material_orders FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline') OR public.has_capability('manage_materials'));
CREATE POLICY "material_orders insert" ON public.material_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_capability('manage_projects') OR public.has_capability('manage_materials'));
CREATE POLICY "material_orders update" ON public.material_orders FOR UPDATE TO authenticated
  USING (public.has_capability('manage_projects') OR public.has_capability('manage_materials'))
  WITH CHECK (public.has_capability('manage_projects') OR public.has_capability('manage_materials'));
CREATE POLICY "material_orders delete" ON public.material_orders FOR DELETE TO authenticated
  USING (public.has_capability('manage_projects') OR public.has_capability('manage_materials'));

CREATE OR REPLACE FUNCTION public.material_orders_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE TRIGGER material_orders_touch BEFORE UPDATE ON public.material_orders FOR EACH ROW EXECUTE FUNCTION public.material_orders_touch();

INSERT INTO public.role_permissions (role, capability, allowed)
SELECT r, 'manage_materials', r IN ('super_admin','bmd_admin','bmd_field')
FROM unnest(enum_range(NULL::public.app_role)) AS r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions p WHERE p.role = r AND p.capability = 'manage_materials');

-- One row per material component of a version's required lines, sized the same way the estimate sizes it.
CREATE OR REPLACE FUNCTION public.seed_material_orders(_project uuid, _version uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.material_orders (project_id, estimate_line_id, catalogue_item_id, supplier_id, description, quantity, unit, unit_cost_cents)
  SELECT _project, l.id, c.catalogue_material_id, m.supplier_id,
         coalesce(nullif(btrim(concat_ws(' ', m.name, m.colour)), ''), nullif(c.label, ''), l.description),
         round(q.qty, 2), coalesce(c.purchase_uom, l.driver_uom, ''),
         CASE WHEN c.cost_uom IS NOT DISTINCT FROM c.purchase_uom THEN c.unit_cost_cents::integer
              WHEN coalesce(c.coverage_per_purchase_unit, 0) > 0 THEN round(c.unit_cost_cents * c.coverage_per_purchase_unit)::integer END
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
REVOKE EXECUTE ON FUNCTION public.seed_material_orders(uuid, uuid) FROM PUBLIC, anon, authenticated;

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
CREATE TRIGGER projects_seed_materials AFTER UPDATE OF stage ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_seed_materials();

CREATE OR REPLACE FUNCTION public.change_order_seed_materials() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'change_order' AND NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted'
     AND NEW.accepted_version_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.projects WHERE id = NEW.project_id AND stage IN ('won','in_progress','closed')) THEN
    PERFORM public.seed_material_orders(NEW.project_id, NEW.accepted_version_id);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER quotes_change_order_materials AFTER UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.change_order_seed_materials();