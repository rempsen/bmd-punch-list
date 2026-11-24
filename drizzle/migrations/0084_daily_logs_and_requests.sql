-- Daily logs, crew requests, and the crew's lists (materials from the estimate, tools) on a job.
-- Who may do what:
--   * "Crew access" to a job = office and field staff who can see the job, plus subcontractor crews on it
--     (anyone who may add photos on that job). Clients and viewers never have crew access.
--   * Daily logs: staff read every log on jobs they can see. Anyone else on the job (client, trade, viewer) reads only
--     logs marked "Share with the client", plus the ones they wrote themselves.
--   * Setting a request's status, sharing a log, and editing or deleting someone else's log need manage_projects.
CREATE OR REPLACE FUNCTION public.job_crew_can(_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _project IS NOT NULL AND (public.can_project_documents(_project, false) OR public.has_capability('add_photos', _project));
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.job_crew_can(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.job_crew_can(uuid) TO authenticated;
--> statement-breakpoint
-- Office staff on a job: may change request statuses, share logs, and edit other people's logs.
CREATE OR REPLACE FUNCTION public.job_office_can(_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _project IS NOT NULL AND public.has_capability('manage_projects') AND public.can_project_documents(_project, false);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.job_office_can(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.job_office_can(uuid) TO authenticated;
--> statement-breakpoint
-- "Today" for a daily log is the Winnipeg day, the same clock the schedule uses.
CREATE OR REPLACE FUNCTION public.bmd_today()
RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (now() AT TIME ZONE 'America/Winnipeg')::date;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bmd_today() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.bmd_today() TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.person_display_name(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(nullif(btrim(p.full_name), ''), p.email, 'Someone') FROM public.profiles p WHERE p.id = _user;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.person_display_name(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- ── Daily logs ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  log_date date NOT NULL DEFAULT public.bmd_today(),
  author_id uuid NOT NULL DEFAULT auth.uid(),
  author_name text NOT NULL DEFAULT '',
  what_happened text NOT NULL DEFAULT '',
  next_steps text NOT NULL DEFAULT '',
  shared_with_client boolean NOT NULL DEFAULT false,
  -- Weather is filled in by the server after the log is saved. 'unavailable' means it could not be found; never guessed.
  weather_status text NOT NULL DEFAULT 'pending' CHECK (weather_status IN ('pending', 'ok', 'unavailable')),
  weather_conditions text,
  weather_code integer,
  temp_now_c numeric,
  temp_high_c numeric,
  temp_low_c numeric,
  weather_place text,
  latitude numeric,
  longitude numeric,
  weather_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_logs_one_per_day UNIQUE (project_id, log_date, author_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS daily_logs_project_idx ON public.daily_logs (project_id, log_date DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS daily_logs_date_idx ON public.daily_logs (log_date);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daily_logs_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN NEW.author_id := auth.uid(); END IF;
    NEW.author_name := coalesce(public.person_display_name(NEW.author_id), 'Someone');
    IF NEW.shared_with_client AND auth.uid() IS NOT NULL AND NOT public.job_office_can(NEW.project_id) THEN
      RAISE EXCEPTION 'Only office staff can share a log with the client';
    END IF;
  ELSE
    NEW.project_id := OLD.project_id;
    NEW.author_id := OLD.author_id;
    NEW.author_name := OLD.author_name;
    NEW.log_date := OLD.log_date;
    NEW.created_at := OLD.created_at;
    IF NEW.shared_with_client IS DISTINCT FROM OLD.shared_with_client AND auth.uid() IS NOT NULL AND NOT public.job_office_can(NEW.project_id) THEN
      RAISE EXCEPTION 'Only office staff can share a log with the client';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daily_logs_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS daily_logs_guard ON public.daily_logs;
--> statement-breakpoint
CREATE TRIGGER daily_logs_guard BEFORE INSERT OR UPDATE ON public.daily_logs FOR EACH ROW EXECUTE FUNCTION public.daily_logs_guard();
--> statement-breakpoint
ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.daily_logs FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_logs TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.daily_logs TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "daily_logs read" ON public.daily_logs;
--> statement-breakpoint
CREATE POLICY "daily_logs read" ON public.daily_logs FOR SELECT TO authenticated
  USING (public.can_project_documents(project_id, false)
         OR (public.is_project_member(project_id) AND (shared_with_client OR author_id = auth.uid())));
--> statement-breakpoint
DROP POLICY IF EXISTS "daily_logs add" ON public.daily_logs;
--> statement-breakpoint
CREATE POLICY "daily_logs add" ON public.daily_logs FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.job_crew_can(project_id)
              AND (log_date = public.bmd_today() OR public.job_office_can(project_id)));
--> statement-breakpoint
DROP POLICY IF EXISTS "daily_logs change" ON public.daily_logs;
--> statement-breakpoint
CREATE POLICY "daily_logs change" ON public.daily_logs FOR UPDATE TO authenticated
  USING ((author_id = auth.uid() AND log_date = public.bmd_today() AND public.job_crew_can(project_id)) OR public.job_office_can(project_id))
  WITH CHECK ((author_id = auth.uid() AND public.job_crew_can(project_id)) OR public.job_office_can(project_id));
--> statement-breakpoint
DROP POLICY IF EXISTS "daily_logs remove" ON public.daily_logs;
--> statement-breakpoint
CREATE POLICY "daily_logs remove" ON public.daily_logs FOR DELETE TO authenticated
  USING ((author_id = auth.uid() AND log_date = public.bmd_today() AND public.job_crew_can(project_id)) OR public.job_office_can(project_id));
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.daily_log_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid NOT NULL REFERENCES public.daily_logs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS daily_log_photos_log_idx ON public.daily_log_photos (log_id, created_at);
--> statement-breakpoint
ALTER TABLE public.daily_log_photos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.daily_log_photos FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.daily_log_photos TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.daily_log_photos TO service_role;
--> statement-breakpoint
-- A photo is readable exactly when its log is: the log's own rule applies to this look-up.
DROP POLICY IF EXISTS "daily_log_photos read" ON public.daily_log_photos;
--> statement-breakpoint
CREATE POLICY "daily_log_photos read" ON public.daily_log_photos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.daily_logs l WHERE l.id = log_id));
--> statement-breakpoint
DROP POLICY IF EXISTS "daily_log_photos add" ON public.daily_log_photos;
--> statement-breakpoint
CREATE POLICY "daily_log_photos add" ON public.daily_log_photos FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.daily_logs l
                       WHERE l.id = log_id AND l.project_id = daily_log_photos.project_id
                         AND ((l.author_id = auth.uid() AND l.log_date = public.bmd_today() AND public.job_crew_can(l.project_id))
                              OR public.job_office_can(l.project_id))));
--> statement-breakpoint
DROP POLICY IF EXISTS "daily_log_photos remove" ON public.daily_log_photos;
--> statement-breakpoint
CREATE POLICY "daily_log_photos remove" ON public.daily_log_photos FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.daily_logs l
                  WHERE l.id = log_id
                    AND ((l.author_id = auth.uid() AND l.log_date = public.bmd_today() AND public.job_crew_can(l.project_id))
                         OR public.job_office_can(l.project_id))));
--> statement-breakpoint

-- ── Requests ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  what text NOT NULL CHECK (btrim(what) <> ''),
  quantity text,
  needed_by date,
  photo_path text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ordered', 'on_its_way', 'done', 'cant_do')),
  status_reason text,
  status_by uuid,
  status_by_name text,
  status_at timestamptz,
  requested_by uuid NOT NULL DEFAULT auth.uid(),
  requested_by_name text NOT NULL DEFAULT '',
  daily_log_id uuid REFERENCES public.daily_logs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_requests_cant_do_reason CHECK (status <> 'cant_do' OR btrim(coalesce(status_reason, '')) <> '')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_requests_project_idx ON public.job_requests (project_id, status, created_at DESC);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.job_requests_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.requested_by := auth.uid();
      NEW.status := 'open'; NEW.status_reason := NULL; NEW.status_by := NULL; NEW.status_by_name := NULL; NEW.status_at := NULL;
    END IF;
    NEW.requested_by_name := coalesce(public.person_display_name(NEW.requested_by), 'Someone');
  ELSE
    NEW.project_id := OLD.project_id;
    NEW.requested_by := OLD.requested_by;
    NEW.requested_by_name := OLD.requested_by_name;
    NEW.created_at := OLD.created_at;
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.status_reason IS DISTINCT FROM OLD.status_reason THEN
      IF auth.uid() IS NOT NULL AND NOT public.job_office_can(NEW.project_id) THEN
        RAISE EXCEPTION 'Only office staff can change a request''s status';
      END IF;
      IF NEW.status <> 'cant_do' THEN NEW.status_reason := NULL; END IF;
      NEW.status_by := auth.uid();
      NEW.status_by_name := public.person_display_name(auth.uid());
      NEW.status_at := now();
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.job_requests_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS job_requests_guard ON public.job_requests;
--> statement-breakpoint
CREATE TRIGGER job_requests_guard BEFORE INSERT OR UPDATE ON public.job_requests FOR EACH ROW EXECUTE FUNCTION public.job_requests_guard();
--> statement-breakpoint
ALTER TABLE public.job_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.job_requests FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_requests TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.job_requests TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "job_requests read" ON public.job_requests;
--> statement-breakpoint
CREATE POLICY "job_requests read" ON public.job_requests FOR SELECT TO authenticated USING (public.job_crew_can(project_id));
--> statement-breakpoint
DROP POLICY IF EXISTS "job_requests add" ON public.job_requests;
--> statement-breakpoint
CREATE POLICY "job_requests add" ON public.job_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid() AND public.job_crew_can(project_id));
--> statement-breakpoint
-- The requester may fix their own wording while it is still open; office staff change anything (the trigger guards status).
DROP POLICY IF EXISTS "job_requests change" ON public.job_requests;
--> statement-breakpoint
CREATE POLICY "job_requests change" ON public.job_requests FOR UPDATE TO authenticated
  USING ((requested_by = auth.uid() AND status = 'open' AND public.job_crew_can(project_id)) OR public.job_office_can(project_id))
  WITH CHECK ((requested_by = auth.uid() AND status = 'open' AND public.job_crew_can(project_id)) OR public.job_office_can(project_id));
