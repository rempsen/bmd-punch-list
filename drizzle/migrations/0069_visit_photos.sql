-- ArrivePing completion photos: copies of the photos the crew took on a work order, filed under the install visit.
-- Written by the server (service role) when ArrivePing reports a visit completed; read by anyone who can read the visit.
CREATE TABLE IF NOT EXISTS public.install_visit_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.install_visits(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  arriveping_photo_id text NOT NULL,
  storage_path text NOT NULL,
  content_type text,
  caption text,
  taken_at timestamptz,
  taken_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS install_visit_photos_ap_uidx ON public.install_visit_photos (arriveping_photo_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS install_visit_photos_visit_idx ON public.install_visit_photos (visit_id, taken_at);
--> statement-breakpoint
ALTER TABLE public.install_visit_photos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.install_visit_photos FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.install_visit_photos TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.install_visit_photos TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "install_visit_photos read" ON public.install_visit_photos;
--> statement-breakpoint
CREATE POLICY "install_visit_photos read" ON public.install_visit_photos FOR SELECT TO authenticated
  USING (public.can_project_documents(project_id, false) OR public.has_capability('view_pipeline'));
--> statement-breakpoint
-- The photo bucket's read rule finds a file's job from the first path segment. Visit photos sit under the visit's id
-- (deficiency photos under the deficiency's), so the rule now looks both places. Any other segment still reads as no job.
CREATE OR REPLACE FUNCTION public.photo_path_project(_name text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE seg text := split_part(_name, '/', 1);
DECLARE found uuid;
BEGIN
  IF seg !~ '^[0-9a-f-]{36}$' THEN RETURN NULL; END IF;
  SELECT project_id INTO found FROM public.deficiencies WHERE id = seg::uuid;
  IF found IS NULL THEN
    SELECT project_id INTO found FROM public.install_visits WHERE id = seg::uuid;
  END IF;
  RETURN found;
END; $$;
