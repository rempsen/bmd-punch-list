-- The schedule in people's own calendars.
-- (1) calendar_feeds: one row per person: what their calendar covers (their own visits or all, optionally one job), the
--     private subscription link (only a sha-256 hash of its token is kept), and whether visits are also written to their Outlook.
-- (2) calendar_outlook_events: which Outlook event stands for which visit, so a sync never makes a second one.
-- Nothing here holds prices or costs. The rule for what a person may see is applied here, in one place.
CREATE TABLE IF NOT EXISTS public.calendar_feeds (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'mine' CHECK (scope IN ('mine', 'all')),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  token_hash text UNIQUE,
  link_created_at timestamptz,
  link_last_used_at timestamptz,
  window_started_at timestamptz,
  window_hits integer NOT NULL DEFAULT 0,
  outlook_enabled boolean NOT NULL DEFAULT false,
  outlook_calendar_id text,
  outlook_synced_at timestamptz,
  outlook_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.calendar_feeds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.calendar_feeds FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- The browser reads these columns only (never the token hash) and writes nothing directly.
GRANT SELECT (user_id, scope, project_id, link_created_at, link_last_used_at, outlook_enabled, outlook_synced_at, outlook_error) ON public.calendar_feeds TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.calendar_feeds TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "calendar_feeds read" ON public.calendar_feeds;
--> statement-breakpoint
CREATE POLICY "calendar_feeds read" ON public.calendar_feeds FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_capability('manage_users'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.calendar_outlook_events (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL,
  event_id text NOT NULL,
  fingerprint text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, visit_id)
);
--> statement-breakpoint
ALTER TABLE public.calendar_outlook_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Server only: no policies, no browser access.
REVOKE ALL ON public.calendar_outlook_events FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT ALL ON public.calendar_outlook_events TO service_role;
--> statement-breakpoint
-- Saves what my calendar covers. "All visits" needs view_pipeline; a chosen job must be one I can see.
CREATE OR REPLACE FUNCTION public.calendar_feed_save(_scope text, _project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _scope IS NULL OR _scope NOT IN ('mine', 'all') THEN RAISE EXCEPTION 'Choose My visits or All visits'; END IF;
  IF _scope = 'all' AND NOT public.has_capability('view_pipeline') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _project IS NOT NULL AND NOT (public.has_capability('view_pipeline') OR public.can_project_documents(_project, false)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO public.calendar_feeds (user_id, scope, project_id) VALUES (auth.uid(), _scope, _project)
  ON CONFLICT (user_id) DO UPDATE SET scope = EXCLUDED.scope, project_id = EXCLUDED.project_id, updated_at = now();
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_feed_save(text, uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.calendar_feed_save(text, uuid) TO authenticated;
--> statement-breakpoint
-- Turns my calendar link on (returning its token, the only time it can be read), replaces it with a new one, or turns it off.
-- The old token stops working in the same statement.
CREATE OR REPLACE FUNCTION public.calendar_feed_link(_on boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tok text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF coalesce(_on, false) THEN
    tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    INSERT INTO public.calendar_feeds (user_id, token_hash, link_created_at)
    VALUES (auth.uid(), encode(sha256(convert_to(tok, 'UTF8')), 'hex'), now())
    ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, link_created_at = now(), link_last_used_at = NULL,
      window_started_at = NULL, window_hits = 0, updated_at = now();
    RETURN tok;
  END IF;
  UPDATE public.calendar_feeds SET token_hash = NULL, link_created_at = NULL, link_last_used_at = NULL, updated_at = now() WHERE user_id = auth.uid();
  RETURN NULL;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_feed_link(boolean) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.calendar_feed_link(boolean) TO authenticated;
--> statement-breakpoint
-- An admin turns someone's calendar link off (Company settings → Users).
CREATE OR REPLACE FUNCTION public.calendar_feed_revoke(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('manage_users') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.calendar_feeds SET token_hash = NULL, link_created_at = NULL, link_last_used_at = NULL, updated_at = now() WHERE user_id = _user;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_feed_revoke(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.calendar_feed_revoke(uuid) TO authenticated;
--> statement-breakpoint
-- Whether a person may see a job the way the app lets them (the job's documents capability for their role on it).
CREATE OR REPLACE FUNCTION public.calendar_user_sees_job(_user uuid, _project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user) OR EXISTS (
    SELECT 1 FROM public.role_permissions rp
     WHERE rp.role = public.effective_role(_user, _project) AND rp.capability = 'view_documents' AND rp.allowed);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_user_sees_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.calendar_user_sees_job(uuid, uuid) TO service_role;
--> statement-breakpoint
-- The visits a person's calendar covers, from 30 days back to 180 days ahead, as whole visit rows plus the job's name,
-- number and site address. Server only. The rule is the app's own: someone without view_pipeline only ever gets visits
-- assigned to them, on jobs they can see; "All visits" quietly becomes "My visits" if they lose view_pipeline.
-- A deactivated person gets nothing.
CREATE OR REPLACE FUNCTION public.calendar_visits_for(_user uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.calendar_feeds; pipeline boolean; everything boolean; result jsonb;
BEGIN
  SELECT * INTO f FROM public.calendar_feeds WHERE user_id = _user;
  IF NOT FOUND OR NOT public.is_active(_user) OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user) THEN RETURN '[]'::jsonb; END IF;
  pipeline := public.user_has_capability(_user, 'view_pipeline');
  everything := pipeline AND f.scope = 'all';
  SELECT coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object('project', jsonb_build_object('id', p.id, 'name', p.name, 'project_number', p.project_number, 'address', p.address)) ORDER BY v.starts_at), '[]'::jsonb)
    INTO result
    FROM public.install_visits v JOIN public.projects p ON p.id = v.project_id
   WHERE coalesce(v.ends_at, v.starts_at) >= now() - interval '30 days'
     AND v.starts_at < now() + interval '180 days'
     AND (f.project_id IS NULL OR v.project_id = f.project_id)
     AND (everything OR (v.assigned_user_id = _user AND (pipeline OR public.calendar_user_sees_job(_user, v.project_id))));
  RETURN result;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_visits_for(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.calendar_visits_for(uuid) TO service_role;
--> statement-breakpoint
-- Reads a calendar link by the hash of its token. Server only. NULL for an unknown or turned-off link, or one whose
-- owner is no longer active. At most 30 reads in 5 minutes per link (calendar apps ask a few times an hour).
CREATE OR REPLACE FUNCTION public.calendar_feed_read(_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.calendar_feeds; pipeline boolean;
BEGIN
  IF _hash IS NULL OR _hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO f FROM public.calendar_feeds WHERE token_hash = _hash FOR UPDATE;
  IF NOT FOUND OR NOT public.is_active(f.user_id) OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = f.user_id) THEN RETURN NULL; END IF;
  IF f.window_started_at IS NULL OR f.window_started_at < now() - interval '5 minutes' THEN
    UPDATE public.calendar_feeds SET window_started_at = now(), window_hits = 1, link_last_used_at = now() WHERE user_id = f.user_id;
  ELSIF f.window_hits >= 30 THEN
    RETURN jsonb_build_object('limited', true);
  ELSE
    UPDATE public.calendar_feeds SET window_hits = window_hits + 1, link_last_used_at = now() WHERE user_id = f.user_id;
  END IF;
  pipeline := public.user_has_capability(f.user_id, 'view_pipeline');
  RETURN jsonb_build_object(
    'scope', CASE WHEN pipeline AND f.scope = 'all' THEN 'all' ELSE 'mine' END,
    'job', (SELECT p.name FROM public.projects p WHERE p.id = f.project_id),
    'visits', public.calendar_visits_for(f.user_id));
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_feed_read(text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.calendar_feed_read(text) TO service_role;
