ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS province text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS po_number text,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS target_date date,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS building_type text;

CREATE TABLE public.project_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'client' CHECK (kind IN ('client','gc','site','other')),
  name text, company text, title text, email text, phone_mobile text, phone_office text,
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_contacts TO authenticated;
GRANT ALL ON public.project_contacts TO service_role;
ALTER TABLE public.project_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts read" ON public.project_contacts FOR SELECT TO authenticated USING (public.is_project_member(project_id));
CREATE POLICY "contacts write" ON public.project_contacts FOR ALL TO authenticated
  USING (public.has_capability('manage_settings', project_id)) WITH CHECK (public.has_capability('manage_settings', project_id));

CREATE TABLE public.project_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scope text NOT NULL,
  other_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, scope)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_scopes TO authenticated;
GRANT ALL ON public.project_scopes TO service_role;
ALTER TABLE public.project_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scopes read" ON public.project_scopes FOR SELECT TO authenticated USING (public.is_project_member(project_id));
CREATE POLICY "scopes write" ON public.project_scopes FOR ALL TO authenticated
  USING (public.has_capability('manage_settings', project_id)) WITH CHECK (public.has_capability('manage_settings', project_id));

CREATE TABLE public.job_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text,
  step integer NOT NULL DEFAULT 1,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_drafts TO authenticated;
GRANT ALL ON public.job_drafts TO service_role;
ALTER TABLE public.job_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own drafts" ON public.job_drafts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.create_job(_job jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; my_role public.app_role; f jsonb; r jsonb; fid uuid; fi int := 0; ri int; c jsonb; ci int := 0; s jsonb; pl jsonb; pi int := 0;
BEGIN
  IF NOT public.has_capability('manage_settings') THEN RAISE EXCEPTION 'Not allowed to create jobs'; END IF;
  IF coalesce(trim(_job->>'name'),'') = '' THEN RAISE EXCEPTION 'Job name is required'; END IF;
  IF coalesce(trim(_job->>'client_company'),'') = '' THEN RAISE EXCEPTION 'Client company is required'; END IF;
  IF jsonb_array_length(coalesce(_job->'floors','[]')) = 0 THEN RAISE EXCEPTION 'Add at least one floor'; END IF;

  INSERT INTO public.projects (name, client_name, address, street, city, province, postal_code, po_number, start_date, target_date, notes, building_type)
  VALUES (trim(_job->>'name'), trim(_job->>'client_company'), nullif(trim(_job->>'address'),''),
    nullif(trim(_job->>'street'),''), nullif(trim(_job->>'city'),''), nullif(trim(_job->>'province'),''), nullif(trim(_job->>'postal_code'),''),
    nullif(trim(_job->>'po_number'),''), nullif(_job->>'start_date','')::date, nullif(_job->>'target_date','')::date,
    nullif(trim(_job->>'notes'),''), nullif(_job->>'building_type',''))
  RETURNING id INTO pid;

  -- Replace the generic defaults with the scope-driven lists
  IF jsonb_array_length(coalesce(_job->'pick_lists','[]')) > 0 THEN
    DELETE FROM public.pick_lists WHERE project_id = pid;
    FOR pl IN SELECT * FROM jsonb_array_elements(_job->'pick_lists') LOOP
      pi := pi + 1;
      INSERT INTO public.pick_lists (project_id, kind, value, sort_order)
      VALUES (pid, (pl->>'kind')::public.pick_kind, pl->>'value', pi);
    END LOOP;
  END IF;

  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(_job->'contacts','[]')) LOOP
    ci := ci + 1;
    INSERT INTO public.project_contacts (project_id, kind, name, company, title, email, phone_mobile, phone_office, is_primary, sort_order)
    VALUES (pid, coalesce(c->>'kind','client'), nullif(trim(c->>'name'),''), nullif(trim(c->>'company'),''), nullif(trim(c->>'title'),''),
      nullif(trim(c->>'email'),''), nullif(trim(c->>'phone_mobile'),''), nullif(trim(c->>'phone_office'),''), coalesce((c->>'is_primary')::boolean,false), ci);
  END LOOP;

  FOR s IN SELECT * FROM jsonb_array_elements(coalesce(_job->'scopes','[]')) LOOP
    INSERT INTO public.project_scopes (project_id, scope, other_text)
    VALUES (pid, s->>'scope', nullif(trim(s->>'other_text'),'')) ON CONFLICT DO NOTHING;
  END LOOP;

  FOR f IN SELECT * FROM jsonb_array_elements(_job->'floors') LOOP
    fi := fi + 1;
    INSERT INTO public.floors (project_id, number, label, sort_order)
    VALUES (pid, (f->>'number')::int, trim(f->>'label'), fi) RETURNING id INTO fid;
    ri := 0;
    FOR r IN SELECT * FROM jsonb_array_elements(coalesce(f->'locations','[]')) LOOP
      ri := ri + 1;
      INSERT INTO public.locations (floor_id, type, name, room_type, sort_order)
      VALUES (fid, (r->>'type')::public.location_type, r->>'name', nullif(r->>'room_type',''), ri);
    END LOOP;
  END LOOP;

  IF NOT public.is_super_admin(auth.uid()) THEN
    SELECT m.role INTO my_role FROM public.project_members m
      JOIN public.role_permissions rp ON rp.role = m.role AND rp.capability = 'manage_settings' AND rp.allowed
      WHERE m.user_id = auth.uid() LIMIT 1;
    INSERT INTO public.project_members (project_id, user_id, role, added_by) VALUES (pid, auth.uid(), my_role, auth.uid());
  END IF;
  RETURN pid;
END; $$;
REVOKE ALL ON FUNCTION public.create_job(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_job(jsonb) TO authenticated;