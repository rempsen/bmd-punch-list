-- Install visits on a project and their status history (set by staff or reported by ArrivePing).
CREATE TABLE IF NOT EXISTS public.install_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  crew text,
  notes text,
  site_contact text,
  arriveping_job_id text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','en_route','arrived','completed','cancelled')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS install_visits_project_idx ON public.install_visits (project_id, starts_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS install_visits_job_key ON public.install_visits (arriveping_job_id) WHERE arriveping_job_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.install_visit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.install_visits(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text NOT NULL,
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','arriveping')),
  at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS install_visit_events_project_idx ON public.install_visit_events (project_id, at);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['install_visits','install_visit_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_project_documents(project_id, false) OR public.has_capability(''view_pipeline''))', t || ' read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' add', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_capability(''manage_projects''))', t || ' add', t);
  END LOOP;
  GRANT UPDATE (starts_at, ends_at, crew, notes, site_contact, arriveping_job_id, status) ON public.install_visits TO authenticated;
  DROP POLICY IF EXISTS "install_visits edit" ON public.install_visits;
  CREATE POLICY "install_visits edit" ON public.install_visits FOR UPDATE TO authenticated USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
END $$;
