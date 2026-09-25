DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
CREATE POLICY "profiles read scoped" ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.is_super_admin(auth.uid())
  OR EXISTS (SELECT 1 FROM public.project_members m
             WHERE m.user_id = profiles.id AND public.has_capability('manage_users', m.project_id))
);

DROP POLICY IF EXISTS "roles readable by authenticated" ON public.user_roles;
CREATE POLICY "roles read own or super" ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "perms read" ON public.role_permissions;
CREATE POLICY "perms read own roles" ON public.role_permissions FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR public.has_capability('manage_users')
  OR role IN (SELECT m.role FROM public.project_members m WHERE m.user_id = auth.uid())
);

-- Emails only for yourself or people who manage users on that job
CREATE OR REPLACE FUNCTION public.project_people(_project uuid)
 RETURNS TABLE(id uuid, email text, full_name text, company text, role app_role)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE mgr boolean;
BEGIN
  IF NOT public.is_project_member(_project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  mgr := public.has_capability('manage_users', _project);
  RETURN QUERY
  SELECT p.id, CASE WHEN mgr OR p.id = auth.uid() THEN p.email END, p.full_name, p.company, m.role
  FROM public.project_members m JOIN public.profiles p ON p.id = m.user_id
  WHERE m.project_id = _project
  ORDER BY coalesce(p.full_name, p.email);
END; $function$;

-- Names for history/authors on a job: members plus super admins, emails masked the same way
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
     OR public.is_super_admin(p.id);
END; $function$;
GRANT EXECUTE ON FUNCTION public.project_directory(uuid) TO authenticated;