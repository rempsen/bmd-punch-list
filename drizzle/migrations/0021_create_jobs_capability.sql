INSERT INTO public.role_permissions (role, capability, allowed)
SELECT role, 'create_jobs', allowed FROM public.role_permissions WHERE capability = 'manage_settings'
ON CONFLICT (role, capability) DO NOTHING;

DO $$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.create_job(jsonb)'::regprocedure);
  src := replace(src, 'has_capability(''manage_settings'')', 'has_capability(''create_jobs'')');
  src := replace(src, 'rp.capability = ''manage_settings''', 'rp.capability = ''create_jobs''');
  EXECUTE src;
END $$;