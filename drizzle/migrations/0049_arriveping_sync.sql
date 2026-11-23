-- ArrivePing two-way sync: an outbox/inbox log of sync events, plus the status ArrivePing reports back on each install visit.
CREATE TABLE IF NOT EXISTS public.sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('out','in')),
  system text NOT NULL DEFAULT 'arriveping',
  entity_type text NOT NULL,
  entity_id uuid,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  idempotency_key text UNIQUE,
  external_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('pending','sent','acked','failed','ignored')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sync_events_queue_idx ON public.sync_events (system, status, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sync_events_project_idx ON public.sync_events (project_id, created_at);
--> statement-breakpoint
ALTER TABLE public.sync_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.sync_events FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.sync_events TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "sync_events read" ON public.sync_events;
--> statement-breakpoint
CREATE POLICY "sync_events read" ON public.sync_events FOR SELECT TO authenticated
  USING (public.has_capability('manage_integrations') OR (project_id IS NOT NULL AND public.has_capability('view_pipeline')));
--> statement-breakpoint
ALTER TABLE public.install_visits
  ADD COLUMN IF NOT EXISTS arriveping_status text,
  ADD COLUMN IF NOT EXISTS arriveping_assigned_to text,
  ADD COLUMN IF NOT EXISTS arriveping_last_event_at timestamptz;
--> statement-breakpoint
GRANT UPDATE (starts_at, ends_at, crew, notes, site_contact, arriveping_job_id, status, arriveping_status, arriveping_assigned_to, arriveping_last_event_at) ON public.install_visits TO authenticated;
--> statement-breakpoint
ALTER TABLE public.install_visit_events DROP CONSTRAINT IF EXISTS install_visit_events_source_check;
--> statement-breakpoint
ALTER TABLE public.install_visit_events ADD CONSTRAINT install_visit_events_source_check CHECK (source IN ('staff','arriveping','sync'));