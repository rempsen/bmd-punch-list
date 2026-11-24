-- Crews: (1) a person can be marked "Goes to site" so they can be scheduled whatever their access level;
-- (2) each labour item in the catalogue lists the crews (Labour or Both vendors) who do that work;
-- (3) a job's suggested crews are the ones linked to the labour on its estimate.
ALTER TABLE public.user_access ADD COLUMN IF NOT EXISTS goes_to_site boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_goes_to_site(_user uuid, _on boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('manage_users') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.user_access SET goes_to_site = coalesce(_on, false), updated_at = now(), updated_by = auth.uid() WHERE user_id = _user;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.set_goes_to_site(uuid, boolean) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.set_goes_to_site(uuid, boolean) TO authenticated;
--> statement-breakpoint
-- Staff who can be scheduled: active people marked "Goes to site", or with the BMD field level (company-wide or on a job).
CREATE OR REPLACE FUNCTION public.bmd_technicians()
RETURNS TABLE(id uuid, full_name text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('view_pipeline') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.email FROM public.profiles p
  WHERE public.is_active(p.id) AND (
        EXISTS (SELECT 1 FROM public.user_access a WHERE a.user_id = p.id AND (a.level = 'bmd_field' OR a.goes_to_site))
     OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.user_id = p.id AND m.role = 'bmd_field'))
  ORDER BY coalesce(p.full_name, p.email);
END; $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.labour_crews (
  labour_rate_id uuid NOT NULL REFERENCES public.labour_rates(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (labour_rate_id, supplier_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS labour_crews_supplier_idx ON public.labour_crews (supplier_id);
--> statement-breakpoint
ALTER TABLE public.labour_crews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.labour_crews FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.labour_crews TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "labour_crews read" ON public.labour_crews;
--> statement-breakpoint
CREATE POLICY "labour_crews read" ON public.labour_crews FOR SELECT TO authenticated USING (public.has_capability('view_pricing') OR public.has_capability('view_pipeline'));
--> statement-breakpoint
DROP POLICY IF EXISTS "labour_crews add" ON public.labour_crews;
--> statement-breakpoint
CREATE POLICY "labour_crews add" ON public.labour_crews FOR INSERT TO authenticated WITH CHECK (public.has_capability('manage_catalogue'));
--> statement-breakpoint
DROP POLICY IF EXISTS "labour_crews remove" ON public.labour_crews;
--> statement-breakpoint
CREATE POLICY "labour_crews remove" ON public.labour_crews FOR DELETE TO authenticated USING (public.has_capability('manage_catalogue'));
--> statement-breakpoint
-- The crews linked to the labour on a job's estimate (its accepted prices, else its Base), with the work each is linked for.
-- Returns vendor ids and labour names only: no costs.
CREATE OR REPLACE FUNCTION public.project_suggested_crews(_project uuid)
RETURNS TABLE(supplier_id uuid, work text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('view_pipeline') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  WITH vers AS (
    SELECT v.id FROM public.estimate_versions v
     WHERE v.project_id = _project
       AND (v.status = 'accepted' OR (v.is_base AND NOT EXISTS (SELECT 1 FROM public.estimate_versions a WHERE a.project_id = _project AND a.status = 'accepted')))
  )
  SELECT lc.supplier_id, string_agg(DISTINCT lr.name, ', ' ORDER BY lr.name)
    FROM vers
    JOIN public.estimate_lines l ON l.version_id = vers.id
    JOIN public.estimate_line_components c ON c.line_id = l.id AND c.labour_rate_id IS NOT NULL AND NOT c.not_applicable
    JOIN public.labour_rates lr ON lr.id = c.labour_rate_id
    JOIN public.labour_crews lc ON lc.labour_rate_id = lr.id
    JOIN public.suppliers s ON s.id = lc.supplier_id AND s.active AND s.supplies IN ('labour', 'both')
   GROUP BY lc.supplier_id;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.project_suggested_crews(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.project_suggested_crews(uuid) TO authenticated;
