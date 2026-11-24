-- People and jobs as they exist before the migration.
INSERT INTO auth.users (id, email, last_sign_in_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1','dan@bmd.test', now()), ('00000000-0000-0000-0000-0000000000b1','brian@bmd.test', now()),
  ('00000000-0000-0000-0000-0000000000c1','chuck@trade.test', now()), ('00000000-0000-0000-0000-0000000000a1','mgr@bmd.test', now()),
  ('00000000-0000-0000-0000-0000000000f1','field@bmd.test', now());
INSERT INTO public.profiles (id, email, full_name, company) VALUES
  ('00000000-0000-0000-0000-0000000000d1','dan@bmd.test','Dan','BMD'), ('00000000-0000-0000-0000-0000000000b1','brian@bmd.test','Brian','BMD'),
  ('00000000-0000-0000-0000-0000000000c1','chuck@trade.test','Chuck','Rempsen'), ('00000000-0000-0000-0000-0000000000a1','mgr@bmd.test','Mia Manager','BMD'),
  ('00000000-0000-0000-0000-0000000000f1','field@bmd.test','Fred Field','BMD');
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000d1','super_admin'), ('00000000-0000-0000-0000-0000000000b1','super_admin');
INSERT INTO public.projects (id, name) VALUES ('10000000-0000-0000-0000-000000000001','Hyatt'), ('10000000-0000-0000-0000-000000000002','Test Take Off');
INSERT INTO public.project_members (project_id, user_id, role) VALUES
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','trade'),
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','bmd_manager'),
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1','bmd_field'),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000f1','client'),
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','super_admin');
INSERT INTO public.deficiencies (project_id, created_by) VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1');
