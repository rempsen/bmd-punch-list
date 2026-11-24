-- Time clock: (1) crews clock in and out on a job, with one location reading at each end and paid time rounded to the
-- company's increment; (2) the office adjusts (the original is kept), approves (which locks) and sends approved hours to
-- QuickBooks Online once; (3) hourly cost and billable rate per person, with an optional per-job billable rate.
-- Entries are written only by the app's server (service role) after it has checked who is asking, so the browser gets SELECT only.
CREATE TABLE IF NOT EXISTS public.time_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rounding_minutes integer NOT NULL DEFAULT 15 CHECK (rounding_minutes BETWEEN 1 AND 60),
  overtime_daily_minutes integer NOT NULL DEFAULT 480 CHECK (overtime_daily_minutes BETWEEN 1 AND 1440),
  overtime_weekly_minutes integer NOT NULL DEFAULT 2400 CHECK (overtime_weekly_minutes BETWEEN 1 AND 10080),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
--> statement-breakpoint
INSERT INTO public.time_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE public.time_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.time_settings FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.time_settings TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.time_settings TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "time_settings read" ON public.time_settings;
--> statement-breakpoint
CREATE POLICY "time_settings read" ON public.time_settings FOR SELECT TO authenticated USING (public.is_active(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "time_settings change" ON public.time_settings;
--> statement-breakpoint
CREATE POLICY "time_settings change" ON public.time_settings FOR UPDATE TO authenticated USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  clock_in_at timestamptz NOT NULL,
  clock_out_at timestamptz,
  rounded_minutes integer CHECK (rounded_minutes >= 0),
  in_lat double precision CHECK (in_lat BETWEEN -90 AND 90),
  in_lng double precision CHECK (in_lng BETWEEN -180 AND 180),
  in_accuracy_m double precision,
  out_lat double precision CHECK (out_lat BETWEEN -90 AND 90),
  out_lng double precision CHECK (out_lng BETWEEN -180 AND 180),
  out_accuracy_m double precision,
  note_in text,
  note_out text,
  source text NOT NULL DEFAULT 'clock' CHECK (source IN ('clock','office')),
  original jsonb,
  adjusted_at timestamptz,
  adjusted_by uuid,
  adjust_reason text,
  approved_at timestamptz,
  approved_by uuid,
  qbo_time_activity_id text,
  qbo_sent_at timestamptz,
  qbo_error text,
  qbo_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT time_entries_out_after_in CHECK (clock_out_at IS NULL OR clock_out_at >= clock_in_at),
  CONSTRAINT time_entries_rounded_when_closed CHECK ((clock_out_at IS NULL) = (rounded_minutes IS NULL)),
  CONSTRAINT time_entries_approved_is_closed CHECK (approved_at IS NULL OR clock_out_at IS NOT NULL),
  CONSTRAINT time_entries_sent_is_approved CHECK (qbo_time_activity_id IS NULL OR approved_at IS NOT NULL)
);
--> statement-breakpoint
-- One open entry per person: nobody can be clocked in twice.
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open ON public.time_entries (user_id) WHERE clock_out_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS time_entries_user_in_idx ON public.time_entries (user_id, clock_in_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS time_entries_in_idx ON public.time_entries (clock_in_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS time_entries_project_idx ON public.time_entries (project_id, clock_in_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_qbo_once ON public.time_entries (qbo_time_activity_id) WHERE qbo_time_activity_id IS NOT NULL;
--> statement-breakpoint
-- The locks, held by the database whoever writes: approved entries keep their times and job, sent entries stay approved
-- and keep their QuickBooks id, and the values from before the first adjustment are never rewritten.
CREATE OR REPLACE FUNCTION public.time_entries_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.approved_at IS NOT NULL OR OLD.qbo_time_activity_id IS NOT NULL THEN RAISE EXCEPTION 'Approved time entries cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  changed := (NEW.user_id, NEW.project_id, NEW.clock_in_at, NEW.clock_out_at, NEW.rounded_minutes)
             IS DISTINCT FROM (OLD.user_id, OLD.project_id, OLD.clock_in_at, OLD.clock_out_at, OLD.rounded_minutes);
  IF OLD.qbo_time_activity_id IS NOT NULL AND (changed OR NEW.approved_at IS NULL OR NEW.qbo_time_activity_id IS DISTINCT FROM OLD.qbo_time_activity_id) THEN
    RAISE EXCEPTION 'This entry has been sent to QuickBooks and can no longer be changed here';
  END IF;
  IF OLD.approved_at IS NOT NULL AND NEW.approved_at IS NOT NULL AND changed THEN
    RAISE EXCEPTION 'Approved time entries are locked';
  END IF;
  IF OLD.original IS NOT NULL AND NEW.original IS DISTINCT FROM OLD.original THEN
    RAISE EXCEPTION 'The original values of an adjusted entry are kept';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS time_entries_guard ON public.time_entries;
--> statement-breakpoint
CREATE TRIGGER time_entries_guard BEFORE UPDATE OR DELETE ON public.time_entries FOR EACH ROW EXECUTE FUNCTION public.time_entries_guard();
--> statement-breakpoint
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.time_entries FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.time_entries TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.time_entries TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "time_entries read" ON public.time_entries;
--> statement-breakpoint
-- A person reads their own entries; the office (manage_projects) reads everyone's. Crews never read each other's.
CREATE POLICY "time_entries read" ON public.time_entries FOR SELECT TO authenticated
  USING ((user_id = auth.uid() AND public.is_active(auth.uid())) OR public.has_capability('manage_projects'));
--> statement-breakpoint
-- Whether the signed-in person uses the time clock: marked "Goes to site", the BMD field level (company-wide or on a job),
-- or the office (manage_projects).
CREATE OR REPLACE FUNCTION public.time_clock_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active(auth.uid()) AND (
       public.has_capability('manage_projects')
    OR EXISTS (SELECT 1 FROM public.user_access a WHERE a.user_id = auth.uid() AND (a.level = 'bmd_field' OR a.goes_to_site))
    OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.user_id = auth.uid() AND m.role = 'bmd_field'));
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.time_clock_access() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.time_clock_access() TO authenticated;
--> statement-breakpoint
-- Names for the timesheet: the people who clock in, plus anyone who has an entry or has adjusted or approved one.
CREATE OR REPLACE FUNCTION public.time_people()
RETURNS TABLE(id uuid, full_name text, email text, clocks boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('manage_projects') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  WITH crew AS (
    SELECT p.id FROM public.profiles p
     WHERE public.is_active(p.id) AND (
           EXISTS (SELECT 1 FROM public.user_access a WHERE a.user_id = p.id AND (a.level = 'bmd_field' OR a.goes_to_site))
        OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.user_id = p.id AND m.role = 'bmd_field'))
  ), seen AS (
    SELECT t.user_id AS id FROM public.time_entries t
    UNION SELECT t.adjusted_by FROM public.time_entries t WHERE t.adjusted_by IS NOT NULL
    UNION SELECT t.approved_by FROM public.time_entries t WHERE t.approved_by IS NOT NULL
  )
  SELECT p.id, p.full_name, p.email, EXISTS (SELECT 1 FROM crew c WHERE c.id = p.id)
    FROM public.profiles p
   WHERE p.id IN (SELECT c.id FROM crew c) OR p.id IN (SELECT s.id FROM seen s)
   ORDER BY coalesce(p.full_name, p.email);
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.time_people() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.time_people() TO authenticated;
--> statement-breakpoint
-- Who is clocked in on a job right now, for the office. Names and the clock-in time only.
CREATE OR REPLACE FUNCTION public.time_clocked_in(_project uuid)
RETURNS TABLE(user_id uuid, full_name text, clock_in_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('manage_projects') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  SELECT t.user_id, coalesce(p.full_name, p.email), t.clock_in_at
    FROM public.time_entries t JOIN public.profiles p ON p.id = t.user_id
   WHERE t.project_id = _project AND t.clock_out_at IS NULL
   ORDER BY coalesce(p.full_name, p.email);
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.time_clocked_in(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.time_clocked_in(uuid) TO authenticated;
--> statement-breakpoint
-- What a person costs an hour and what their time is billed at by default, in cents. NULL is unknown, never zero.
-- Read by people who see pricing; changed only by people who both manage users and see pricing. Crews never read rates.
CREATE TABLE IF NOT EXISTS public.person_rates (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  hourly_cost_cents integer CHECK (hourly_cost_cents >= 0),
  billable_rate_cents integer CHECK (billable_rate_cents >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
--> statement-breakpoint
ALTER TABLE public.person_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.person_rates FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.person_rates TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.person_rates TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "person_rates read" ON public.person_rates;
--> statement-breakpoint
CREATE POLICY "person_rates read" ON public.person_rates FOR SELECT TO authenticated USING (public.has_capability('view_pricing'));
--> statement-breakpoint
DROP POLICY IF EXISTS "person_rates add" ON public.person_rates;
--> statement-breakpoint
CREATE POLICY "person_rates add" ON public.person_rates FOR INSERT TO authenticated WITH CHECK (public.has_capability('manage_users') AND public.has_capability('view_pricing'));
--> statement-breakpoint
DROP POLICY IF EXISTS "person_rates change" ON public.person_rates;
--> statement-breakpoint
CREATE POLICY "person_rates change" ON public.person_rates FOR UPDATE TO authenticated
  USING (public.has_capability('manage_users') AND public.has_capability('view_pricing'))
  WITH CHECK (public.has_capability('manage_users') AND public.has_capability('view_pricing'));
--> statement-breakpoint
-- A person's billable rate on one job, when it differs from their default. NULL means "use their default".
CREATE TABLE IF NOT EXISTS public.project_person_rates (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  billable_rate_cents integer CHECK (billable_rate_cents >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (project_id, user_id)
);
--> statement-breakpoint
ALTER TABLE public.project_person_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.project_person_rates FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_person_rates TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.project_person_rates TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "project_person_rates read" ON public.project_person_rates;
--> statement-breakpoint
CREATE POLICY "project_person_rates read" ON public.project_person_rates FOR SELECT TO authenticated USING (public.has_capability('view_pricing'));
--> statement-breakpoint
DROP POLICY IF EXISTS "project_person_rates add" ON public.project_person_rates;
--> statement-breakpoint
CREATE POLICY "project_person_rates add" ON public.project_person_rates FOR INSERT TO authenticated WITH CHECK (public.has_capability('manage_projects') AND public.has_capability('view_pricing'));
--> statement-breakpoint
DROP POLICY IF EXISTS "project_person_rates change" ON public.project_person_rates;
--> statement-breakpoint
CREATE POLICY "project_person_rates change" ON public.project_person_rates FOR UPDATE TO authenticated
  USING (public.has_capability('manage_projects') AND public.has_capability('view_pricing'))
  WITH CHECK (public.has_capability('manage_projects') AND public.has_capability('view_pricing'));
--> statement-breakpoint
DROP POLICY IF EXISTS "project_person_rates remove" ON public.project_person_rates;
--> statement-breakpoint
CREATE POLICY "project_person_rates remove" ON public.project_person_rates FOR DELETE TO authenticated USING (public.has_capability('manage_projects') AND public.has_capability('view_pricing'));
--> statement-breakpoint
-- Which QuickBooks Employee (or Vendor, for a subcontractor) each person is. Linked once by the office; written by the server only.
CREATE TABLE IF NOT EXISTS public.time_qbo_people (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  qbo_type text NOT NULL CHECK (qbo_type IN ('Employee','Vendor')),
  qbo_id text NOT NULL,
  qbo_name text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by uuid,
  UNIQUE (qbo_type, qbo_id)
);
--> statement-breakpoint
ALTER TABLE public.time_qbo_people ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.time_qbo_people FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.time_qbo_people TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.time_qbo_people TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS "time_qbo_people read" ON public.time_qbo_people;
--> statement-breakpoint
CREATE POLICY "time_qbo_people read" ON public.time_qbo_people FOR SELECT TO authenticated USING (public.has_capability('manage_projects'));