--> statement-breakpoint
DROP POLICY IF EXISTS "job_requests remove" ON public.job_requests;
--> statement-breakpoint
CREATE POLICY "job_requests remove" ON public.job_requests FOR DELETE TO authenticated
  USING ((requested_by = auth.uid() AND status = 'open' AND public.job_crew_can(project_id)) OR public.job_office_can(project_id));
--> statement-breakpoint

-- ── Photo files ──────────────────────────────────────────────────────────────────────────────────────────────
-- Log and request photos live in the job photo bucket under job-site/<job id>/... (never in project documents,
-- which are copied to OneDrive). These rules are separate from the deficiency and visit photo rules and do not change them.
CREATE OR REPLACE FUNCTION public.job_site_path_project(_name text)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN split_part(_name, '/', 1) = 'job-site' AND split_part(_name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN split_part(_name, '/', 2)::uuid END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.job_site_path_project(text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.job_site_path_project(text) TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "job site photos readable" ON storage.objects;
--> statement-breakpoint
-- Readable when the log or request it belongs to is readable (their own rules apply to these look-ups),
-- and by the person who uploaded it (so an upload can be confirmed before its row is written).
CREATE POLICY "job site photos readable" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'deficiency-photos' AND public.job_site_path_project(name) IS NOT NULL
         AND (owner_id = (auth.uid())::text
              OR EXISTS (SELECT 1 FROM public.daily_log_photos p WHERE p.storage_path = name)
              OR EXISTS (SELECT 1 FROM public.job_requests r WHERE r.photo_path = name)));
--> statement-breakpoint
DROP POLICY IF EXISTS "job site photos uploadable" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "job site photos uploadable" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deficiency-photos' AND public.job_crew_can(public.job_site_path_project(name)));
--> statement-breakpoint
DROP POLICY IF EXISTS "job site photos removable" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "job site photos removable" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'deficiency-photos' AND public.job_site_path_project(name) IS NOT NULL
         AND (owner_id = (auth.uid())::text OR public.job_office_can(public.job_site_path_project(name))));
