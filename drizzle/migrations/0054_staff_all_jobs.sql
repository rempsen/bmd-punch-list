-- Dan's rule (24 Nov 2026, until further notice): every BMD staff member is on every job, new ones included.
-- Trades, clients and viewers keep job-by-job access. This backfills the people and open invites that exist today;
-- the Users screen now defaults new staff to "All jobs" as well. An admin can still switch anyone to selected jobs.
UPDATE public.user_access a SET all_jobs = true, updated_at = now()
 WHERE NOT a.all_jobs AND a.level IN ('super_admin','bmd_admin','bmd_manager','bmd_field');
--> statement-breakpoint
UPDATE public.user_invites SET all_jobs = true
 WHERE NOT all_jobs AND accepted_at IS NULL AND status = 'pending' AND coalesce(level, role) IN ('super_admin','bmd_admin','bmd_manager','bmd_field');
--> statement-breakpoint
INSERT INTO public.user_admin_log (user_id, email, actor, action, detail)
SELECT a.user_id, p.email, NULL, 'saved', jsonb_build_object('level', a.level, 'all_jobs', true, 'note', 'staff on all jobs by default (24 Nov 2026 rule)')
  FROM public.user_access a JOIN public.profiles p ON p.id = a.user_id
 WHERE a.all_jobs AND a.level IN ('super_admin','bmd_admin','bmd_manager','bmd_field');
