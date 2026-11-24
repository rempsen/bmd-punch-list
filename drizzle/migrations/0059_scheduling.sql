ALTER TABLE public.install_visits
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_name text,
  ADD COLUMN IF NOT EXISTS areas jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scope text;
GRANT UPDATE (assigned_user_id, assigned_name, areas, scope) ON public.install_visits TO authenticated;

CREATE TABLE public.visit_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.install_visits(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  details text,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  done_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX visit_tasks_visit ON public.visit_tasks (visit_id, sort);
CREATE INDEX visit_tasks_project_open ON public.visit_tasks (project_id) WHERE NOT done;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visit_tasks TO authenticated;
GRANT ALL ON public.visit_tasks TO service_role;
ALTER TABLE public.visit_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "visit_tasks read" ON public.visit_tasks FOR SELECT TO authenticated
  USING (public.can_project_documents(project_id, false) OR public.has_capability('view_pipeline'));
CREATE POLICY "visit_tasks add" ON public.visit_tasks FOR INSERT TO authenticated WITH CHECK (public.has_capability('manage_projects'));
CREATE POLICY "visit_tasks edit" ON public.visit_tasks FOR UPDATE TO authenticated USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
CREATE POLICY "visit_tasks delete" ON public.visit_tasks FOR DELETE TO authenticated USING (public.has_capability('manage_projects'));

-- ArrivePing's API takes no assignment from BMD, so the intent waits in the outbox like other unsent changes.
CREATE TRIGGER install_visits_queue_assignment_ins AFTER INSERT ON public.install_visits
  FOR EACH ROW WHEN (NEW.assigned_user_id IS NOT NULL OR NEW.assigned_name IS NOT NULL)
  EXECUTE FUNCTION public.sync_queue_change('arriveping_assignment', 'assigned_user_id', 'assigned_name');
CREATE TRIGGER install_visits_queue_assignment_upd AFTER UPDATE OF assigned_user_id, assigned_name ON public.install_visits
  FOR EACH ROW WHEN (OLD.assigned_user_id IS DISTINCT FROM NEW.assigned_user_id OR OLD.assigned_name IS DISTINCT FROM NEW.assigned_name)
  EXECUTE FUNCTION public.sync_queue_change('arriveping_assignment', 'assigned_user_id', 'assigned_name');

CREATE OR REPLACE FUNCTION public.bmd_technicians() RETURNS TABLE(id uuid, full_name text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('view_pipeline') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.email FROM public.profiles p
  WHERE public.is_active(p.id) AND (
        EXISTS (SELECT 1 FROM public.user_access a WHERE a.user_id = p.id AND a.level = 'bmd_field')
     OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.user_id = p.id AND m.role = 'bmd_field'))
  ORDER BY coalesce(p.full_name, p.email);
END; $$;
REVOKE EXECUTE ON FUNCTION public.bmd_technicians() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bmd_technicians() TO authenticated;