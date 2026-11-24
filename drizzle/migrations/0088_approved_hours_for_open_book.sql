-- Joins the time clock to open-book billing: the approved hours on a job, one row per time entry, in the shape
-- open_book_approved_hours() (0087) looks for. Hours are the rounded, paid hours. People who bill only.
CREATE OR REPLACE FUNCTION public.approved_hours_for_job(_project uuid)
RETURNS TABLE (id uuid, person_name text, work_date date, hours numeric, approved boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  SELECT t.id, coalesce(p.full_name, p.email, 'Unknown')::text,
         (t.clock_in_at AT TIME ZONE 'America/Winnipeg')::date,
         round(t.rounded_minutes / 60.0, 2), t.approved_at IS NOT NULL
    FROM public.time_entries t JOIN public.profiles p ON p.id = t.user_id
   WHERE t.project_id = _project AND t.clock_out_at IS NOT NULL AND t.rounded_minutes IS NOT NULL;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approved_hours_for_job(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approved_hours_for_job(uuid) TO authenticated;
