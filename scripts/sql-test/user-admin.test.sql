-- User administration: what each person can reach, before and after admin actions.
-- Each block runs as one person (auth.uid() comes from request.jwt.claim.sub).
\set dan '''00000000-0000-0000-0000-0000000000d1'''
\set brian '''00000000-0000-0000-0000-0000000000b1'''
\set chuck '''00000000-0000-0000-0000-0000000000c1'''
\set mgr '''00000000-0000-0000-0000-0000000000a1'''
\set field '''00000000-0000-0000-0000-0000000000f1'''
\set p1 '''10000000-0000-0000-0000-000000000001'''
\set p2 '''10000000-0000-0000-0000-000000000002'''
CREATE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', u, false) $$;
CREATE FUNCTION pg_temp.raises(q text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN others THEN RETURN true; END $$;

-- Backfill: nobody's access changes on day one.
DO $$ BEGIN
  ASSERT (SELECT level FROM user_access WHERE user_id = '00000000-0000-0000-0000-0000000000d1') = 'super_admin', 'super admin level';
  ASSERT (SELECT all_jobs FROM user_access WHERE user_id = '00000000-0000-0000-0000-0000000000d1'), 'super admin all jobs';
  ASSERT (SELECT level FROM user_access WHERE user_id = '00000000-0000-0000-0000-0000000000c1') = 'trade', 'trade level';
  ASSERT NOT (SELECT all_jobs FROM user_access WHERE user_id = '00000000-0000-0000-0000-0000000000c1'), 'trade selected jobs';
  ASSERT (SELECT level FROM user_access WHERE user_id = '00000000-0000-0000-0000-0000000000f1') = 'bmd_field', 'most privileged role becomes level';
  ASSERT (SELECT role_source FROM project_members WHERE user_id = '00000000-0000-0000-0000-0000000000f1' AND project_id = '10000000-0000-0000-0000-000000000002') = 'job', 'other role kept as exception';
  ASSERT (SELECT role_source FROM project_members WHERE user_id = '00000000-0000-0000-0000-0000000000f1' AND project_id = '10000000-0000-0000-0000-000000000001') = 'level', 'same role follows level';
  ASSERT public.effective_role('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-000000000002') = 'client', 'exception still applies';
END $$;

-- Chuck sees Hyatt only.
SELECT pg_temp.as_user(:chuck);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.my_projects()) = 1, 'trade sees one job';
  ASSERT NOT public.is_project_member('10000000-0000-0000-0000-000000000002'), 'trade not on job 2';
END $$;

-- Dan makes Mia a manager on all jobs; she then reaches a brand-new job.
SELECT pg_temp.as_user(:dan);
SELECT public.admin_save_user(:mgr, 'Mia Manager', 'BMD', 'bmd_manager', true, '[]'::jsonb);
INSERT INTO projects (id, name) VALUES ('10000000-0000-0000-0000-000000000003', 'New job');
SELECT pg_temp.as_user(:mgr);
DO $$ BEGIN
  ASSERT public.is_project_member('10000000-0000-0000-0000-000000000003'), 'all-jobs reaches new job';
  ASSERT public.has_capability('manage_estimates', '10000000-0000-0000-0000-000000000003'), 'level capability on new job';
  ASSERT (SELECT count(*) FROM public.my_projects()) = 3, 'manager lists all jobs';
  ASSERT (SELECT role FROM public.my_projects() WHERE id = '10000000-0000-0000-0000-000000000003') = 'bmd_manager', 'role shown per job';
END $$;

-- A per-job exception wins over the level and survives a level change.
SELECT pg_temp.as_user(:dan);
SELECT public.admin_save_user(:mgr, 'Mia Manager', 'BMD', 'bmd_manager', true, jsonb_build_array(jsonb_build_object('project_id', :p2, 'role', 'viewer')));
DO $$ BEGIN
  ASSERT public.effective_role('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000002') = 'viewer', 'exception wins';
  ASSERT public.effective_role('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001') = 'bmd_manager', 'level elsewhere';
