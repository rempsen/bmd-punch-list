-- Stand-in for the parts of the live schema that 0082 (job list and job details) builds on. Bodies are the live ones, trimmed.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('bmd_admin','bmd_field','client','super_admin','bmd_manager','trade','viewer');
CREATE TYPE public.job_role AS ENUM ('estimator','project_lead','site_lead','other');
CREATE TYPE public.project_stage AS ENUM ('opportunity','estimating','quote_out','won','in_progress','closed','lost');
CREATE TABLE public.people (id uuid PRIMARY KEY, role public.app_role NOT NULL);
CREATE TABLE public.role_permissions (role public.app_role NOT NULL, capability text NOT NULL, allowed boolean NOT NULL DEFAULT true, PRIMARY KEY (role, capability));
INSERT INTO public.role_permissions (role, capability) VALUES ('bmd_manager','manage_projects'), ('bmd_manager','view_pipeline'), ('bmd_manager','manage_settings'), ('bmd_field','capture_items');
CREATE FUNCTION public.is_super_admin(_u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM public.people WHERE id = _u AND role = 'super_admin') $$;
CREATE FUNCTION public.has_capability(_c text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.is_super_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.people p JOIN public.role_permissions rp ON rp.role = p.role AND rp.capability = _c AND rp.allowed WHERE p.id = auth.uid()) $$;
CREATE TABLE public.clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, client_id uuid, client_name text, address text, street text, city text, province text,
  postal_code text, notes text, stage public.project_stage NOT NULL DEFAULT 'in_progress', stage_entered_at timestamptz NOT NULL DEFAULT now(),
  bid_due_date date, job_type text, estimated_value_cents bigint, lost_reason text, lost_note text, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.project_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE, user_id uuid NOT NULL,
  role public.app_role NOT NULL, added_by uuid, job_roles public.job_role[] NOT NULL DEFAULT '{}', UNIQUE (project_id, user_id));
CREATE FUNCTION public.is_project_member(_p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.is_super_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.project_members WHERE project_id = _p AND user_id = auth.uid()) $$;
CREATE FUNCTION public.has_capability(_c text, _p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.is_super_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.project_members m JOIN public.role_permissions rp ON rp.role = m.role AND rp.capability = _c WHERE m.project_id = _p AND m.user_id = auth.uid()) $$;
CREATE TABLE public.project_stage_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, from_stage public.project_stage, to_stage public.project_stage NOT NULL, changed_by uuid, changed_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE FUNCTION public.projects_stage_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN INSERT INTO public.project_stage_events (project_id, from_stage, to_stage, changed_by) VALUES (NEW.id, NULL, NEW.stage, auth.uid());
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.project_stage_events (project_id, from_stage, to_stage, changed_by, note)
    VALUES (NEW.id, OLD.stage, NEW.stage, auth.uid(), nullif(btrim(coalesce(current_setting('bmd.stage_note', true), '')), ''));
  END IF;
  RETURN NULL;
END; $$;
CREATE TRIGGER projects_stage_log AFTER INSERT OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.projects_stage_log();
CREATE TABLE public.project_scopes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE, scope text NOT NULL, other_text text, UNIQUE (project_id, scope));
CREATE TABLE public.project_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'client' CHECK (kind IN ('client','gc','site','other')),
  name text, company text, title text, email text, phone_mobile text, phone_office text, is_primary boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 0);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_contacts TO authenticated;
ALTER TABLE public.project_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts read" ON public.project_contacts FOR SELECT TO authenticated USING (public.is_project_member(project_id));
CREATE POLICY "contacts write" ON public.project_contacts FOR ALL TO authenticated
  USING (public.has_capability('manage_settings', project_id)) WITH CHECK (public.has_capability('manage_settings', project_id));
