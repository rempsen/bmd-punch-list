-- lovable-cron-fallback-reviewed: OneDrive has no push into this app; approved plan mirrors new documents every 5 minutes
-- One-way mirror of project documents to OneDrive. Idempotent.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS onedrive_folder_id text,
  ADD COLUMN IF NOT EXISTS onedrive_parent_item_id text,
  ADD COLUMN IF NOT EXISTS onedrive_parent_path text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.onedrive_mirror_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.project_documents(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('folder','upload')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  upload_url text,
  next_offset bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS onedrive_mirror_queue_due_idx ON public.onedrive_mirror_queue (status, next_attempt_at);
--> statement-breakpoint
ALTER TABLE public.onedrive_mirror_queue ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.onedrive_mirror_queue FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- upload_url is a pre-authorised OneDrive address: never readable from the browser.
GRANT SELECT (id, project_id, document_id, action, status, attempts, last_error, next_attempt_at, created_at)
  ON public.onedrive_mirror_queue TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "mirror queue read" ON public.onedrive_mirror_queue;
--> statement-breakpoint
CREATE POLICY "mirror queue read" ON public.onedrive_mirror_queue FOR SELECT TO authenticated
  USING (public.has_capability('manage_integrations'));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.retry_mirror(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d uuid;
BEGIN
  IF NOT public.has_capability('manage_integrations') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.onedrive_mirror_queue
     SET status = 'pending', attempts = 0, next_attempt_at = now()
   WHERE id = _id AND status = 'failed' RETURNING document_id INTO d;
  IF d IS NOT NULL THEN
    UPDATE public.project_documents SET mirror_status = 'pending', mirror_error = NULL WHERE id = d;
  END IF;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.retry_mirror(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.retry_mirror(uuid) TO authenticated;
--> statement-breakpoint

-- Where a project sits in OneDrive can be chosen until its folder exists.
CREATE OR REPLACE FUNCTION public.set_project_onedrive_parent(_project uuid, _item_id text, _path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('manage_projects') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.projects SET onedrive_parent_item_id = nullif(_item_id, ''), onedrive_parent_path = nullif(_path, '')
   WHERE id = _project AND onedrive_folder_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'The OneDrive folder for this project already exists'; END IF;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.set_project_onedrive_parent(uuid, text, text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.set_project_onedrive_parent(uuid, text, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.enqueue_onedrive_mirror()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'project_documents' THEN
    INSERT INTO public.onedrive_mirror_queue (project_id, document_id, action) VALUES (NEW.project_id, NEW.id, 'upload');
  ELSE
    INSERT INTO public.onedrive_mirror_queue (project_id, action) VALUES (NEW.id, 'folder');
  END IF;
  RETURN NULL;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_documents_mirror ON public.project_documents;
--> statement-breakpoint
CREATE TRIGGER project_documents_mirror AFTER INSERT ON public.project_documents
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_onedrive_mirror();
--> statement-breakpoint
DROP TRIGGER IF EXISTS projects_mirror ON public.projects;
--> statement-breakpoint
-- Only pipeline projects get a folder made for them up front; an existing site job gets one with its first document.
CREATE TRIGGER projects_mirror AFTER INSERT ON public.projects
  FOR EACH ROW WHEN (NEW.stage = 'opportunity') EXECUTE FUNCTION public.enqueue_onedrive_mirror();
--> statement-breakpoint

DO $$ BEGIN
  PERFORM cron.unschedule('bmd-onedrive-mirror');
EXCEPTION WHEN others THEN NULL; END $$;
--> statement-breakpoint
SELECT cron.schedule('bmd-onedrive-mirror', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--4ee30e5b-d222-45f5-8a77-2a181efc21f2.lovable.app/api/public/onedrive/mirror',
    headers := jsonb_build_object('Content-Type','application/json','x-intake-token',(SELECT token FROM public.intake_cron WHERE id = 1)),
    body := '{}'::jsonb
  );
$$);