END $$;
SELECT public.admin_save_user(:mgr, 'Mia Manager', 'BMD', 'bmd_field', true, jsonb_build_array(jsonb_build_object('project_id', :p2, 'role', 'viewer')));
DO $$ BEGIN
  ASSERT public.effective_role('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000002') = 'viewer', 'exception survives level change';
  ASSERT public.effective_role('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001') = 'bmd_field', 'level change applies';
  ASSERT (SELECT role FROM project_members WHERE user_id = '00000000-0000-0000-0000-0000000000a1' AND project_id = '10000000-0000-0000-0000-000000000001') = 'bmd_field', 'level rows mirror the level';
END $$;
SELECT public.admin_save_user(:mgr, 'Mia Manager', 'BMD', 'bmd_manager', true, '[]'::jsonb);

-- Selected jobs: removing a job removes access.
SELECT public.admin_save_user(:chuck, 'Chuck', 'Rempsen', 'trade', false, jsonb_build_array(jsonb_build_object('project_id', :p2, 'role', null)));
DO $$ BEGIN
  ASSERT public.effective_role('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001') IS NULL, 'removed from job 1';
  ASSERT public.effective_role('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000002') = 'trade', 'added to job 2';
END $$;

-- Deactivation locks a person out everywhere; reactivation restores them.
SELECT public.admin_set_status(:mgr, 'deactivated');
SELECT pg_temp.as_user(:mgr);
DO $$ BEGIN
  ASSERT NOT public.is_project_member('10000000-0000-0000-0000-000000000001'), 'deactivated: not a member';
  ASSERT NOT public.has_capability('manage_estimates', '10000000-0000-0000-0000-000000000001'), 'deactivated: no capability';
  ASSERT NOT public.has_capability('manage_users'), 'deactivated: no capability anywhere';
  ASSERT (SELECT count(*) FROM public.my_projects()) = 0, 'deactivated: no jobs';
END $$;
SELECT pg_temp.as_user(:dan);
SELECT public.admin_set_status(:mgr, 'active');
SELECT pg_temp.as_user(:mgr);
DO $$ BEGIN ASSERT (SELECT count(*) FROM public.my_projects()) = 3, 'reactivated: all jobs back'; END $$;

-- Deactivating a super admin removes super powers too.
SELECT pg_temp.as_user(:dan);
SELECT public.admin_set_status(:brian, 'deactivated');
DO $$ BEGIN ASSERT NOT public.is_super_admin('00000000-0000-0000-0000-0000000000b1'), 'deactivated super admin has no powers'; END $$;

-- Guards.
SELECT pg_temp.as_user(:dan);
DO $$ BEGIN
  ASSERT pg_temp.raises($q$SELECT public.admin_set_status('00000000-0000-0000-0000-0000000000d1','deactivated')$q$), 'cannot deactivate yourself';
END $$;
SELECT pg_temp.as_user(:mgr);
DO $$ BEGIN
  ASSERT pg_temp.raises($q$SELECT public.admin_save_user('00000000-0000-0000-0000-0000000000f1','Fred Field','BMD','super_admin',true,'[]'::jsonb)$q$), 'manager cannot grant super admin';
  ASSERT pg_temp.raises($q$SELECT public.admin_set_status('00000000-0000-0000-0000-0000000000d1','deactivated')$q$), 'manager cannot touch a super admin';
  ASSERT pg_temp.raises($q$SELECT public.admin_save_user('00000000-0000-0000-0000-0000000000d1','Dan','BMD','viewer',false,'[]'::jsonb)$q$), 'manager cannot demote a super admin';
  ASSERT NOT pg_temp.raises($q$SELECT public.admin_set_status('00000000-0000-0000-0000-0000000000f1','deactivated')$q$), 'manager can deactivate field staff';
END $$;
SELECT pg_temp.as_user(:chuck);
DO $$ BEGIN
  ASSERT pg_temp.raises($q$SELECT * FROM public.admin_list_users()$q$), 'trade cannot list users';
