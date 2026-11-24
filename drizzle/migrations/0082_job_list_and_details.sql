-- Job list and job details: a Warranty stage, internal jobs, two more site-contact roles, job templates,
-- a "linked to QuickBooks" lookup for the job list, and a new-job function that takes all of it.
-- Safe to run twice. Nothing here uses the new 'warranty' value, so it can run inside one transaction.

ALTER TYPE public.project_stage ADD VALUE IF NOT EXISTS 'warranty' BEFORE 'closed';
--> statement-breakpoint

-- Internal jobs hold BMD's own time (shop, quoting, equipment repairs). Every existing job is a client job.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS standard_tasks text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_kind_check;
--> statement-breakpoint
ALTER TABLE public.projects ADD CONSTRAINT projects_kind_check CHECK (kind IN ('client','internal'));
--> statement-breakpoint
COMMENT ON COLUMN public.projects.standard_tasks IS 'The tasks every visit to this job normally includes. Filled from a job template; a starting list for new visits.';
--> statement-breakpoint

-- Site contacts: the customer's project manager and the site superintendent become roles of their own.
ALTER TABLE public.project_contacts DROP CONSTRAINT IF EXISTS project_contacts_kind_check;
--> statement-breakpoint
ALTER TABLE public.project_contacts ADD CONSTRAINT project_contacts_kind_check CHECK (kind IN ('client','gc','site','other','pm','super'));
--> statement-breakpoint
-- Contacts are shown and edited on the job's Overview, which opens for jobs that have no site set up yet.
-- The same people who can see and edit the job there can see and edit its contacts.
DROP POLICY IF EXISTS "contacts read pipeline" ON public.project_contacts;
--> statement-breakpoint
CREATE POLICY "contacts read pipeline" ON public.project_contacts FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline'));
--> statement-breakpoint
DROP POLICY IF EXISTS "contacts write pipeline" ON public.project_contacts;
--> statement-breakpoint
CREATE POLICY "contacts write pipeline" ON public.project_contacts FOR ALL TO authenticated
  USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
--> statement-breakpoint

-- Job templates: a named starting point for the new-job form. No estimates, prices or documents.
CREATE TABLE IF NOT EXISTS public.job_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  kind text NOT NULL DEFAULT 'client' CHECK (kind IN ('client','internal')),
  default_stage text NOT NULL DEFAULT 'opportunity' CHECK (default_stage IN ('opportunity','estimating','quote_out','won','in_progress')),
  job_type text,
  scopes text[] NOT NULL DEFAULT '{}',
  other_scope text,
  contact_roles text[] NOT NULL DEFAULT '{}' CHECK (contact_roles <@ ARRAY['client','gc','site','other','pm','super']),
  visit_tasks text[] NOT NULL DEFAULT '{}',
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'internal' OR default_stage = 'in_progress')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS job_templates_name_key ON public.job_templates (lower(btrim(name)));
--> statement-breakpoint
ALTER TABLE public.job_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.job_templates FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_templates TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.job_templates TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "job templates read" ON public.job_templates;
--> statement-breakpoint
CREATE POLICY "job templates read" ON public.job_templates FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline'));
--> statement-breakpoint
DROP POLICY IF EXISTS "job templates write" ON public.job_templates;
--> statement-breakpoint
CREATE POLICY "job templates write" ON public.job_templates FOR ALL TO authenticated
  USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
--> statement-breakpoint

