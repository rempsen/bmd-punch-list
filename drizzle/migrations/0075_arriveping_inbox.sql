-- Work orders scheduled in ArrivePing itself (not sent from a BMD visit). Ones BMD can place on a job become visits with
-- source 'arriveping'; the rest wait here until someone links them to a job, creates a job from them, or ignores them.
ALTER TABLE public.install_visits ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bmd' CHECK (source IN ('bmd','arriveping'));
--> statement-breakpoint
ALTER TABLE public.arriveping_link ADD COLUMN IF NOT EXISTS last_pull_at timestamptz;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.arriveping_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arriveping_job_id text NOT NULL UNIQUE,
  title text,
  reference text,
  customer_name text,
  customer_id text,
  starts_at timestamptz,
  ends_at timestamptz,
  assigned_to text,
  ap_status text,
  site_contact text,
  notes text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','linked','ignored')),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  visit_id uuid REFERENCES public.install_visits(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS arriveping_inbox_status_idx ON public.arriveping_inbox (status, starts_at);
--> statement-breakpoint
ALTER TABLE public.arriveping_inbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.arriveping_inbox FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.arriveping_inbox TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.arriveping_inbox TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "arriveping inbox read" ON public.arriveping_inbox;
--> statement-breakpoint
CREATE POLICY "arriveping inbox read" ON public.arriveping_inbox FOR SELECT TO authenticated USING (public.has_capability('view_pipeline'));
--> statement-breakpoint
DROP POLICY IF EXISTS "arriveping inbox update" ON public.arriveping_inbox;
--> statement-breakpoint
CREATE POLICY "arriveping inbox update" ON public.arriveping_inbox FOR UPDATE TO authenticated
  USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
