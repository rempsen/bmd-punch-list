-- Follow-up to 0054 (Codex review on PR #14): staff invited from a job's Users tab carry no company level, so they
-- signed in with all-jobs off. Every path that creates access now applies the 24 Nov 2026 rule.
-- The rule itself, so every path that creates access applies it (company invites, job-tab invites, first sign-in).
CREATE OR REPLACE FUNCTION public.staff_all_jobs(_level public.app_role)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _level IN ('super_admin','bmd_admin','bmd_manager','bmd_field');
$$;
--> statement-breakpoint
-- Job-tab invites carry no company level; give staff every job when their invite is accepted.
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
      UPDATE public.user_access SET level = lvl, all_jobs = inv.all_jobs OR public.staff_all_jobs(lvl), updated_by = inv.invited_by, updated_at = now()
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
      -- Staff invited from a job's Users tab still get every job (24 Nov 2026 rule).
      UPDATE public.user_access SET all_jobs = true, updated_at = now() WHERE user_id = new.id AND public.staff_all_jobs(level);
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
