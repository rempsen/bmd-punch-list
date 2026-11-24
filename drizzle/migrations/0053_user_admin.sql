-- User administration: every person has a company level and job access (all jobs, or selected jobs).
-- A job row either follows the person's level (role_source 'level') or is a per-job exception ('job').
-- Deactivated people keep their rows but every access check refuses them until they are reactivated.

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_access (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  level public.app_role NOT NULL DEFAULT 'viewer',
  all_jobs boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deactivated')),
  deactivated_at timestamptz,
  deactivated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
--> statement-breakpoint
ALTER TABLE public.user_access ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.user_admin_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email text,
  actor uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.user_admin_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_admin_log_user_idx ON public.user_admin_log (user_id, at DESC);
--> statement-breakpoint
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS role_source text CHECK (role_source IN ('level','job'));
--> statement-breakpoint
ALTER TABLE public.user_invites ADD COLUMN IF NOT EXISTS level public.app_role;
--> statement-breakpoint
ALTER TABLE public.user_invites ADD COLUMN IF NOT EXISTS all_jobs boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE public.user_invites ADD COLUMN IF NOT EXISTS jobs jsonb NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE public.user_invites DROP CONSTRAINT IF EXISTS user_invites_status_check;
--> statement-breakpoint
ALTER TABLE public.user_invites ADD CONSTRAINT user_invites_status_check CHECK (status IN ('pending','accepted','expired','cancelled'));
--> statement-breakpoint
-- A cancelled invite must not block a new one to the same address.
DROP INDEX IF EXISTS public.user_invites_email_project_open;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS user_invites_email_project_open ON public.user_invites (lower(email), project_id) WHERE accepted_at IS NULL AND status = 'pending';
--> statement-breakpoint

-- ── Backfill: nobody's access changes ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.role_rank(_r public.app_role)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _r WHEN 'super_admin' THEN 1 WHEN 'bmd_admin' THEN 1 WHEN 'bmd_manager' THEN 2 WHEN 'bmd_field' THEN 3
                 WHEN 'client' THEN 4 WHEN 'trade' THEN 5 ELSE 6 END;
$$;
--> statement-breakpoint
INSERT INTO public.user_access (user_id, level, all_jobs)
SELECT p.id,
  CASE WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role IN ('super_admin','bmd_admin')) THEN 'super_admin'::public.app_role
       ELSE coalesce((SELECT m.role FROM public.project_members m WHERE m.user_id = p.id ORDER BY public.role_rank(m.role), m.created_at LIMIT 1), 'viewer') END,
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role IN ('super_admin','bmd_admin'))
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;
--> statement-breakpoint
UPDATE public.project_members m SET role_source = CASE WHEN m.role = a.level THEN 'level' ELSE 'job' END
FROM public.user_access a WHERE a.user_id = m.user_id AND m.role_source IS NULL;
--> statement-breakpoint
UPDATE public.project_members SET role_source = 'job' WHERE role_source IS NULL;
--> statement-breakpoint
ALTER TABLE public.project_members ALTER COLUMN role_source SET NOT NULL;
--> statement-breakpoint