--> statement-breakpoint

-- ── Materials for the crew (from the estimate, no prices) ────────────────────────────────────────────────────
-- The material rows of a job's estimate — its accepted price(s), else its Base — with what the browser needs to work
-- out the same "Order" quantity the estimate shows. Required lines only, as material ordering does.
-- Returns NO cost, markup, price or supplier: crews must never see them. People without pricing access cannot read
-- the estimate tables, so this is the only way they see the list.
CREATE OR REPLACE FUNCTION public.job_material_list(_project uuid)
RETURNS TABLE(item_key text, section text, description text, line_description text, driver_qty numeric, driver_uom text,
              qty_per_driver numeric, waste_pct numeric, coverage_per_purchase_unit numeric, round_up boolean, purchase_uom text,
              sort_a integer, sort_b integer, sort_c integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.job_crew_can(_project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  WITH vers AS (
    SELECT v.id, v.sort_order FROM public.estimate_versions v
     WHERE v.project_id = _project
       AND (v.status = 'accepted' OR (v.is_base AND NOT EXISTS (SELECT 1 FROM public.estimate_versions a WHERE a.project_id = _project AND a.status = 'accepted')))
  )
  SELECT l.id::text || ':' || c.sort_order::text || ':' || coalesce(c.catalogue_material_id::text, md5(coalesce(c.label, ''))),
         coalesce(nullif(btrim(l.section), ''), 'General'),
         coalesce(nullif(btrim(concat_ws(' ', m.name, m.colour)), ''), nullif(btrim(c.label), ''), l.description),
         l.description,
         l.driver_qty, l.driver_uom, c.qty_per_driver, c.waste_pct, c.coverage_per_purchase_unit, coalesce(c.round_up, false), c.purchase_uom,
         vers.sort_order, l.sort_order, c.sort_order
    FROM vers
    JOIN public.estimate_lines l ON l.version_id = vers.id AND coalesce(l.selection, 'required') = 'required'
    JOIN public.estimate_line_components c ON c.line_id = l.id AND c.kind = 'material' AND NOT coalesce(c.not_applicable, false)
    LEFT JOIN public.catalogue_materials m ON m.id = c.catalogue_material_id
   ORDER BY vers.sort_order, l.sort_order, c.sort_order;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.job_material_list(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.job_material_list(uuid) TO authenticated;
--> statement-breakpoint
-- "Loaded / on site" ticks against that list, kept per job.
CREATE TABLE IF NOT EXISTS public.job_material_checks (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  loaded boolean NOT NULL DEFAULT true,
  checked_by uuid DEFAULT auth.uid(),
  checked_by_name text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, item_key)
);
--> statement-breakpoint
ALTER TABLE public.job_material_checks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.job_material_checks FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_material_checks TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.job_material_checks TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "job_material_checks all" ON public.job_material_checks;
--> statement-breakpoint
CREATE POLICY "job_material_checks all" ON public.job_material_checks FOR ALL TO authenticated
  USING (public.job_crew_can(project_id)) WITH CHECK (public.job_crew_can(project_id));
--> statement-breakpoint

-- ── Tool lists ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.standard_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS standard_tools_name_uidx ON public.standard_tools (lower(btrim(name)));
--> statement-breakpoint
ALTER TABLE public.standard_tools ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.standard_tools FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.standard_tools TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.standard_tools TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "standard_tools read" ON public.standard_tools;
--> statement-breakpoint
CREATE POLICY "standard_tools read" ON public.standard_tools FOR SELECT TO authenticated USING (public.is_active(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "standard_tools write" ON public.standard_tools;
--> statement-breakpoint
CREATE POLICY "standard_tools write" ON public.standard_tools FOR ALL TO authenticated
  USING (public.has_capability('manage_projects') OR public.has_capability('manage_settings'))
  WITH CHECK (public.has_capability('manage_projects') OR public.has_capability('manage_settings'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.job_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  checked boolean NOT NULL DEFAULT false,
  checked_by_name text,
  checked_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_tools_project_idx ON public.job_tools (project_id, sort_order, created_at);
--> statement-breakpoint
ALTER TABLE public.job_tools ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.job_tools FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_tools TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.job_tools TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "job_tools all" ON public.job_tools;
--> statement-breakpoint
CREATE POLICY "job_tools all" ON public.job_tools FOR ALL TO authenticated
  USING (public.job_crew_can(project_id)) WITH CHECK (public.job_crew_can(project_id));
--> statement-breakpoint

-- ── Counts for the job Overview ──────────────────────────────────────────────────────────────────────────────
-- Logs this week (Monday to today, Winnipeg) on this job and across every job the person can see, and this job's open requests.
CREATE OR REPLACE FUNCTION public.job_site_counts(_project uuid)
RETURNS TABLE(logs_this_week_job integer, logs_this_week_all integer, open_requests integer)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (SELECT count(*)::integer FROM public.daily_logs WHERE project_id = _project AND log_date >= date_trunc('week', public.bmd_today())::date),
         (SELECT count(*)::integer FROM public.daily_logs WHERE log_date >= date_trunc('week', public.bmd_today())::date),
         (SELECT count(*)::integer FROM public.job_requests WHERE project_id = _project AND status IN ('open', 'ordered', 'on_its_way'));
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.job_site_counts(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.job_site_counts(uuid) TO authenticated;
