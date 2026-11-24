CREATE OR REPLACE FUNCTION public.queue_visit_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lbl text; who text; diff jsonb;
BEGIN
  SELECT coalesce(full_name, email) INTO who FROM public.profiles WHERE id = NEW.assigned_user_id;
  who := coalesce(who, NEW.assigned_name, 'Unassigned');
  SELECT coalesce(project_number || ' ', '') || name INTO lbl FROM public.projects WHERE id = NEW.project_id;
  lbl := coalesce(lbl, 'Visit') || ' · ' || to_char(NEW.starts_at AT TIME ZONE 'America/Winnipeg', 'Mon DD') || ' → ' || who;
  diff := jsonb_build_object(
    'assigned_user_id', jsonb_build_object('from', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD.assigned_user_id) END, 'to', to_jsonb(NEW.assigned_user_id)),
    'assigned_name', jsonb_build_object('from', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD.assigned_name) END, 'to', to_jsonb(NEW.assigned_name)),
    'technician', to_jsonb(who),
    'arriveping_job_id', to_jsonb(NEW.arriveping_job_id));
  UPDATE public.sync_outbox SET changes = changes || jsonb_build_object('assigned_user_id', jsonb_build_object('from', changes->'assigned_user_id'->'from', 'to', diff->'assigned_user_id'->'to'), 'assigned_name', jsonb_build_object('from', changes->'assigned_name'->'from', 'to', diff->'assigned_name'->'to'), 'technician', diff->'technician', 'arriveping_job_id', diff->'arriveping_job_id'), label = lbl, updated_at = now()
   WHERE kind = 'arriveping_assignment' AND bmd_id = NEW.id::text AND status = 'waiting';
  IF NOT FOUND THEN
    INSERT INTO public.sync_outbox (kind, bmd_id, label, op, changes, created_by)
    VALUES ('arriveping_assignment', NEW.id::text, lbl, 'update', diff, auth.uid());
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS install_visits_queue_assignment_ins ON public.install_visits;
DROP TRIGGER IF EXISTS install_visits_queue_assignment_upd ON public.install_visits;
CREATE TRIGGER install_visits_queue_assignment_ins AFTER INSERT ON public.install_visits
  FOR EACH ROW WHEN (NEW.assigned_user_id IS NOT NULL OR NEW.assigned_name IS NOT NULL)
  EXECUTE FUNCTION public.queue_visit_assignment();
CREATE TRIGGER install_visits_queue_assignment_upd AFTER UPDATE OF assigned_user_id, assigned_name ON public.install_visits
  FOR EACH ROW WHEN (OLD.assigned_user_id IS DISTINCT FROM NEW.assigned_user_id OR OLD.assigned_name IS DISTINCT FROM NEW.assigned_name)
  EXECUTE FUNCTION public.queue_visit_assignment();