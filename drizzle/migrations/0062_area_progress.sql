CREATE TABLE public.area_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  scope text NOT NULL,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','complete','not_required')),
  blocker text NULL,
  blocker_kind text NULL CHECK (blocker_kind IN ('material','access','prep','other')),
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','arriveping')),
  UNIQUE (project_id, room_id, scope)
);
CREATE INDEX area_progress_project_idx ON public.area_progress (project_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.area_progress TO authenticated;
GRANT ALL ON public.area_progress TO service_role;
ALTER TABLE public.area_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "area_progress read" ON public.area_progress FOR SELECT TO authenticated
  USING (public.is_project_member(project_id) OR public.has_capability('view_pipeline'));
CREATE POLICY "area_progress add" ON public.area_progress FOR INSERT TO authenticated
  WITH CHECK ((public.has_capability('capture_items', project_id) OR public.has_capability('manage_projects', project_id)) AND public.location_project(room_id) = project_id);
CREATE POLICY "area_progress edit" ON public.area_progress FOR UPDATE TO authenticated
  USING (public.has_capability('capture_items', project_id) OR public.has_capability('manage_projects', project_id))
  WITH CHECK ((public.has_capability('capture_items', project_id) OR public.has_capability('manage_projects', project_id)) AND public.location_project(room_id) = project_id);
CREATE POLICY "area_progress delete" ON public.area_progress FOR DELETE TO authenticated
  USING (public.has_capability('manage_projects', project_id));