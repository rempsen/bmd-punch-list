-- Stand-ins the time clock migration (0085) reads: the "Goes to site" mark from 0080, pricing for managers, and its own people.
ALTER TABLE public.user_access ADD COLUMN IF NOT EXISTS goes_to_site boolean NOT NULL DEFAULT false;
GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
INSERT INTO public.role_permissions (role, capability) VALUES ('bmd_manager','view_pricing'), ('bmd_manager','manage_users'), ('bmd_manager','manage_projects') ON CONFLICT DO NOTHING;
-- t1: office manager (pricing, users, projects). t2, t3: crews (t2 by field level, t3 a viewer marked "Goes to site"). t4: a trade. t5: a manager level without pricing.
INSERT INTO public.role_permissions (role, capability) VALUES ('bmd_admin','manage_projects'), ('bmd_admin','manage_users') ON CONFLICT DO NOTHING;
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000000e0a1','t-office@bmd.test'), ('00000000-0000-0000-0000-00000000e0a2','t-ana@bmd.test'), ('00000000-0000-0000-0000-00000000e0a3','t-ben@bmd.test'), ('00000000-0000-0000-0000-00000000e0a4','t-trade@bmd.test'), ('00000000-0000-0000-0000-00000000e0a5','t-nopricing@bmd.test') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, email, full_name) VALUES ('00000000-0000-0000-0000-00000000e0a1','t-office@bmd.test','Olga Office'), ('00000000-0000-0000-0000-00000000e0a2','t-ana@bmd.test','Ana Crew'), ('00000000-0000-0000-0000-00000000e0a3','t-ben@bmd.test','Ben Crew'), ('00000000-0000-0000-0000-00000000e0a4','t-trade@bmd.test','Tia Trade'), ('00000000-0000-0000-0000-00000000e0a5','t-nopricing@bmd.test','Nell Nopricing') ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
INSERT INTO public.user_access (user_id, level, all_jobs, goes_to_site) VALUES
  ('00000000-0000-0000-0000-00000000e0a1','bmd_manager', true, false), ('00000000-0000-0000-0000-00000000e0a2','bmd_field', true, false),
  ('00000000-0000-0000-0000-00000000e0a3','viewer', false, true), ('00000000-0000-0000-0000-00000000e0a4','trade', false, false), ('00000000-0000-0000-0000-00000000e0a5','bmd_admin', true, false)
ON CONFLICT (user_id) DO UPDATE SET level = EXCLUDED.level, all_jobs = EXCLUDED.all_jobs, goes_to_site = EXCLUDED.goes_to_site, status = 'active';
INSERT INTO public.projects (id, name) VALUES ('10000000-0000-0000-0000-0000000000e1','Time Test Job') ON CONFLICT DO NOTHING;
