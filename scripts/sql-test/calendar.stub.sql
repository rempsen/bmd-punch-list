-- What the calendar migration reads: install visits (only the columns it uses), the job number, and the real "may see this job" rule.
RESET ROLE;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS project_number text;
CREATE TABLE public.install_visits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id), starts_at timestamptz NOT NULL, ends_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled', assigned_user_id uuid, assigned_name text, notes text, scope text);
CREATE OR REPLACE FUNCTION public.can_project_documents(_project uuid, _write boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _project IS NOT NULL AND (
    public.has_capability(CASE WHEN _write THEN 'manage_documents' ELSE 'view_documents' END, _project)
    OR (public.has_capability('view_pipeline') AND public.has_capability(CASE WHEN _write THEN 'manage_documents' ELSE 'view_documents' END)));
$$;
INSERT INTO public.role_permissions (role, capability, allowed) VALUES ('bmd_manager','view_documents',true), ('bmd_field','view_documents',true), ('trade','view_documents',false)
ON CONFLICT (role, capability) DO UPDATE SET allowed = EXCLUDED.allowed;
-- Its own people and jobs, so earlier tests' changes do not matter.
INSERT INTO auth.users (id, email) VALUES ('c0000000-0000-0000-0000-0000000000a1','cal-mgr@bmd.test'), ('c0000000-0000-0000-0000-0000000000f1','cal-field@bmd.test'), ('c0000000-0000-0000-0000-0000000000f2','cal-field2@bmd.test');
INSERT INTO public.profiles (id, email, full_name) VALUES ('c0000000-0000-0000-0000-0000000000a1','cal-mgr@bmd.test','Cal Manager'), ('c0000000-0000-0000-0000-0000000000f1','cal-field@bmd.test','Cal Field'), ('c0000000-0000-0000-0000-0000000000f2','cal-field2@bmd.test','Cal Field Two')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_access (user_id, level, all_jobs) VALUES ('c0000000-0000-0000-0000-0000000000a1','bmd_manager',true), ('c0000000-0000-0000-0000-0000000000f1','bmd_field',false), ('c0000000-0000-0000-0000-0000000000f2','bmd_field',false)
ON CONFLICT (user_id) DO UPDATE SET level = EXCLUDED.level, all_jobs = EXCLUDED.all_jobs, status = 'active';
INSERT INTO public.projects (id, name, project_number, address) VALUES ('c1000000-0000-0000-0000-000000000001','Cal Job One','26-001','1 Main St, Winnipeg'), ('c1000000-0000-0000-0000-000000000002','Cal Job Two','26-002','2 Portage Ave');
-- Cal Field belongs to Job One only.
INSERT INTO public.project_members (project_id, user_id, role, role_source) VALUES ('c1000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000f1','bmd_field','level');
INSERT INTO public.install_visits (id, project_id, starts_at, ends_at, status, assigned_user_id, assigned_name, scope) VALUES
  ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001', now() + interval '2 days', now() + interval '2 days 8 hours', 'scheduled', 'c0000000-0000-0000-0000-0000000000f1', 'Cal Field', 'Carpet'),
  ('c2000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001', now() + interval '3 days', NULL, 'cancelled', 'c0000000-0000-0000-0000-0000000000f1', 'Cal Field', 'Base'),
  -- Assigned to Cal Field on a job they do not belong to.
  ('c2000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000002', now() + interval '4 days', NULL, 'scheduled', 'c0000000-0000-0000-0000-0000000000f1', 'Cal Field', 'LVT'),
  -- Someone else's visit on Cal Field's job.
  ('c2000000-0000-0000-0000-000000000004','c1000000-0000-0000-0000-000000000001', now() + interval '5 days', NULL, 'scheduled', 'c0000000-0000-0000-0000-0000000000f2', 'Cal Field Two', 'Tile'),
  -- Outside the window on both sides.
  ('c2000000-0000-0000-0000-000000000005','c1000000-0000-0000-0000-000000000001', now() - interval '45 days', NULL, 'completed', 'c0000000-0000-0000-0000-0000000000f1', 'Cal Field', 'Old'),
  ('c2000000-0000-0000-0000-000000000006','c1000000-0000-0000-0000-000000000001', now() + interval '200 days', NULL, 'scheduled', 'c0000000-0000-0000-0000-0000000000f1', 'Cal Field', 'Far'),
  -- Unassigned.
  ('c2000000-0000-0000-0000-000000000007','c1000000-0000-0000-0000-000000000002', now() + interval '6 days', NULL, 'scheduled', NULL, NULL, 'Stairs');
