-- One row per page of a plans PDF, so sheets can be named, searched and measured.
CREATE TABLE IF NOT EXISTS public.plan_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  page_number int NOT NULL CHECK (page_number >= 1),
  sheet_number text,
  title text,
  discipline text,
  floor_label text,
  width_pt numeric,
  height_pt numeric,
  rotation int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, page_number)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plan_sheets_project_idx ON public.plan_sheets (project_id);
--> statement-breakpoint
ALTER TABLE public.plan_sheets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.plan_sheets FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.plan_sheets TO authenticated;
--> statement-breakpoint
GRANT UPDATE (sheet_number, title, discipline, floor_label, width_pt, height_pt, rotation) ON public.plan_sheets TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "plan_sheets read" ON public.plan_sheets;
--> statement-breakpoint
CREATE POLICY "plan_sheets read" ON public.plan_sheets FOR SELECT TO authenticated USING (public.can_project_documents(project_id, false));
--> statement-breakpoint
DROP POLICY IF EXISTS "plan_sheets add" ON public.plan_sheets;
--> statement-breakpoint
CREATE POLICY "plan_sheets add" ON public.plan_sheets FOR INSERT TO authenticated
  WITH CHECK (public.can_project_documents(project_id, false) AND EXISTS (SELECT 1 FROM public.project_documents d WHERE d.id = document_id AND d.project_id = plan_sheets.project_id));
--> statement-breakpoint
DROP POLICY IF EXISTS "plan_sheets edit" ON public.plan_sheets;
--> statement-breakpoint
CREATE POLICY "plan_sheets edit" ON public.plan_sheets FOR UPDATE TO authenticated
  USING (public.can_project_documents(project_id, true) OR public.has_capability('manage_estimates')) WITH CHECK (public.can_project_documents(project_id, true) OR public.has_capability('manage_estimates'));
