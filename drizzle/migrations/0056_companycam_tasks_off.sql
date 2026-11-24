-- CompanyCam's public API has no project-task endpoint, so "Create CompanyCam tasks for must-fix items" always failed
-- (404). It was switched off job by job on 23 Nov; this makes off the default for new jobs and clears it everywhere.
ALTER TABLE public.projects ALTER COLUMN companycam_options
  SET DEFAULT '{"photos_out":true,"tasks_out":false,"comments_out":true,"documents_out":true,"photos_in":true,"comments_in":true,"tasks_in":true}'::jsonb;
--> statement-breakpoint
UPDATE public.projects SET companycam_options = companycam_options || '{"tasks_out": false}'::jsonb
 WHERE coalesce((companycam_options->>'tasks_out')::boolean, true);
