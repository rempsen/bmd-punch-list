-- Supabase runs with safeupdate, which rejects a DELETE that has no WHERE clause, so saving a person failed.
-- Same function as 0053 with the scratch-table clear given an explicit WHERE.
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
  DELETE FROM _admin_jobs WHERE true;
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
