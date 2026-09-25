ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS companycam_project_id text,
  ADD COLUMN IF NOT EXISTS companycam_project_url text,
  ADD COLUMN IF NOT EXISTS companycam_sync_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS companycam_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS companycam_options jsonb NOT NULL DEFAULT '{"photos_out":true,"tasks_out":true,"comments_out":true,"documents_out":true,"photos_in":true,"comments_in":true,"tasks_in":true}'::jsonb;

ALTER TABLE public.deficiencies ADD COLUMN IF NOT EXISTS companycam_task_id text;
GRANT SELECT (companycam_task_id) ON public.deficiencies TO authenticated;

ALTER TABLE public.deficiency_photos ADD COLUMN IF NOT EXISTS companycam_photo_id text;
CREATE UNIQUE INDEX IF NOT EXISTS deficiency_photos_cc_uidx ON public.deficiency_photos(companycam_photo_id) WHERE companycam_photo_id IS NOT NULL;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS companycam_user_id text;

CREATE TABLE public.companycam_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cc_photo_id text NOT NULL UNIQUE,
  cc_project_id text,
  thumb_url text,
  photo_url text,
  web_url text,
  description text,
  tags text[] NOT NULL DEFAULT '{}',
  taken_at timestamptz,
  creator_name text,
  status text NOT NULL DEFAULT 'new',
  deficiency_id uuid REFERENCES public.deficiencies(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.companycam_inbox TO authenticated;
GRANT ALL ON public.companycam_inbox TO service_role;
ALTER TABLE public.companycam_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read inbox" ON public.companycam_inbox FOR SELECT TO authenticated
  USING (public.has_capability('manage_settings', project_id) OR public.has_capability('capture_items', project_id));

CREATE TABLE public.companycam_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'new_project',
  cc_project_id text NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  name text,
  address text,
  payload jsonb,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, cc_project_id)
);
GRANT SELECT ON public.companycam_suggestions TO authenticated;
GRANT ALL ON public.companycam_suggestions TO service_role;
ALTER TABLE public.companycam_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers read suggestions" ON public.companycam_suggestions FOR SELECT TO authenticated
  USING (public.has_capability('manage_settings'));

CREATE TABLE public.companycam_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  direction text NOT NULL,
  entity text NOT NULL,
  local_id text,
  remote_id text,
  status text NOT NULL,
  error text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX companycam_sync_log_proj_idx ON public.companycam_sync_log(project_id, created_at DESC);
GRANT SELECT ON public.companycam_sync_log TO authenticated;
GRANT ALL ON public.companycam_sync_log TO service_role;
ALTER TABLE public.companycam_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers read sync log" ON public.companycam_sync_log FOR SELECT TO authenticated
  USING (public.has_capability('manage_settings', project_id));

-- Service-role only: webhook id + signing secret returned by CompanyCam at registration
CREATE TABLE public.companycam_webhook (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  webhook_id text,
  secret text,
  url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.companycam_webhook TO service_role;
ALTER TABLE public.companycam_webhook ENABLE ROW LEVEL SECURITY;