-- Scheduling: (1) multi-day work as a run of one-day visits ("Day 2 of 3"); (2) company workdays and holidays;
-- (3) tentative visits; (4) where and when the crew reports; (5) assignment emails with one-tap crew confirmation.
-- Safe to run twice.

-- ── Company settings → Scheduling ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.schedule_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Weekday numbers the company works: 0 = Sunday … 6 = Saturday.
  workdays smallint[] NOT NULL DEFAULT '{1,2,3,4,5}' CHECK (workdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[] AND cardinality(workdays) <= 7),
  -- [{"day":"2026-12-25","name":"Christmas Day"}, …]
  holidays jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(holidays) = 'array' AND jsonb_array_length(holidays) <= 400),
  -- Addresses copied on every assignment email.
  assignment_cc text[] NOT NULL DEFAULT '{}' CHECK (cardinality(assignment_cc) <= 20),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
--> statement-breakpoint
INSERT INTO public.schedule_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE public.schedule_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.schedule_settings FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.schedule_settings TO authenticated;
--> statement-breakpoint
GRANT UPDATE (workdays, holidays, assignment_cc) ON public.schedule_settings TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.schedule_settings TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "schedule_settings read" ON public.schedule_settings;
--> statement-breakpoint
CREATE POLICY "schedule_settings read" ON public.schedule_settings FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline') OR public.has_capability('manage_projects') OR public.has_capability('manage_settings'));
--> statement-breakpoint
DROP POLICY IF EXISTS "schedule_settings write" ON public.schedule_settings;
--> statement-breakpoint
CREATE POLICY "schedule_settings write" ON public.schedule_settings FOR UPDATE TO authenticated
  USING (public.has_capability('manage_settings')) WITH CHECK (public.has_capability('manage_settings'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.schedule_settings_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS schedule_settings_touch ON public.schedule_settings;
--> statement-breakpoint
CREATE TRIGGER schedule_settings_touch BEFORE UPDATE ON public.schedule_settings FOR EACH ROW EXECUTE FUNCTION public.schedule_settings_touch();
--> statement-breakpoint

-- ── Assignment emails: one link per crew per day ─────────────────────────────────────────────────────────────
-- The link's secret is never stored, only its SHA-256. Written by the server only; the office may read who was sent what.
CREATE TABLE IF NOT EXISTS public.crew_assignment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  day date NOT NULL,
  crew_key text NOT NULL CHECK (char_length(crew_key) <= 100),
  crew_name text NOT NULL CHECK (char_length(crew_name) <= 200),
  email text NOT NULL CHECK (char_length(email) <= 320),
  cc text[] NOT NULL DEFAULT '{}',
  visit_ids uuid[] NOT NULL CHECK (cardinality(visit_ids) BETWEEN 1 AND 50),
  sent_by uuid,
  sent_by_name text NOT NULL DEFAULT '' CHECK (char_length(sent_by_name) <= 200),
  sent_at timestamptz,
  expires_at timestamptz NOT NULL,
  response text CHECK (response IN ('confirmed', 'declined')),
  responded_at timestamptz,
  decline_reason text CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crew_assignment_links_day_idx ON public.crew_assignment_links (day);
--> statement-breakpoint
ALTER TABLE public.crew_assignment_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.crew_assignment_links FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT (id, day, crew_key, crew_name, email, cc, visit_ids, sent_by, sent_by_name, sent_at, expires_at, response, responded_at, decline_reason, created_at) ON public.crew_assignment_links TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.crew_assignment_links TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "crew_assignment_links read" ON public.crew_assignment_links;
--> statement-breakpoint
CREATE POLICY "crew_assignment_links read" ON public.crew_assignment_links FOR SELECT TO authenticated USING (public.has_capability('manage_projects'));
--> statement-breakpoint

-- ── Install visits: runs, tentative, report-to, confirmation ─────────────────────────────────────────────────
ALTER TABLE public.install_visits
  ADD COLUMN IF NOT EXISTS run_id uuid,
  ADD COLUMN IF NOT EXISTS run_day int CHECK (run_day IS NULL OR run_day >= 1),
  ADD COLUMN IF NOT EXISTS run_total int CHECK (run_total IS NULL OR run_total >= 2),
  ADD COLUMN IF NOT EXISTS tentative boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_to text NOT NULL DEFAULT 'site' CHECK (report_to IN ('site', 'shop', 'other')),
  ADD COLUMN IF NOT EXISTS report_to_other text CHECK (report_to_other IS NULL OR char_length(report_to_other) <= 120),
  ADD COLUMN IF NOT EXISTS report_time time,
  ADD COLUMN IF NOT EXISTS confirmation text NOT NULL DEFAULT 'not_sent' CHECK (confirmation IN ('not_sent', 'waiting', 'confirmed', 'declined')),
  ADD COLUMN IF NOT EXISTS confirmation_at timestamptz,
  ADD COLUMN IF NOT EXISTS decline_reason text CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 300),
  ADD COLUMN IF NOT EXISTS assignment_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS assignment_link_id uuid REFERENCES public.crew_assignment_links(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS install_visits_run_idx ON public.install_visits (run_id) WHERE run_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS install_visits_assignment_link_idx ON public.install_visits (assignment_link_id) WHERE assignment_link_id IS NOT NULL;
--> statement-breakpoint
-- The office sets the run, the tentative tick and the report-to details. Confirmation is only ever written by the server.
GRANT INSERT (run_id, run_day, run_total, tentative, report_to, report_to_other, report_time) ON public.install_visits TO authenticated;
--> statement-breakpoint
GRANT UPDATE (tentative, report_to, report_to_other, report_time) ON public.install_visits TO authenticated;
--> statement-breakpoint

-- A run's numbering: live days in date order; a cancelled day leaves the run; a run left with one day is an ordinary visit.
CREATE OR REPLACE FUNCTION public.renumber_visit_run(_run uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _run IS NULL THEN RETURN; END IF;
  UPDATE public.install_visits SET run_id = NULL, run_day = NULL, run_total = NULL WHERE run_id = _run AND status = 'cancelled';
  WITH n AS (
    SELECT id, row_number() OVER (ORDER BY starts_at, id) AS d, count(*) OVER () AS t FROM public.install_visits WHERE run_id = _run
  )
  UPDATE public.install_visits v
     SET run_day = CASE WHEN n.t > 1 THEN n.d END,
         run_total = CASE WHEN n.t > 1 THEN n.t END,
         run_id = CASE WHEN n.t > 1 THEN v.run_id END
    FROM n
   WHERE v.id = n.id
     AND (v.run_day IS DISTINCT FROM CASE WHEN n.t > 1 THEN n.d END OR v.run_total IS DISTINCT FROM CASE WHEN n.t > 1 THEN n.t END OR n.t <= 1);
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.renumber_visit_run(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.install_visits_run_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.renumber_visit_run(OLD.run_id);
  RETURN NULL;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.install_visits_run_changed() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS install_visits_run_upd ON public.install_visits;
--> statement-breakpoint
CREATE TRIGGER install_visits_run_upd AFTER UPDATE OF status, starts_at ON public.install_visits
  FOR EACH ROW WHEN (OLD.run_id IS NOT NULL AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.starts_at IS DISTINCT FROM NEW.starts_at))
  EXECUTE FUNCTION public.install_visits_run_changed();
--> statement-breakpoint
DROP TRIGGER IF EXISTS install_visits_run_del ON public.install_visits;
--> statement-breakpoint
CREATE TRIGGER install_visits_run_del AFTER DELETE ON public.install_visits
  FOR EACH ROW WHEN (OLD.run_id IS NOT NULL)
  EXECUTE FUNCTION public.install_visits_run_changed();
--> statement-breakpoint

-- A visit moved to another day, given to another crew, cancelled or made tentative is no longer what the crew answered:
-- its confirmation goes back to "not sent" and the old link stops covering it.
CREATE OR REPLACE FUNCTION public.install_visits_reset_confirmation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.confirmation = 'not_sent' AND OLD.assignment_link_id IS NULL THEN RETURN NEW; END IF;
  IF (NEW.starts_at AT TIME ZONE 'America/Winnipeg')::date IS DISTINCT FROM (OLD.starts_at AT TIME ZONE 'America/Winnipeg')::date
     OR NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id
     OR NEW.technician_supplier_id IS DISTINCT FROM OLD.technician_supplier_id
     OR (NEW.assigned_user_id IS NULL AND NEW.technician_supplier_id IS NULL AND NEW.assigned_name IS DISTINCT FROM OLD.assigned_name)
     OR (NEW.status = 'cancelled' AND OLD.status <> 'cancelled')
     OR (NEW.tentative AND NOT OLD.tentative) THEN
    NEW.confirmation := 'not_sent';
    NEW.confirmation_at := NULL;
    NEW.decline_reason := NULL;
    NEW.assignment_sent_at := NULL;
    NEW.assignment_link_id := NULL;
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.install_visits_reset_confirmation() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS install_visits_reset_confirmation ON public.install_visits;
--> statement-breakpoint
CREATE TRIGGER install_visits_reset_confirmation BEFORE UPDATE OF starts_at, assigned_user_id, assigned_name, technician_supplier_id, status, tentative ON public.install_visits
  FOR EACH ROW EXECUTE FUNCTION public.install_visits_reset_confirmation();
--> statement-breakpoint

-- Activity entries written when a crew answers carry source 'crew'.
ALTER TABLE public.install_visit_events DROP CONSTRAINT IF EXISTS install_visit_events_source_check;
--> statement-breakpoint
ALTER TABLE public.install_visit_events ADD CONSTRAINT install_visit_events_source_check CHECK (source IN ('staff', 'arriveping', 'sync', 'crew'));
--> statement-breakpoint

-- After the email has left: the visits point at the link, read "Waiting" (a visit already confirmed stays confirmed),
-- and each gets an Activity entry saying who sent it, to whom, and who was copied. Server only.
CREATE OR REPLACE FUNCTION public.activate_assignment_link(_link uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.crew_assignment_links; n int;
BEGIN
  SELECT * INTO l FROM public.crew_assignment_links WHERE id = _link FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment link not found'; END IF;
  IF l.sent_at IS NOT NULL THEN RETURN 0; END IF;
  UPDATE public.crew_assignment_links SET sent_at = now() WHERE id = _link;
  WITH done AS (
    UPDATE public.install_visits v
       SET assignment_link_id = _link,
           assignment_sent_at = now(),
           confirmation = CASE WHEN v.confirmation = 'confirmed' THEN 'confirmed' ELSE 'waiting' END,
           confirmation_at = CASE WHEN v.confirmation = 'confirmed' THEN v.confirmation_at END,
           decline_reason = NULL
     WHERE v.id = ANY (l.visit_ids) AND v.status <> 'cancelled' AND NOT v.tentative
    RETURNING v.id, v.project_id
  ), logged AS (
    INSERT INTO public.install_visit_events (visit_id, project_id, status, note, source)
    SELECT d.id, d.project_id, 'assignment_sent',
           'Assignment emailed to ' || l.crew_name || ' (' || l.email || ') by ' || coalesce(nullif(l.sent_by_name, ''), 'staff')
             || CASE WHEN cardinality(l.cc) > 0 THEN ', copied to ' || array_to_string(l.cc, ', ') ELSE '' END,
           'staff'
      FROM done d
    RETURNING 1
  )
  SELECT count(*) INTO n FROM logged;
  RETURN n;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.activate_assignment_link(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.activate_assignment_link(uuid) TO service_role;
--> statement-breakpoint

-- A crew's tap on Confirm or Can't make it, found by the hash of the link's secret. Returns what happened:
-- 'confirmed' | 'declined' | 'expired' | 'replaced' | 'not_found'. The answer can be changed until the day is over. Server only.
CREATE OR REPLACE FUNCTION public.respond_to_assignment(_token_hash text, _answer text, _reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.crew_assignment_links; why text; changed boolean;
BEGIN
  IF _answer NOT IN ('confirmed', 'declined') THEN RAISE EXCEPTION 'Invalid answer'; END IF;
  SELECT * INTO l FROM public.crew_assignment_links WHERE token_hash = _token_hash AND sent_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF now() >= l.expires_at THEN RETURN 'expired'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.install_visits v WHERE v.assignment_link_id = l.id AND v.status <> 'cancelled') THEN RETURN 'replaced'; END IF;
  why := CASE WHEN _answer = 'declined' THEN nullif(left(btrim(coalesce(_reason, '')), 300), '') END;
  changed := l.response IS DISTINCT FROM _answer OR l.decline_reason IS DISTINCT FROM why;
  UPDATE public.crew_assignment_links SET response = _answer, responded_at = now(), decline_reason = why WHERE id = l.id;
  UPDATE public.install_visits v SET confirmation = _answer, confirmation_at = now(), decline_reason = why
   WHERE v.assignment_link_id = l.id AND v.status <> 'cancelled';
  IF changed THEN
    INSERT INTO public.install_visit_events (visit_id, project_id, status, note, source)
    SELECT v.id, v.project_id, _answer,
           CASE WHEN _answer = 'confirmed' THEN 'Confirmed by ' || l.crew_name
                ELSE l.crew_name || ' can''t make it' || coalesce(': ' || why, '') END,
           'crew'
      FROM public.install_visits v WHERE v.assignment_link_id = l.id AND v.status <> 'cancelled';
  END IF;
  RETURN _answer;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.respond_to_assignment(text, text, text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.respond_to_assignment(text, text, text) TO service_role;
