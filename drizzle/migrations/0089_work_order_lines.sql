-- Work orders carry the items from the approved estimate they cover (500 SF of LVT, 10 LF of base), and record when the
-- crew accepted them in ArrivePing.
CREATE TABLE IF NOT EXISTS public.install_visit_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.install_visits(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  estimate_line_id uuid REFERENCES public.estimate_lines(id) ON DELETE SET NULL,
  finish_id uuid REFERENCES public.project_finishes(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  uom text NOT NULL DEFAULT 'SF',
  cost_code text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS install_visit_lines_visit ON public.install_visit_lines (visit_id, sort_order);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS install_visit_lines_project ON public.install_visit_lines (project_id, estimate_line_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.install_visit_lines TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.install_visit_lines TO service_role;
--> statement-breakpoint
ALTER TABLE public.install_visit_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Policy names shared with migration 0090 (subcontract orders), which creates the same table: whichever runs second finds it
-- and leaves the job-scoped policies (has_capability(cap, project) — a capability on this job, not on any job).
DROP POLICY IF EXISTS "visit lines read" ON public.install_visit_lines;
--> statement-breakpoint
CREATE POLICY "visit lines read" ON public.install_visit_lines FOR SELECT TO authenticated
  USING (public.can_project_documents(project_id, false) OR public.has_capability('view_pipeline', project_id));
--> statement-breakpoint
DROP POLICY IF EXISTS "visit lines write" ON public.install_visit_lines;
--> statement-breakpoint
CREATE POLICY "visit lines write" ON public.install_visit_lines FOR ALL TO authenticated
  USING (public.has_capability('manage_projects', project_id)) WITH CHECK (public.has_capability('manage_projects', project_id));
--> statement-breakpoint

-- When the crew accepted the work order in ArrivePing, and who.
ALTER TABLE public.install_visits
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_by text;
--> statement-breakpoint

-- The items on the job's approved estimate (the accepted version, else the base version while none is accepted), without
-- costs: estimate rows themselves are readable only with view_pricing, and a work order is written by people who schedule.
CREATE OR REPLACE FUNCTION public.work_order_items(_project uuid)
RETURNS TABLE (estimate_line_id uuid, finish_id uuid, finish_tag text, section text, kind text, description text, quantity numeric, uom text, cost_code text, sort_order int, version_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (
    SELECT id, status FROM public.estimate_versions
     WHERE project_id = _project AND kind = 'estimate' AND (status = 'accepted' OR is_base)
     ORDER BY (status = 'accepted') DESC, is_base DESC, sort_order, created_at
     LIMIT 1
  )
  SELECT l.id, l.finish_id, f.tag, l.section, l.kind, l.description, l.driver_qty, l.driver_uom, l.cost_code, l.sort_order, v.status
    FROM v JOIN public.estimate_lines l ON l.version_id = v.id
    LEFT JOIN public.project_finishes f ON f.id = l.finish_id
   WHERE public.has_capability('manage_projects', _project) OR public.has_capability('view_pipeline', _project)
   ORDER BY l.sort_order, l.created_at;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.work_order_items(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.work_order_items(uuid) TO authenticated;
