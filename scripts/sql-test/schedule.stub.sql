-- Stand-ins for what migration 0083 (runs, workdays, tentative, report-to, crew confirmation) builds on. Not a full schema.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.test_caps (capability text PRIMARY KEY);
CREATE FUNCTION public.has_capability(_capability text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM public.test_caps WHERE capability = _capability) $$;
CREATE TABLE public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, full_name text);
CREATE TABLE public.suppliers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text);
CREATE TABLE public.install_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL, ends_at timestamptz, crew text, notes text, site_contact text, arriveping_job_id text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','en_route','arrived','completed','cancelled')),
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(),
  assigned_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL, assigned_name text,
  technician_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL, scope text, source text NOT NULL DEFAULT 'bmd'
);
ALTER TABLE public.install_visits ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT (id, project_id, starts_at, ends_at, status, assigned_user_id, assigned_name, technician_supplier_id) ON public.install_visits TO authenticated;
GRANT UPDATE (starts_at, ends_at, status, assigned_user_id, assigned_name, technician_supplier_id) ON public.install_visits TO authenticated;
CREATE POLICY "install_visits all" ON public.install_visits FOR ALL TO authenticated USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
CREATE TABLE public.install_visit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), visit_id uuid NOT NULL REFERENCES public.install_visits(id) ON DELETE CASCADE,
  project_id uuid NOT NULL, status text NOT NULL, note text NOT NULL,
  source text NOT NULL DEFAULT 'staff', at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT install_visit_events_source_check CHECK (source IN ('staff','arriveping','sync'))
);