END $$;
-- The last active super admin cannot be deactivated or demoted (Brian is deactivated, so Dan is the last).
SELECT pg_temp.as_user(:dan);
DO $$ BEGIN
  ASSERT pg_temp.raises($q$SELECT public.admin_save_user('00000000-0000-0000-0000-0000000000d1','Dan','BMD','bmd_manager',true,'[]'::jsonb)$q$), 'last super admin cannot be demoted';
END $$;

-- Delete permanently: only deactivated people with no records.
DO $$ BEGIN
  ASSERT public.user_has_records('00000000-0000-0000-0000-0000000000c1'), 'chuck has a deficiency';
  ASSERT NOT public.user_has_records('00000000-0000-0000-0000-0000000000f1'), 'fred has none';
  ASSERT pg_temp.raises($q$SELECT public.admin_delete_user_data('00000000-0000-0000-0000-0000000000a1')$q$), 'active person cannot be deleted';
END $$;
SELECT public.admin_set_status(:chuck, 'deactivated');
DO $$ BEGIN
  ASSERT pg_temp.raises($q$SELECT public.admin_delete_user_data('00000000-0000-0000-0000-0000000000c1')$q$), 'person with records cannot be deleted';
END $$;
SELECT public.admin_delete_user_data(:field);
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM profiles WHERE id = '00000000-0000-0000-0000-0000000000f1'), 'profile gone';
  ASSERT NOT EXISTS (SELECT 1 FROM project_members WHERE user_id = '00000000-0000-0000-0000-0000000000f1'), 'memberships gone';
  ASSERT EXISTS (SELECT 1 FROM user_admin_log WHERE user_id = '00000000-0000-0000-0000-0000000000f1' AND action = 'deleted'), 'deletion logged';
END $$;

-- Invites: several jobs, and first sign-in lands them.
SELECT pg_temp.as_user(:dan);
DO $$ BEGIN
  ASSERT pg_temp.raises($q$SELECT public.admin_invite('mgr@bmd.test','Mia','BMD','viewer',false,'[]'::jsonb)$q$), 'existing account cannot be invited';
  ASSERT pg_temp.raises($q$SELECT public.admin_invite('nojob@x.test','No Job','X','client',false,'[]'::jsonb)$q$), 'selected jobs needs a job';
END $$;
SELECT public.admin_invite('Jane@Client.test', 'Jane', 'Client Co', 'client', false,
  jsonb_build_array(jsonb_build_object('project_id', :p1, 'role', null), jsonb_build_object('project_id', :p2, 'role', 'viewer')));
DO $$ BEGIN ASSERT (SELECT count(*) FROM public.admin_list_users() WHERE kind = 'invite' AND email = 'jane@client.test') = 1, 'invite listed'; END $$;
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000e1', 'jane@client.test');
DO $$ BEGIN
  ASSERT (SELECT level FROM user_access WHERE user_id = '00000000-0000-0000-0000-0000000000e1') = 'client', 'invited level';
  ASSERT public.effective_role('00000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-000000000001') = 'client', 'job 1 follows level';
  ASSERT public.effective_role('00000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-000000000002') = 'viewer', 'job 2 exception';
  ASSERT (SELECT status FROM user_invites WHERE lower(email) = 'jane@client.test') = 'accepted', 'invite accepted';
  ASSERT (SELECT count(*) FROM public.admin_list_users() WHERE email = 'jane@client.test') = 1, 'listed once as a user';
END $$;

-- Staff assignment by an all-jobs manager does not pin a role.
SELECT public.set_project_job_role('10000000-0000-0000-0000-000000000003', 'estimator', :mgr);
DO $$ BEGIN
  ASSERT (SELECT role_source FROM project_members WHERE user_id = '00000000-0000-0000-0000-0000000000a1' AND project_id = '10000000-0000-0000-0000-000000000003') = 'level', 'assignment follows level';
END $$;

SELECT 'user-admin SQL tests passed' AS result;