-- Which jobs are linked to QuickBooks, for the badge on the job list. The link table itself stays readable only by
-- the people who manage integrations or the catalogue; this gives everyone who sees the job list the yes/no and nothing else.
CREATE OR REPLACE FUNCTION public.project_qbo_links()
RETURNS TABLE (project_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id
    FROM public.sync_links l
    JOIN public.projects p ON p.id::text = l.bmd_id
   WHERE l.kind = 'project' AND l.system = 'quickbooks' AND public.has_capability('view_pipeline');
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.project_qbo_links() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.project_qbo_links() TO authenticated;
--> statement-breakpoint

-- New job from the form: a client job goes through create_pipeline_project unchanged (so whatever that function
-- learns later still applies), then gets its kind, starting stage, standard tasks and site contacts.
-- An internal job needs no client and starts as open work.
CREATE OR REPLACE FUNCTION public.create_project_from_form(_p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pid uuid; my_role public.app_role; s jsonb; c jsonb; ci int := 0; cname text;
  k text := coalesce(nullif(_p->>'kind', ''), 'client');
  st text := coalesce(nullif(_p->>'stage', ''), CASE WHEN coalesce(nullif(_p->>'kind', ''), 'client') = 'internal' THEN 'in_progress' ELSE 'opportunity' END);
  tasks text[];
BEGIN
  IF NOT public.has_capability('manage_projects') THEN RAISE EXCEPTION 'Not allowed to create projects'; END IF;
  IF k NOT IN ('client','internal') THEN RAISE EXCEPTION 'Unknown kind of job'; END IF;
  IF st NOT IN ('opportunity','estimating','quote_out','won','in_progress') THEN RAISE EXCEPTION 'A new job cannot start in that stage'; END IF;
  IF k = 'internal' AND st <> 'in_progress' THEN RAISE EXCEPTION 'An internal job starts In progress'; END IF;

  IF k = 'client' THEN
    pid := public.create_pipeline_project(_p);
    IF st <> 'opportunity' THEN
      PERFORM set_config('bmd.stage_note', 'Starting stage chosen when the job was created', true);
      UPDATE public.projects SET stage = st::public.project_stage WHERE id = pid;
      PERFORM set_config('bmd.stage_note', '', true);
    END IF;
  ELSE
    IF coalesce(btrim(_p->>'name'), '') = '' THEN RAISE EXCEPTION 'Project name is required'; END IF;
    SELECT cl.name INTO cname FROM public.clients cl WHERE cl.id = nullif(_p->>'client_id', '')::uuid;
    INSERT INTO public.projects (name, client_id, client_name, address, street, city, province, postal_code, notes, stage, job_type, kind)
    VALUES (btrim(_p->>'name'), CASE WHEN cname IS NULL THEN NULL ELSE (_p->>'client_id')::uuid END, cname, nullif(btrim(_p->>'address'), ''),
            nullif(btrim(_p->>'street'), ''), nullif(btrim(_p->>'city'), ''), nullif(btrim(_p->>'province'), ''),
            nullif(btrim(_p->>'postal_code'), ''), nullif(btrim(_p->>'notes'), ''), st::public.project_stage,
            nullif(btrim(_p->>'job_type'), ''), 'internal')
    RETURNING id INTO pid;
    FOR s IN SELECT * FROM jsonb_array_elements(coalesce(_p->'scopes', '[]')) LOOP
      INSERT INTO public.project_scopes (project_id, scope, other_text)
      VALUES (pid, s->>'scope', nullif(btrim(s->>'other_text'), '')) ON CONFLICT DO NOTHING;
    END LOOP;
    IF NOT public.is_super_admin(auth.uid()) THEN
      SELECT m.role INTO my_role FROM public.project_members m
        JOIN public.role_permissions rp ON rp.role = m.role AND rp.capability = 'manage_projects' AND rp.allowed
       WHERE m.user_id = auth.uid() LIMIT 1;
      IF my_role IS NOT NULL THEN
        INSERT INTO public.project_members (project_id, user_id, role, added_by)
        VALUES (pid, auth.uid(), my_role, auth.uid()) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    IF nullif(_p->>'project_lead_id', '') IS NOT NULL THEN
      PERFORM public.set_project_job_role(pid, 'project_lead', (_p->>'project_lead_id')::uuid);
    END IF;
  END IF;

  SELECT coalesce(array_agg(t ORDER BY n), '{}') INTO tasks
    FROM (SELECT left(btrim(x), 200) AS t, n FROM jsonb_array_elements_text(coalesce(_p->'standard_tasks', '[]')) WITH ORDINALITY AS e(x, n)
           WHERE btrim(x) <> '' LIMIT 50) q;
  UPDATE public.projects SET kind = k, standard_tasks = tasks WHERE id = pid;

  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(_p->'contacts', '[]')) LOOP
    CONTINUE WHEN coalesce(btrim(c->>'name'), '') = '' AND coalesce(btrim(c->>'email'), '') = '' AND coalesce(btrim(c->>'phone'), '') = '';
    ci := ci + 1;
    INSERT INTO public.project_contacts (project_id, kind, name, email, phone_mobile, is_primary, sort_order)
    VALUES (pid, coalesce(nullif(c->>'kind', ''), 'other'), nullif(btrim(c->>'name'), ''), nullif(btrim(c->>'email'), ''),
            nullif(btrim(c->>'phone'), ''), false, ci);
  END LOOP;
  RETURN pid;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_project_from_form(jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_project_from_form(jsonb) TO authenticated;
