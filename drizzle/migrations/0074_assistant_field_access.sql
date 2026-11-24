-- Ask BMD for BMD field staff (Dan, 24 Nov 2026: "BMD staff and BMD managers can have the same permissions or be
-- linked for now"). 0068 counted "BMD staff" as people who see the pipeline, which left out BMD field. The assistant
-- now has its own capability, use_assistant, given to super admins, BMD admins, managers and BMD field. Pricing-only
-- Knowledge, costs and margins still need view_pricing; editing Knowledge still needs manage_settings.
INSERT INTO public.role_permissions (role, capability, allowed)
SELECT r, 'use_assistant', r::text IN ('super_admin','bmd_admin','bmd_manager','bmd_field')
FROM unnest(enum_range(NULL::public.app_role)) AS r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions p WHERE p.role = r AND p.capability = 'use_assistant');
--> statement-breakpoint

-- Whether the signed-in person may use the assistant.
CREATE OR REPLACE FUNCTION public.assistant_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_capability('use_assistant') OR public.has_capability('view_pipeline');
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.assistant_allowed() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.assistant_allowed() TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.company_details()
RETURNS TABLE (company_name text, office_address text, mailing_address text, phone text, email text, website text, gst_number text, business_number text, hours text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.assistant_allowed() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  SELECT s.company_name, s.office_address, s.mailing_address, s.phone, s.email, s.website, s.gst_number, s.business_number, s.hours
    FROM public.quote_settings s WHERE s.id = 1;
END; $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.can_read_knowledge(_visibility text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.assistant_allowed() AND (_visibility = 'all_staff' OR public.has_capability('view_pricing'));
$$;
--> statement-breakpoint

DROP POLICY IF EXISTS "assistant conversations own" ON public.assistant_conversations;
--> statement-breakpoint
CREATE POLICY "assistant conversations own" ON public.assistant_conversations FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.assistant_allowed())
  WITH CHECK (user_id = auth.uid() AND public.assistant_allowed());
--> statement-breakpoint
DROP POLICY IF EXISTS "assistant messages own" ON public.assistant_messages;
--> statement-breakpoint
CREATE POLICY "assistant messages own" ON public.assistant_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assistant_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()) AND public.assistant_allowed())
  WITH CHECK (EXISTS (SELECT 1 FROM public.assistant_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()) AND public.assistant_allowed());
--> statement-breakpoint

-- Catalogue names (no costs) for the assistant, as in 0073, now for everyone who may use it.
CREATE OR REPLACE FUNCTION public.search_catalogue_names(_q text, _limit int DEFAULT 25)
RETURNS TABLE (kind text, id uuid, name text, category text, manufacturer text, product_line text, sku text, colour text, cost_code text, purchase_uom text, cost_uom text, coverage_per_purchase_unit numeric, coverage_uom text, uom text, pst_applies boolean, active boolean, supplier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pat AS (SELECT '%' || regexp_replace(trim(coalesce(_q, '')), '\s+', '%', 'g') || '%' AS p)
  SELECT * FROM (
    SELECT 'material'::text AS kind, m.id, m.name, m.category, m.manufacturer, m.product_line, m.sku, m.colour, m.cost_code, m.purchase_uom, m.cost_uom, m.coverage_per_purchase_unit, m.coverage_uom, NULL::text AS uom, m.pst_applies, m.active, s.name AS supplier
      FROM public.catalogue_materials m LEFT JOIN public.suppliers s ON s.id = m.supplier_id, pat
     WHERE public.assistant_allowed()
       AND (m.name ILIKE pat.p OR m.manufacturer ILIKE pat.p OR m.product_line ILIKE pat.p OR m.sku ILIKE pat.p OR m.cost_code ILIKE pat.p OR m.category ILIKE pat.p)
    UNION ALL
    SELECT 'labour'::text, l.id, l.name, NULL, NULL, NULL, NULL, NULL, l.cost_code, NULL, NULL, NULL, NULL, l.uom, NULL, l.active, NULL
      FROM public.labour_rates l, pat
     WHERE public.assistant_allowed() AND (l.name ILIKE pat.p OR l.cost_code ILIKE pat.p)
  ) x ORDER BY kind, name LIMIT greatest(1, least(coalesce(_limit, 25), 100));
$$;
