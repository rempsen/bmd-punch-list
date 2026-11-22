-- BMD Projects: pipeline stages, project numbers, staff assignment, pipeline project creation.
-- Idempotent: safe to run more than once.

DO $$ BEGIN
  CREATE TYPE public.project_stage AS ENUM ('opportunity','estimating','quote_out','won','in_progress','closed','lost');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE public.job_role AS ENUM ('estimator','project_lead','site_lead','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_number text,
  ADD COLUMN IF NOT EXISTS stage public.project_stage NOT NULL DEFAULT 'in_progress',
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS bid_due_date date,
  ADD COLUMN IF NOT EXISTS estimated_value_cents bigint,
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS lost_note text,
  ADD COLUMN IF NOT EXISTS job_type text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE public.projects ADD CONSTRAINT projects_lost_reason_check
    CHECK (lost_reason IS NULL OR lost_reason IN ('price','scope','timing','no_decision','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS projects_project_number_key ON public.projects (project_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS projects_client_id_idx ON public.projects (client_id);
--> statement-breakpoint

-- A person can hold more than one job role on a project (estimator and project lead are often the same person).
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS job_roles public.job_role[] NOT NULL DEFAULT '{}';
--> statement-breakpoint

-- Project numbers: YY-NNN, one sequence per calendar year (Winnipeg time).
CREATE TABLE IF NOT EXISTS public.project_number_counters (year int PRIMARY KEY, last_seq int NOT NULL);
--> statement-breakpoint
ALTER TABLE public.project_number_counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.project_number_counters FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assign_project_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE y int; n int;
BEGIN
  IF NEW.project_number IS NOT NULL THEN RETURN NEW; END IF;
  y := extract(year FROM (coalesce(NEW.created_at, now()) AT TIME ZONE 'America/Winnipeg'))::int;
  INSERT INTO public.project_number_counters (year, last_seq) VALUES (y, 1)
    ON CONFLICT (year) DO UPDATE SET last_seq = public.project_number_counters.last_seq + 1
    RETURNING last_seq INTO n;
  NEW.project_number := lpad((y % 100)::text, 2, '0') || '-' || lpad(n::text, 3, '0');
  RETURN NEW;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS projects_assign_number ON public.projects;
--> statement-breakpoint
CREATE TRIGGER projects_assign_number BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.assign_project_number();
--> statement-breakpoint
-- Number the projects that already exist, oldest first.
DO $$ DECLARE r record; y int; n int;
BEGIN
  FOR r IN SELECT id, created_at FROM public.projects WHERE project_number IS NULL ORDER BY created_at LOOP
    y := extract(year FROM (r.created_at AT TIME ZONE 'America/Winnipeg'))::int;
    INSERT INTO public.project_number_counters (year, last_seq) VALUES (y, 1)
      ON CONFLICT (year) DO UPDATE SET last_seq = public.project_number_counters.last_seq + 1
      RETURNING last_seq INTO n;
    UPDATE public.projects SET project_number = lpad((y % 100)::text, 2, '0') || '-' || lpad(n::text, 3, '0') WHERE id = r.id;
  END LOOP;
END $$;
--> statement-breakpoint

-- Stage history.
CREATE TABLE IF NOT EXISTS public.project_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  from_stage public.project_stage,
  to_stage public.project_stage NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  note text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_stage_events_project_idx ON public.project_stage_events (project_id, changed_at);
--> statement-breakpoint
ALTER TABLE public.project_stage_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.project_stage_events FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.project_stage_events TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "stage events read" ON public.project_stage_events;
--> statement-breakpoint
CREATE POLICY "stage events read" ON public.project_stage_events FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline'));
--> statement-breakpoint
-- Existing projects start their history where they are now.
INSERT INTO public.project_stage_events (project_id, from_stage, to_stage, changed_at, note)
SELECT p.id, NULL, p.stage, p.created_at, 'Existing job'
FROM public.projects p
WHERE NOT EXISTS (SELECT 1 FROM public.project_stage_events e WHERE e.project_id = p.id);
--> statement-breakpoint

UPDATE public.projects p SET stage_entered_at = p.created_at
WHERE (SELECT count(*) FROM public.project_stage_events e WHERE e.project_id = p.id) = 1
  AND EXISTS (SELECT 1 FROM public.project_stage_events e WHERE e.project_id = p.id AND e.note = 'Existing job');
--> statement-breakpoint

-- Stage rules hold however the row is changed: a lost project needs a reason, and every change is recorded.
CREATE OR REPLACE FUNCTION public.projects_stage_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF NEW.stage = 'lost' AND NEW.lost_reason IS NULL THEN
      RAISE EXCEPTION 'Choose a reason for marking this project lost';
    END IF;
    IF NEW.stage <> 'lost' THEN NEW.lost_reason := NULL; NEW.lost_note := NULL; END IF;
    NEW.stage_entered_at := now();
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS projects_stage_guard ON public.projects;
--> statement-breakpoint
CREATE TRIGGER projects_stage_guard BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_stage_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.projects_stage_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.project_stage_events (project_id, from_stage, to_stage, changed_by)
    VALUES (NEW.id, NULL, NEW.stage, auth.uid());
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.project_stage_events (project_id, from_stage, to_stage, changed_by, note)
    VALUES (NEW.id, OLD.stage, NEW.stage, auth.uid(), nullif(btrim(coalesce(current_setting('bmd.stage_note', true), '')), ''));
  END IF;
  RETURN NULL;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS projects_stage_log ON public.projects;
--> statement-breakpoint
CREATE TRIGGER projects_stage_log AFTER INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_stage_log();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.move_project_stage(_project uuid, _to_stage public.project_stage, _reason text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('manage_projects') THEN RAISE EXCEPTION 'Not allowed to move projects'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = _project) THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF _to_stage = 'lost' AND coalesce(_reason, '') NOT IN ('price','scope','timing','no_decision','other') THEN
    RAISE EXCEPTION 'Choose a reason for marking this project lost';
  END IF;
  PERFORM set_config('bmd.stage_note', coalesce(_note, ''), true);
  UPDATE public.projects
     SET stage = _to_stage,
         lost_reason = CASE WHEN _to_stage = 'lost' THEN _reason END,
         lost_note = CASE WHEN _to_stage = 'lost' THEN nullif(btrim(coalesce(_note, '')), '') END
   WHERE id = _project AND stage IS DISTINCT FROM _to_stage;
  PERFORM set_config('bmd.stage_note', '', true);
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.move_project_stage(uuid, public.project_stage, text, text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.move_project_stage(uuid, public.project_stage, text, text) TO authenticated;
--> statement-breakpoint

-- BMD staff who can be assigned to a project.
CREATE OR REPLACE FUNCTION public.bmd_staff()
RETURNS TABLE (id uuid, full_name text, email text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('view_pipeline') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.email FROM public.profiles p
  WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role IN ('super_admin','bmd_admin','bmd_manager','bmd_field'))
     OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.user_id = p.id AND m.role IN ('super_admin','bmd_admin','bmd_manager','bmd_field'))
  ORDER BY coalesce(p.full_name, p.email);
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bmd_staff() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.bmd_staff() TO authenticated;
--> statement-breakpoint

-- One person per job role on a project; passing a null user clears the role.
CREATE OR REPLACE FUNCTION public.set_project_job_role(_project uuid, _job_role public.job_role, _user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.app_role;
BEGIN
  IF NOT public.has_capability('manage_projects') THEN RAISE EXCEPTION 'Not allowed to assign staff'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = _project) THEN RAISE EXCEPTION 'Project not found'; END IF;
  UPDATE public.project_members SET job_roles = array_remove(job_roles, _job_role)
   WHERE project_id = _project AND _job_role = ANY (job_roles) AND user_id IS DISTINCT FROM _user;
  IF _user IS NULL THEN RETURN; END IF;
  IF public.is_super_admin(_user) THEN r := 'super_admin';
  ELSE
    SELECT m.role INTO r FROM public.project_members m
     WHERE m.user_id = _user AND m.role IN ('bmd_manager','bmd_admin','bmd_field')
     ORDER BY CASE m.role WHEN 'bmd_manager' THEN 1 WHEN 'bmd_admin' THEN 2 ELSE 3 END LIMIT 1;
    IF r IS NULL THEN RAISE EXCEPTION 'Only BMD staff can be assigned'; END IF;
  END IF;
  INSERT INTO public.project_members (project_id, user_id, role, added_by, job_roles)
  VALUES (_project, _user, r, auth.uid(), ARRAY[_job_role])
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET job_roles = CASE WHEN _job_role = ANY (public.project_members.job_roles) THEN public.project_members.job_roles
                         ELSE public.project_members.job_roles || _job_role END;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.set_project_job_role(uuid, public.job_role, uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.set_project_job_role(uuid, public.job_role, uuid) TO authenticated;
--> statement-breakpoint

-- New project from the pipeline: starts in Opportunity, no floors or rooms yet.
CREATE OR REPLACE FUNCTION public.create_pipeline_project(_p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; cname text; my_role public.app_role; s jsonb;
BEGIN
  IF NOT public.has_capability('manage_projects') THEN RAISE EXCEPTION 'Not allowed to create projects'; END IF;
  IF coalesce(btrim(_p->>'name'), '') = '' THEN RAISE EXCEPTION 'Project name is required'; END IF;
  SELECT c.name INTO cname FROM public.clients c WHERE c.id = nullif(_p->>'client_id', '')::uuid;
  IF cname IS NULL THEN RAISE EXCEPTION 'Choose a client'; END IF;

  INSERT INTO public.projects (name, client_id, client_name, address, street, city, province, postal_code, notes,
                               stage, bid_due_date, job_type, estimated_value_cents)
  VALUES (btrim(_p->>'name'), (_p->>'client_id')::uuid, cname, nullif(btrim(_p->>'address'), ''),
          nullif(btrim(_p->>'street'), ''), nullif(btrim(_p->>'city'), ''), nullif(btrim(_p->>'province'), ''),
          nullif(btrim(_p->>'postal_code'), ''), nullif(btrim(_p->>'notes'), ''),
          'opportunity', nullif(_p->>'bid_due_date', '')::date, nullif(btrim(_p->>'job_type'), ''),
          nullif(_p->>'estimated_value_cents', '')::bigint)
  RETURNING id INTO pid;

  FOR s IN SELECT * FROM jsonb_array_elements(coalesce(_p->'scopes', '[]')) LOOP
    INSERT INTO public.project_scopes (project_id, scope, other_text)
    VALUES (pid, s->>'scope', nullif(btrim(s->>'other_text'), '')) ON CONFLICT DO NOTHING;
  END LOOP;

  IF NOT public.is_super_admin(auth.uid()) THEN
    SELECT m.role INTO my_role FROM public.project_members m
      JOIN public.role_permissions rp ON rp.role = m.role AND rp.capability = 'manage_projects' AND rp.allowed
     WHERE m.user_id = auth.uid() LIMIT 1;
    INSERT INTO public.project_members (project_id, user_id, role, added_by)
    VALUES (pid, auth.uid(), my_role, auth.uid()) ON CONFLICT DO NOTHING;
  END IF;

  IF nullif(_p->>'estimator_id', '') IS NOT NULL THEN
    PERFORM public.set_project_job_role(pid, 'estimator', (_p->>'estimator_id')::uuid);
  END IF;
  IF nullif(_p->>'project_lead_id', '') IS NOT NULL THEN
    PERFORM public.set_project_job_role(pid, 'project_lead', (_p->>'project_lead_id')::uuid);
  END IF;
  RETURN pid;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_pipeline_project(jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_pipeline_project(jsonb) TO authenticated;
--> statement-breakpoint

-- "Set up site": add floors, rooms and pick lists to a project that has none yet (offered when a job is won).
CREATE OR REPLACE FUNCTION public.setup_project_site(_project uuid, _job jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f jsonb; r jsonb; fid uuid; fi int := 0; ri int; s jsonb; pl jsonb; pi int := 0;
BEGIN
  IF NOT public.has_capability('manage_projects') THEN RAISE EXCEPTION 'Not allowed to set up this site'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = _project) THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.floors WHERE project_id = _project) THEN RAISE EXCEPTION 'This site is already set up'; END IF;
  IF jsonb_array_length(coalesce(_job->'floors', '[]')) = 0 THEN RAISE EXCEPTION 'Add at least one floor'; END IF;

  UPDATE public.projects SET building_type = coalesce(nullif(_job->>'building_type', ''), building_type) WHERE id = _project;

  IF jsonb_array_length(coalesce(_job->'pick_lists', '[]')) > 0 THEN
    DELETE FROM public.pick_lists WHERE project_id = _project;
    FOR pl IN SELECT * FROM jsonb_array_elements(_job->'pick_lists') LOOP
      pi := pi + 1;
      INSERT INTO public.pick_lists (project_id, kind, value, sort_order)
      VALUES (_project, (pl->>'kind')::public.pick_kind, pl->>'value', pi);
    END LOOP;
  END IF;

  FOR s IN SELECT * FROM jsonb_array_elements(coalesce(_job->'scopes', '[]')) LOOP
    INSERT INTO public.project_scopes (project_id, scope, other_text)
    VALUES (_project, s->>'scope', nullif(btrim(s->>'other_text'), '')) ON CONFLICT DO NOTHING;
  END LOOP;

  FOR f IN SELECT * FROM jsonb_array_elements(_job->'floors') LOOP
    fi := fi + 1;
    INSERT INTO public.floors (project_id, number, label, sort_order)
    VALUES (_project, (f->>'number')::int, btrim(f->>'label'), fi) RETURNING id INTO fid;
    ri := 0;
    FOR r IN SELECT * FROM jsonb_array_elements(coalesce(f->'locations', '[]')) LOOP
      ri := ri + 1;
      INSERT INTO public.locations (floor_id, type, name, room_type, sort_order)
      VALUES (fid, (r->>'type')::public.location_type, r->>'name', nullif(r->>'room_type', ''), ri);
    END LOOP;
  END LOOP;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.setup_project_site(uuid, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.setup_project_site(uuid, jsonb) TO authenticated;
--> statement-breakpoint

-- Pipeline users see and edit every project and its assignments, not only jobs they are members of.
DROP POLICY IF EXISTS "projects read pipeline" ON public.projects;
--> statement-breakpoint
CREATE POLICY "projects read pipeline" ON public.projects FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline'));
--> statement-breakpoint
DROP POLICY IF EXISTS "projects update pipeline" ON public.projects;
--> statement-breakpoint
CREATE POLICY "projects update pipeline" ON public.projects FOR UPDATE TO authenticated
  USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
--> statement-breakpoint
DROP POLICY IF EXISTS "members read pipeline" ON public.project_members;
--> statement-breakpoint
CREATE POLICY "members read pipeline" ON public.project_members FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline'));
--> statement-breakpoint

-- The existing Hyatt Centric job sits under client Kothari Group, in progress.
INSERT INTO public.clients (name)
SELECT 'Kothari Group' WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE lower(btrim(name)) = 'kothari group');
--> statement-breakpoint
UPDATE public.projects p SET client_id = c.id
FROM public.clients c
WHERE p.client_id IS NULL AND p.client_name IS NOT NULL AND lower(btrim(c.name)) = lower(btrim(p.client_name));