CREATE TABLE public.sync_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, bmd_id text NOT NULL, system text NOT NULL, external_id text NOT NULL);
ALTER TABLE public.sync_links ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.set_project_job_role(_project uuid, _job_role public.job_role, _user uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.project_members (project_id, user_id, role, added_by, job_roles) VALUES (_project, _user, 'bmd_manager', auth.uid(), ARRAY[_job_role])
  ON CONFLICT (project_id, user_id) DO UPDATE SET job_roles = public.project_members.job_roles || _job_role;
END; $$;
-- The live create_pipeline_project, as read from the database on 24 Nov 2026.
CREATE FUNCTION public.create_pipeline_project(_p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pid uuid; cname text; my_role public.app_role; s jsonb;
BEGIN
  IF NOT public.has_capability('manage_projects') THEN RAISE EXCEPTION 'Not allowed to create projects'; END IF;
  IF coalesce(btrim(_p->>'name'), '') = '' THEN RAISE EXCEPTION 'Project name is required'; END IF;
  SELECT c.name INTO cname FROM public.clients c WHERE c.id = nullif(_p->>'client_id', '')::uuid;
  IF cname IS NULL THEN RAISE EXCEPTION 'Choose a client'; END IF;
  INSERT INTO public.projects (name, client_id, client_name, address, street, city, province, postal_code, notes, stage, bid_due_date, job_type, estimated_value_cents)
  VALUES (btrim(_p->>'name'), (_p->>'client_id')::uuid, cname, nullif(btrim(_p->>'address'), ''),
          nullif(btrim(_p->>'street'), ''), nullif(btrim(_p->>'city'), ''), nullif(btrim(_p->>'province'), ''),
          nullif(btrim(_p->>'postal_code'), ''), nullif(btrim(_p->>'notes'), ''),
          'opportunity', nullif(_p->>'bid_due_date', '')::date, nullif(btrim(_p->>'job_type'), ''), nullif(_p->>'estimated_value_cents', '')::bigint)
  RETURNING id INTO pid;
  FOR s IN SELECT * FROM jsonb_array_elements(coalesce(_p->'scopes', '[]')) LOOP
    INSERT INTO public.project_scopes (project_id, scope, other_text) VALUES (pid, s->>'scope', nullif(btrim(s->>'other_text'), '')) ON CONFLICT DO NOTHING;
  END LOOP;
  IF NOT public.is_super_admin(auth.uid()) THEN
    SELECT m.role INTO my_role FROM public.project_members m
      JOIN public.role_permissions rp ON rp.role = m.role AND rp.capability = 'manage_projects' AND rp.allowed
     WHERE m.user_id = auth.uid() LIMIT 1;
    INSERT INTO public.project_members (project_id, user_id, role, added_by) VALUES (pid, auth.uid(), my_role, auth.uid()) ON CONFLICT DO NOTHING;
  END IF;
  IF nullif(_p->>'estimator_id', '') IS NOT NULL THEN PERFORM public.set_project_job_role(pid, 'estimator', (_p->>'estimator_id')::uuid); END IF;
  IF nullif(_p->>'project_lead_id', '') IS NOT NULL THEN PERFORM public.set_project_job_role(pid, 'project_lead', (_p->>'project_lead_id')::uuid); END IF;
  RETURN pid;
END; $$;

-- People: a super admin, a manager who is on one job, a field person on that job, and someone with no access.
INSERT INTO public.people VALUES ('a0000000-0000-0000-0000-000000000001', 'super_admin'), ('a0000000-0000-0000-0000-000000000002', 'bmd_manager'), ('a0000000-0000-0000-0000-000000000003', 'bmd_field');
INSERT INTO public.clients (id, name) VALUES ('c0000000-0000-0000-0000-000000000001', 'Acme Hotels');
INSERT INTO public.projects (id, name, stage) VALUES ('10000000-0000-0000-0000-000000000001', 'Existing job', 'in_progress');
INSERT INTO public.project_members (project_id, user_id, role) VALUES
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'bmd_manager'),
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'bmd_field');
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT ON public.projects, public.project_scopes, public.project_stage_events TO authenticated;