-- ── Keeping rows consistent ─────────────────────────────────────────────────────────────────────────────────────
-- Every new profile gets an access row (viewer, no jobs) until someone sets it.
CREATE OR REPLACE FUNCTION public.profiles_add_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_access (user_id) VALUES (new.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS profiles_add_access ON public.profiles;
--> statement-breakpoint
CREATE TRIGGER profiles_add_access AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_add_access();
--> statement-breakpoint
-- A job row with no role, or with the person's own level, follows the level; any other role is an exception.
-- Rows that follow the level always carry it in `role`, so older code that reads project_members.role stays right.
CREATE OR REPLACE FUNCTION public.project_members_role_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lvl public.app_role;
BEGIN
  SELECT a.level INTO lvl FROM public.user_access a WHERE a.user_id = new.user_id;
  IF TG_OP = 'INSERT' THEN
    IF new.role IS NULL THEN new.role_source := 'level';
    ELSIF new.role_source IS NULL THEN new.role_source := CASE WHEN new.role = lvl THEN 'level' ELSE 'job' END;
    END IF;
  ELSIF new.role IS DISTINCT FROM old.role AND new.role_source IS NOT DISTINCT FROM old.role_source THEN
    new.role_source := CASE WHEN new.role = lvl THEN 'level' ELSE 'job' END;
  END IF;
  IF new.role_source = 'level' THEN new.role := coalesce(lvl, new.role, 'viewer'); END IF;
  RETURN new;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_members_role_source ON public.project_members;
--> statement-breakpoint
CREATE TRIGGER project_members_role_source BEFORE INSERT OR UPDATE ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.project_members_role_source();
--> statement-breakpoint

-- ── The permission core ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_active(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_access WHERE user_id = _user_id AND status = 'deactivated');
$$;
--> statement-breakpoint
-- Holds the super admin role, whether or not they are active (for guards).
CREATE OR REPLACE FUNCTION public.is_super_role(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('super_admin','bmd_admin'));
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_role(_user_id) AND public.is_active(_user_id);
$$;
--> statement-breakpoint
-- The role a person holds on a job, ignoring whether they are deactivated (shows set-aside access).
CREATE OR REPLACE FUNCTION public.effective_role_raw(_user_id uuid, _project uuid)
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.is_super_role(_user_id) THEN 'super_admin'::public.app_role
    ELSE coalesce(
      (SELECT CASE WHEN m.role_source = 'level' THEN coalesce(a.level, m.role) ELSE m.role END
         FROM public.project_members m LEFT JOIN public.user_access a ON a.user_id = m.user_id
        WHERE m.project_id = _project AND m.user_id = _user_id),
      (SELECT a.level FROM public.user_access a
        WHERE a.user_id = _user_id AND a.all_jobs AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project)))
  END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.effective_role(_user_id uuid, _project uuid)
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.is_active(_user_id) THEN public.effective_role_raw(_user_id, _project) END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.is_project_member(_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.effective_role(auth.uid(), _project) IS NOT NULL;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.has_capability(_capability text, _project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.role_permissions rp
     WHERE rp.role = public.effective_role(auth.uid(), _project) AND rp.capability = _capability AND rp.allowed);
$$;
--> statement-breakpoint
-- On any job: a job role (exception or level) or, with all-jobs access, the level itself.
CREATE OR REPLACE FUNCTION public.has_capability(_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(auth.uid()) OR (public.is_active(auth.uid()) AND EXISTS (
    SELECT 1 FROM public.role_permissions rp
     WHERE rp.capability = _capability AND rp.allowed AND rp.role IN (
       SELECT CASE WHEN m.role_source = 'level' THEN coalesce(a.level, m.role) ELSE m.role END
         FROM public.project_members m LEFT JOIN public.user_access a ON a.user_id = m.user_id
        WHERE m.user_id = auth.uid()
       UNION ALL
       SELECT a.level FROM public.user_access a WHERE a.user_id = auth.uid() AND a.all_jobs)));
$$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.my_projects();
--> statement-breakpoint
CREATE FUNCTION public.my_projects()
RETURNS TABLE (id uuid, name text, client_name text, address text, archived_at timestamptz, role public.app_role, open_count bigint, has_site boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.client_name, p.address, p.archived_at, r.role,
    (SELECT count(*) FROM public.deficiencies d WHERE d.project_id = p.id AND d.status NOT IN ('verified','accepted_as_is')),
    EXISTS (SELECT 1 FROM public.floors f WHERE f.project_id = p.id)
  FROM public.projects p
  CROSS JOIN LATERAL (SELECT public.effective_role(auth.uid(), p.id) AS role) r
  WHERE r.role IS NOT NULL
  ORDER BY p.archived_at NULLS FIRST, p.created_at;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.my_projects() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.my_projects() TO authenticated;
--> statement-breakpoint

-- ── Job people lists, now including all-jobs people ─────────────────────────────────────────────────────────────
-- Everyone who can reach a job (active), with their role there and where it comes from.
CREATE OR REPLACE FUNCTION public.job_people(_project uuid)
RETURNS TABLE (user_id uuid, role public.app_role, access text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT x.user_id, public.effective_role(x.user_id, _project), x.access FROM (
    SELECT m.user_id, CASE WHEN m.role_source = 'job' THEN 'job' WHEN a.all_jobs THEN 'all_jobs' ELSE 'level' END AS access
      FROM public.project_members m LEFT JOIN public.user_access a ON a.user_id = m.user_id WHERE m.project_id = _project
    UNION
    SELECT a.user_id, 'all_jobs' FROM public.user_access a
     WHERE a.all_jobs AND NOT EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = _project AND m.user_id = a.user_id)
  ) x WHERE public.effective_role(x.user_id, _project) IS NOT NULL;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.job_people(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.project_people(_project uuid)
 RETURNS TABLE(id uuid, email text, full_name text, company text, role public.app_role)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE mgr boolean;
BEGIN
  IF NOT public.is_project_member(_project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  mgr := public.has_capability('manage_users', _project);
  RETURN QUERY
  SELECT p.id, CASE WHEN mgr OR p.id = auth.uid() THEN p.email END, p.full_name, p.company, j.role
  FROM public.job_people(_project) j JOIN public.profiles p ON p.id = j.user_id
  ORDER BY coalesce(p.full_name, p.email);
END; $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.project_directory(_project uuid)
 RETURNS TABLE(id uuid, email text, full_name text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE mgr boolean;
BEGIN
  IF NOT public.is_project_member(_project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  mgr := public.has_capability('manage_users', _project);
  RETURN QUERY
  SELECT p.id, CASE WHEN mgr OR p.id = auth.uid() THEN p.email END, p.full_name
  FROM public.profiles p
  WHERE EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = _project AND m.user_id = p.id)
     OR EXISTS (SELECT 1 FROM public.user_access a WHERE a.user_id = p.id AND a.all_jobs)
     OR public.is_super_role(p.id);
END; $function$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.list_users(uuid);
--> statement-breakpoint
CREATE FUNCTION public.list_users(_project uuid)
RETURNS TABLE(id uuid, email text, full_name text, company text, role public.app_role, is_super boolean, last_sign_in_at timestamptz, access text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _project IS NULL THEN
    IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  ELSIF NOT public.has_capability('manage_users', _project) THEN RAISE EXCEPTION 'Not allowed';
  END IF;
  RETURN QUERY
  SELECT p.id, p.email, p.full_name, p.company, j.role, public.is_super_role(p.id), u.last_sign_in_at, j.access
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.job_people(_project) j ON j.user_id = p.id
  WHERE _project IS NULL OR j.user_id IS NOT NULL
  ORDER BY p.created_at;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_users(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.list_users(uuid) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bmd_staff()
RETURNS TABLE (id uuid, full_name text, email text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('view_pipeline') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.email FROM public.profiles p
  WHERE public.is_active(p.id) AND (
        public.is_super_role(p.id)
     OR EXISTS (SELECT 1 FROM public.user_access a WHERE a.user_id = p.id AND a.level IN ('super_admin','bmd_admin','bmd_manager','bmd_field'))
     OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.user_id = p.id AND m.role IN ('super_admin','bmd_admin','bmd_manager','bmd_field')))
  ORDER BY coalesce(p.full_name, p.email);
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_project_job_role(_project uuid, _job_role public.job_role, _user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.app_role;
BEGIN
  IF NOT public.has_capability('manage_projects') THEN RAISE EXCEPTION 'Not allowed to assign staff'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = _project) THEN RAISE EXCEPTION 'Project not found'; END IF;
  UPDATE public.project_members SET job_roles = array_remove(job_roles, _job_role)
   WHERE project_id = _project AND _job_role = ANY (job_roles) AND user_id IS DISTINCT FROM _user;
  IF _user IS NULL THEN RETURN; END IF;
  IF NOT public.is_active(_user) THEN RAISE EXCEPTION 'This person is deactivated'; END IF;
  IF public.is_super_role(_user) THEN r := 'super_admin';
  ELSE
    SELECT a.level INTO r FROM public.user_access a WHERE a.user_id = _user AND a.level IN ('bmd_manager','bmd_admin','bmd_field');
    IF r IS NULL THEN
      SELECT m.role INTO r FROM public.project_members m
       WHERE m.user_id = _user AND m.role IN ('bmd_manager','bmd_admin','bmd_field')
       ORDER BY public.role_rank(m.role) LIMIT 1;
    END IF;
    IF r IS NULL THEN RAISE EXCEPTION 'Only BMD staff can be assigned'; END IF;
  END IF;
  -- An assignment is not an access exception: a new row follows the level when the role matches it.
  INSERT INTO public.project_members (project_id, user_id, role, added_by, job_roles)
  VALUES (_project, _user, r, auth.uid(), ARRAY[_job_role])
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET job_roles = CASE WHEN _job_role = ANY (public.project_members.job_roles) THEN public.project_members.job_roles
                         ELSE public.project_members.job_roles || _job_role END;
END; $$;
--> statement-breakpoint

-- ── Policies that read roles directly ───────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "perms read own roles" ON public.role_permissions;
--> statement-breakpoint
CREATE POLICY "perms read own roles" ON public.role_permissions FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR public.has_capability('manage_users')
  OR (public.is_active(auth.uid()) AND (
        role IN (SELECT m.role FROM public.project_members m WHERE m.user_id = auth.uid())
     OR role IN (SELECT a.level FROM public.user_access a WHERE a.user_id = auth.uid())))
);
--> statement-breakpoint
DROP POLICY IF EXISTS "invites manage" ON public.user_invites;
--> statement-breakpoint
CREATE POLICY "invites manage" ON public.user_invites FOR ALL TO authenticated
  USING (public.has_capability('manage_users', project_id) OR (project_id IS NULL AND public.has_capability('manage_users')))
  WITH CHECK ((public.has_capability('manage_users', project_id) OR (project_id IS NULL AND public.has_capability('manage_users')))
         AND (public.is_super_admin(auth.uid()) OR role NOT IN ('super_admin','bmd_admin')));
--> statement-breakpoint
DROP POLICY IF EXISTS "access read" ON public.user_access;
--> statement-breakpoint
CREATE POLICY "access read" ON public.user_access FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_capability('manage_users'));
--> statement-breakpoint
GRANT SELECT ON public.user_access TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.effective_role(uuid, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.effective_role_raw(uuid, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- ── First sign-in: an invite becomes access ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.user_invites; j jsonb; lvl public.app_role;
BEGIN
  SELECT * INTO inv FROM public.user_invites
   WHERE lower(email) = lower(new.email) AND accepted_at IS NULL AND status = 'pending' AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  INSERT INTO public.profiles (id, email, full_name, company)
  VALUES (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), inv.full_name, split_part(new.email,'@',1)), inv.company)
  ON CONFLICT (id) DO NOTHING;

  -- The very first account runs the company.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role IN ('super_admin','bmd_admin')) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'super_admin') ON CONFLICT DO NOTHING;
    UPDATE public.user_access SET level = 'super_admin', all_jobs = true WHERE user_id = new.id;
  END IF;

  FOR inv IN SELECT * FROM public.user_invites
             WHERE lower(email) = lower(new.email) AND accepted_at IS NULL AND status = 'pending' AND expires_at > now()
             ORDER BY created_at LOOP
    lvl := CASE WHEN coalesce(inv.level, inv.role) = 'bmd_admin' THEN 'super_admin'::public.app_role ELSE coalesce(inv.level, inv.role) END;
    IF inv.level IS NOT NULL THEN
      -- Company invite: level and job access as chosen in the admin screen.
      UPDATE public.user_access SET level = lvl, all_jobs = inv.all_jobs OR lvl = 'super_admin', updated_by = inv.invited_by, updated_at = now()
       WHERE user_id = new.id;
      FOR j IN SELECT * FROM jsonb_array_elements(inv.jobs) LOOP
        INSERT INTO public.project_members (project_id, user_id, role, role_source, added_by)
        SELECT (j->>'project_id')::uuid, new.id, coalesce(nullif(j->>'role','')::public.app_role, lvl),
               CASE WHEN nullif(j->>'role','') IS NULL THEN 'level' ELSE 'job' END, inv.invited_by
         WHERE EXISTS (SELECT 1 FROM public.projects p WHERE p.id = (j->>'project_id')::uuid)
        ON CONFLICT (project_id, user_id) DO NOTHING;
      END LOOP;
    ELSE
      -- Job invite (from a job's Users tab): that job, and the role becomes their level if they had none.
      UPDATE public.user_access SET level = CASE WHEN public.role_rank(lvl) < public.role_rank(level) OR NOT EXISTS (
               SELECT 1 FROM public.project_members m WHERE m.user_id = new.id) THEN lvl ELSE level END
       WHERE user_id = new.id;
      IF inv.project_id IS NOT NULL THEN
        INSERT INTO public.project_members (project_id, user_id, role, added_by)
        VALUES (inv.project_id, new.id, lvl, inv.invited_by)
        ON CONFLICT (project_id, user_id) DO NOTHING;
      END IF;
    END IF;
    IF lvl = 'super_admin' THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'super_admin') ON CONFLICT DO NOTHING;
    END IF;
    UPDATE public.user_invites SET accepted_at = now(), status = 'accepted' WHERE id = inv.id;
  END LOOP;
  RETURN new;
END; $$;
--> statement-breakpoint

-- ── Admin actions ───────────────────────────────────────────────────────────────────────────────────────────────
-- Who may manage people, and the limits on what they may do.
CREATE OR REPLACE FUNCTION public.admin_assert(_target uuid, _new_level public.app_role)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL OR NOT public.is_active(me) OR NOT (public.is_super_admin(me) OR public.has_capability('manage_users')) THEN
    RAISE EXCEPTION 'You don''t have permission to manage users';
  END IF;
  IF _target IS NOT NULL AND public.is_super_role(_target) AND NOT public.is_super_admin(me) THEN
    RAISE EXCEPTION 'Only a super admin can change a super admin';
  END IF;
  IF _new_level IN ('super_admin','bmd_admin') AND NOT public.is_super_admin(me) THEN
    RAISE EXCEPTION 'Only a super admin can grant super admin';
  END IF;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.active_super_count()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(DISTINCT ur.user_id) FROM public.user_roles ur
   WHERE ur.role IN ('super_admin','bmd_admin') AND public.is_active(ur.user_id)
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = ur.user_id);
$$;
--> statement-breakpoint
-- Anything a person's name is on: items, photos, decisions, documents, history. Drafts and connections are theirs alone.
CREATE OR REPLACE FUNCTION public.user_has_records(_user uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; found boolean;
BEGIN
  FOR c IN
    SELECT col.table_name, col.column_name FROM information_schema.columns col
      JOIN information_schema.tables t ON t.table_schema = col.table_schema AND t.table_name = col.table_name AND t.table_type = 'BASE TABLE'
     WHERE col.table_schema = 'public' AND col.data_type = 'uuid'
       AND col.column_name IN ('created_by','created_by_user','uploaded_by','decided_by','assigned_to','changed_by','added_by','invited_by','verified_by','user_id','actor')
       AND col.table_name NOT IN ('user_access','user_admin_log','project_members','user_roles','profiles','user_invites','ms_connections','job_drafts')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I = $1)', c.table_name, c.column_name) INTO found USING _user;
    IF found THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.admin_log(_user uuid, _email text, _action text, _detail jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.user_admin_log (user_id, email, actor, action, detail) VALUES (_user, _email, auth.uid(), _action, coalesce(_detail, '{}'));
$$;
--> statement-breakpoint
-- Everyone with an account, plus open invites for people who have not signed up yet.
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (kind text, id uuid, email text, full_name text, company text, level public.app_role, all_jobs boolean, status text,
               is_super boolean, last_sign_in_at timestamptz, job_count bigint, jobs jsonb, invite_id uuid, invite_token text,
               invite_sent_at timestamptz, invite_error text, has_records boolean, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_assert(NULL, NULL);
  RETURN QUERY
  SELECT 'user'::text, p.id, p.email, p.full_name, p.company, coalesce(a.level, 'viewer'), coalesce(a.all_jobs, false),
         coalesce(a.status, 'active'), public.is_super_role(p.id), u.last_sign_in_at,
         (SELECT count(*) FROM public.project_members m WHERE m.user_id = p.id),
         NULL::jsonb, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text, public.user_has_records(p.id), p.created_at
    FROM public.profiles p
    LEFT JOIN public.user_access a ON a.user_id = p.id
    LEFT JOIN auth.users u ON u.id = p.id
  UNION ALL
  SELECT 'invite'::text, i.id, lower(i.email), i.full_name, i.company, coalesce(i.level, i.role), i.all_jobs,
         CASE WHEN i.status = 'expired' OR i.expires_at < now() THEN 'expired' ELSE 'invited' END, coalesce(i.level, i.role) IN ('super_admin','bmd_admin'),
         NULL::timestamptz,
         CASE WHEN i.level IS NULL THEN (CASE WHEN i.project_id IS NULL THEN 0 ELSE 1 END)::bigint ELSE jsonb_array_length(i.jobs)::bigint END,
         CASE WHEN i.level IS NULL THEN (CASE WHEN i.project_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('project_id', i.project_id, 'role', NULL)) END) ELSE i.jobs END,
         i.id, i.invite_token, i.sent_at, i.last_error, false, i.created_at
    FROM public.user_invites i
   WHERE i.accepted_at IS NULL AND i.status IN ('pending','expired')
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE lower(p.email) = lower(i.email))
     AND i.id = (SELECT i2.id FROM public.user_invites i2 WHERE lower(i2.email) = lower(i.email) AND i2.accepted_at IS NULL AND i2.status IN ('pending','expired')
                  ORDER BY i2.created_at DESC LIMIT 1);
END; $$;
--> statement-breakpoint
-- A person's jobs and the role they hold on each (access set aside while deactivated still shows).
CREATE OR REPLACE FUNCTION public.admin_user_jobs(_user uuid)
RETURNS TABLE (project_id uuid, name text, archived_at timestamptz, role public.app_role, source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_assert(NULL, NULL);
  RETURN QUERY
  SELECT p.id, p.name, p.archived_at, public.effective_role_raw(_user, p.id),
         coalesce((SELECT m.role_source FROM public.project_members m WHERE m.project_id = p.id AND m.user_id = _user), 'all_jobs')
    FROM public.projects p
   WHERE public.effective_role_raw(_user, p.id) IS NOT NULL
   ORDER BY p.archived_at NULLS FIRST, p.name;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.admin_user_log(_user uuid)
RETURNS TABLE (at timestamptz, actor_name text, action text, detail jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_assert(NULL, NULL);
  RETURN QUERY
  SELECT l.at, coalesce(p.full_name, p.email, 'Someone'), l.action, l.detail
    FROM public.user_admin_log l LEFT JOIN public.profiles p ON p.id = l.actor
   WHERE l.user_id = _user
   ORDER BY l.at DESC LIMIT 50;
END; $$;
--> statement-breakpoint
-- Saves a person's profile, level and job access in one step. _jobs: [{project_id, role}], role null = follow the level.
-- With all-jobs access, _jobs lists only the exceptions; with selected jobs it is the full list.
CREATE OR REPLACE FUNCTION public.admin_save_user(_user uuid, _full_name text, _company text, _level public.app_role, _all_jobs boolean, _jobs jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); want_super boolean := _level IN ('super_admin','bmd_admin'); em text;
BEGIN
  PERFORM public.admin_assert(_user, _level);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_jobs, '[]')) j WHERE j->>'role' IN ('super_admin','bmd_admin')) THEN
    PERFORM public.admin_assert(_user, 'super_admin');
  END IF;
  SELECT email INTO em FROM public.profiles WHERE id = _user;
  IF em IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF NOT want_super AND public.is_super_role(_user) AND public.is_active(_user) AND public.active_super_count() <= 1 THEN
    RAISE EXCEPTION 'BMD needs at least one active super admin';
  END IF;
  IF want_super THEN _level := 'super_admin'; _all_jobs := true; END IF;

  UPDATE public.profiles SET full_name = coalesce(nullif(btrim(_full_name), ''), full_name), company = nullif(btrim(coalesce(_company, '')), '')
   WHERE id = _user;
  INSERT INTO public.user_access (user_id, level, all_jobs, updated_at, updated_by) VALUES (_user, _level, _all_jobs, now(), me)
  ON CONFLICT (user_id) DO UPDATE SET level = EXCLUDED.level, all_jobs = EXCLUDED.all_jobs, updated_at = now(), updated_by = me;

  IF want_super THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user, 'super_admin') ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _user AND role IN ('super_admin','bmd_admin');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _admin_jobs (project_id uuid PRIMARY KEY, role public.app_role) ON COMMIT DROP;
  DELETE FROM _admin_jobs;
  INSERT INTO _admin_jobs SELECT DISTINCT ON ((j->>'project_id')::uuid) (j->>'project_id')::uuid, nullif(j->>'role', '')::public.app_role
    FROM jsonb_array_elements(coalesce(_jobs, '[]')) j;

  IF _all_jobs THEN
    -- Everything not listed follows the level again (assignments such as estimator are kept).
    UPDATE public.project_members m SET role_source = 'level'
     WHERE m.user_id = _user AND m.role_source = 'job' AND NOT EXISTS (SELECT 1 FROM _admin_jobs x WHERE x.project_id = m.project_id AND x.role IS NOT NULL);
  ELSE
    DELETE FROM public.project_members m WHERE m.user_id = _user AND NOT EXISTS (SELECT 1 FROM _admin_jobs x WHERE x.project_id = m.project_id);
  END IF;
  INSERT INTO public.project_members (project_id, user_id, role, role_source, added_by)
  SELECT x.project_id, _user, coalesce(x.role, _level), CASE WHEN x.role IS NULL THEN 'level' ELSE 'job' END, me
    FROM _admin_jobs x
   WHERE NOT want_super AND (NOT _all_jobs OR x.role IS NOT NULL)
  ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, role_source = EXCLUDED.role_source;
  -- Rows that follow the level carry the new level.
  UPDATE public.project_members SET role = _level WHERE user_id = _user AND role_source = 'level' AND role IS DISTINCT FROM _level;

  PERFORM public.admin_log(_user, em, 'saved', jsonb_build_object('level', _level, 'all_jobs', _all_jobs, 'jobs', coalesce(_jobs, '[]')));
END; $$;
--> statement-breakpoint
-- Deactivate locks a person out everywhere (the auth ban is applied by the server); reactivate gives everything back.
CREATE OR REPLACE FUNCTION public.admin_set_status(_user uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE em text;
BEGIN
  IF _status NOT IN ('active','deactivated') THEN RAISE EXCEPTION 'Unknown status'; END IF;
  PERFORM public.admin_assert(_user, NULL);
  SELECT email INTO em FROM public.profiles WHERE id = _user;
  IF em IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF _status = 'deactivated' THEN
    IF _user = auth.uid() THEN RAISE EXCEPTION 'You can''t deactivate yourself'; END IF;
    IF public.is_super_role(_user) AND public.is_active(_user) AND public.active_super_count() <= 1 THEN
      RAISE EXCEPTION 'BMD needs at least one active super admin';
    END IF;
  END IF;
  INSERT INTO public.user_access (user_id) VALUES (_user) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.user_access SET status = _status,
         deactivated_at = CASE WHEN _status = 'deactivated' THEN now() END,
         deactivated_by = CASE WHEN _status = 'deactivated' THEN auth.uid() END,
         updated_at = now(), updated_by = auth.uid()
   WHERE user_id = _user;
  IF _status = 'deactivated' THEN
    UPDATE public.user_invites SET status = 'cancelled' WHERE lower(email) = lower(em) AND status = 'pending' AND accepted_at IS NULL;
  END IF;
  PERFORM public.admin_log(_user, em, CASE WHEN _status = 'deactivated' THEN 'deactivated' ELSE 'reactivated' END, '{}');
END; $$;
--> statement-breakpoint
-- The database half of "Delete permanently". Only for a deactivated person whose name is on nothing.
CREATE OR REPLACE FUNCTION public.admin_delete_user_data(_user uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE em text; nm text;
BEGIN
  PERFORM public.admin_assert(_user, NULL);
  IF _user = auth.uid() THEN RAISE EXCEPTION 'You can''t delete yourself'; END IF;
  SELECT email, full_name INTO em, nm FROM public.profiles WHERE id = _user;
  IF em IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF public.is_active(_user) THEN RAISE EXCEPTION 'Deactivate first'; END IF;
  IF public.user_has_records(_user) THEN RAISE EXCEPTION 'Has records on jobs; keep them deactivated'; END IF;
  DELETE FROM public.project_members WHERE user_id = _user;
  DELETE FROM public.user_roles WHERE user_id = _user;
  DELETE FROM public.user_invites WHERE lower(email) = lower(em);
  DELETE FROM public.ms_connections WHERE user_id = _user;
  IF to_regclass('public.job_drafts') IS NOT NULL THEN EXECUTE 'DELETE FROM public.job_drafts WHERE user_id = $1' USING _user; END IF;
  DELETE FROM public.profiles WHERE id = _user;
  PERFORM public.admin_log(_user, em, 'deleted', jsonb_build_object('name', nm));
  RETURN em;
END; $$;
--> statement-breakpoint
-- An invite to someone without an account. _jobs as in admin_save_user. Earlier open invites to the same address are cancelled.
CREATE OR REPLACE FUNCTION public.admin_invite(_email text, _full_name text, _company text, _level public.app_role, _all_jobs boolean, _jobs jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e text := lower(btrim(coalesce(_email, ''))); want_super boolean := _level IN ('super_admin','bmd_admin'); iid uuid; first_job uuid;
BEGIN
  PERFORM public.admin_assert(NULL, _level);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_jobs, '[]')) j WHERE j->>'role' IN ('super_admin','bmd_admin')) THEN
    PERFORM public.admin_assert(NULL, 'super_admin');
  END IF;
  IF e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid email address'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = e) THEN
    RAISE EXCEPTION 'This person already has an account. Find them in the list to change their access.';
  END IF;
  IF want_super THEN _level := 'super_admin'; _all_jobs := true; _jobs := '[]'; END IF;
  IF NOT _all_jobs AND jsonb_array_length(coalesce(_jobs, '[]')) = 0 THEN RAISE EXCEPTION 'Choose at least one job, or give access to all jobs'; END IF;
  SELECT (j->>'project_id')::uuid INTO first_job FROM jsonb_array_elements(coalesce(_jobs, '[]')) j LIMIT 1;
  UPDATE public.user_invites SET status = 'cancelled' WHERE lower(email) = e AND status = 'pending' AND accepted_at IS NULL;
  INSERT INTO public.user_invites (email, full_name, company, role, invited_by, project_id, level, all_jobs, jobs)
  VALUES (e, nullif(btrim(coalesce(_full_name, '')), ''), nullif(btrim(coalesce(_company, '')), ''), _level, auth.uid(),
          first_job, _level, _all_jobs, coalesce(_jobs, '[]'))
  RETURNING id INTO iid;
  PERFORM public.admin_log(NULL, e, 'invited', jsonb_build_object('level', _level, 'all_jobs', _all_jobs, 'jobs', coalesce(_jobs, '[]')));
  RETURN iid;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.admin_cancel_invite(_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.user_invites;
BEGIN
  SELECT * INTO inv FROM public.user_invites WHERE id = _invite;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invite not found'; END IF;
  PERFORM public.admin_assert(NULL, coalesce(inv.level, inv.role));
  UPDATE public.user_invites SET status = 'cancelled' WHERE id = _invite AND accepted_at IS NULL;
  PERFORM public.admin_log(NULL, lower(inv.email), 'invite_cancelled', '{}');
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_assert(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_log(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.user_has_records(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_user_jobs(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_user_jobs(uuid) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_user_log(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_user_log(uuid) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_save_user(uuid, text, text, public.app_role, boolean, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_save_user(uuid, text, text, public.app_role, boolean, jsonb) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_set_status(uuid, text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_set_status(uuid, text) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_delete_user_data(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_delete_user_data(uuid) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_invite(text, text, text, public.app_role, boolean, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_invite(text, text, text, public.app_role, boolean, jsonb) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_cancel_invite(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_cancel_invite(uuid) TO authenticated;
