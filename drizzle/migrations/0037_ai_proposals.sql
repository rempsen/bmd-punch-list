-- What the AI suggested from specs and schedules. A proposal changes nothing until a person accepts it.
CREATE TABLE IF NOT EXISTS public.ai_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'finish' CHECK (kind IN ('finish')),
  payload jsonb NOT NULL,
  source_note text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_proposals_project_idx ON public.ai_proposals (project_id, status);
--> statement-breakpoint
ALTER TABLE public.ai_proposals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.ai_proposals FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.ai_proposals TO authenticated;
--> statement-breakpoint
GRANT UPDATE (status, decided_by, decided_at) ON public.ai_proposals TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "ai_proposals read" ON public.ai_proposals;
--> statement-breakpoint
CREATE POLICY "ai_proposals read" ON public.ai_proposals FOR SELECT TO authenticated USING (public.has_capability('manage_estimates'));
--> statement-breakpoint
DROP POLICY IF EXISTS "ai_proposals add" ON public.ai_proposals;
--> statement-breakpoint
CREATE POLICY "ai_proposals add" ON public.ai_proposals FOR INSERT TO authenticated WITH CHECK (public.has_capability('manage_estimates') AND status = 'proposed');
--> statement-breakpoint
DROP POLICY IF EXISTS "ai_proposals decide" ON public.ai_proposals;
--> statement-breakpoint
CREATE POLICY "ai_proposals decide" ON public.ai_proposals FOR UPDATE TO authenticated USING (public.has_capability('manage_estimates') AND status = 'proposed') WITH CHECK (public.has_capability('manage_estimates'));
