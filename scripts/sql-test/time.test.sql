-- Time clock (0085): who reads what, one open entry per person, the approval and QuickBooks locks, and who touches rates.
CREATE OR REPLACE FUNCTION pg_temp.t_as(u text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', u, false) $$;
CREATE OR REPLACE FUNCTION pg_temp.t_raises(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
\set office '00000000-0000-0000-0000-00000000e0a1'
\set ana '00000000-0000-0000-0000-00000000e0a2'
\set ben '00000000-0000-0000-0000-00000000e0a3'
\set job '10000000-0000-0000-0000-0000000000e1'

-- The server (table owner / service role) writes entries.
INSERT INTO time_entries (id, user_id, project_id, clock_in_at, clock_out_at, rounded_minutes) VALUES
  ('20000000-0000-0000-0000-0000000000a1', :'ana', :'job', '2025-11-24 13:02+00', '2025-11-24 21:40+00', 525),
  ('20000000-0000-0000-0000-0000000000a2', :'ana', :'job', '2025-11-25 13:00+00', NULL, NULL),
  ('20000000-0000-0000-0000-0000000000b1', :'ben', :'job', '2025-11-24 14:00+00', '2025-11-24 22:00+00', 480);
DO $$ BEGIN
  ASSERT (SELECT rounding_minutes = 15 AND overtime_daily_minutes = 480 AND overtime_weekly_minutes = 2400 FROM time_settings WHERE id = 1), 'defaults: 15 minutes, 8 h a day, 40 h a week';
  -- One open entry per person.
  ASSERT pg_temp.t_raises($q$INSERT INTO time_entries (user_id, project_id, clock_in_at) VALUES ('00000000-0000-0000-0000-00000000e0a2','10000000-0000-0000-0000-0000000000e1', now())$q$) LIKE '%time_entries_one_open%', 'a second open entry for the same person is refused';
  ASSERT pg_temp.t_raises($q$INSERT INTO time_entries (user_id, project_id, clock_in_at) VALUES ('00000000-0000-0000-0000-00000000e0a3','10000000-0000-0000-0000-0000000000e1', now())$q$) IS NULL, 'another person may be open at the same time';
  -- Shape rules.
  ASSERT pg_temp.t_raises($q$INSERT INTO time_entries (user_id, project_id, clock_in_at, clock_out_at, rounded_minutes) VALUES ('00000000-0000-0000-0000-00000000e0a3','10000000-0000-0000-0000-0000000000e1', '2025-11-26 14:00+00', '2025-11-26 13:00+00', 0)$q$) LIKE '%time_entries_out_after_in%', 'out before in is refused';
  ASSERT pg_temp.t_raises($q$UPDATE time_entries SET approved_at = now() WHERE id = '20000000-0000-0000-0000-0000000000a2'$q$) LIKE '%time_entries_approved_is_closed%', 'an open entry cannot be approved';
  ASSERT pg_temp.t_raises($q$UPDATE time_entries SET qbo_time_activity_id = '5' WHERE id = '20000000-0000-0000-0000-0000000000a1'$q$) LIKE '%time_entries_sent_is_approved%', 'only approved entries can carry a QuickBooks id';
  -- Adjusting keeps the original; approving locks; sending locks for good.
  UPDATE time_entries SET clock_out_at = '2025-11-24 21:30+00', rounded_minutes = 510, original = '{"clock_out_at":"2025-11-24T21:40:00Z"}', adjust_reason = 'x' WHERE id = '20000000-0000-0000-0000-0000000000a1';
  ASSERT pg_temp.t_raises($q$UPDATE time_entries SET original = '{"clock_out_at":"made up"}' WHERE id = '20000000-0000-0000-0000-0000000000a1'$q$) = 'The original values of an adjusted entry are kept', 'the original cannot be rewritten';
  UPDATE time_entries SET approved_at = now(), approved_by = '00000000-0000-0000-0000-00000000e0a1' WHERE id = '20000000-0000-0000-0000-0000000000a1';
  ASSERT pg_temp.t_raises($q$UPDATE time_entries SET rounded_minutes = 600 WHERE id = '20000000-0000-0000-0000-0000000000a1'$q$) = 'Approved time entries are locked', 'approved entries are locked';
  ASSERT pg_temp.t_raises($q$DELETE FROM time_entries WHERE id = '20000000-0000-0000-0000-0000000000a1'$q$) = 'Approved time entries cannot be deleted', 'approved entries cannot be deleted';
  UPDATE time_entries SET approved_at = NULL, approved_by = NULL WHERE id = '20000000-0000-0000-0000-0000000000a1';
  UPDATE time_entries SET rounded_minutes = 510, approved_at = now(), approved_by = '00000000-0000-0000-0000-00000000e0a1' WHERE id = '20000000-0000-0000-0000-0000000000a1';
  UPDATE time_entries SET qbo_error = 'refused once', qbo_attempts = 1 WHERE id = '20000000-0000-0000-0000-0000000000a1';
  UPDATE time_entries SET qbo_time_activity_id = '5', qbo_sent_at = now(), qbo_error = NULL WHERE id = '20000000-0000-0000-0000-0000000000a1';
  ASSERT pg_temp.t_raises($q$UPDATE time_entries SET approved_at = NULL WHERE id = '20000000-0000-0000-0000-0000000000a1'$q$) LIKE 'This entry has been sent to QuickBooks%', 'approval cannot be removed once sent';
  ASSERT pg_temp.t_raises($q$UPDATE time_entries SET qbo_time_activity_id = '6' WHERE id = '20000000-0000-0000-0000-0000000000a1'$q$) LIKE 'This entry has been sent to QuickBooks%', 'the QuickBooks id never changes';
  ASSERT pg_temp.t_raises($q$UPDATE time_entries SET approved_at = now(), qbo_time_activity_id = '5' WHERE id = '20000000-0000-0000-0000-0000000000b1'$q$) LIKE '%time_entries_qbo_once%', 'one QuickBooks record is never two entries';
END $$;
INSERT INTO person_rates (user_id, hourly_cost_cents, billable_rate_cents) VALUES (:'ana', 3250, NULL);

SET ROLE authenticated;
-- A crew member: own entries only, no writes, no rates, no names of others.
SELECT pg_temp.t_as(:'ana');
DO $$ BEGIN
  ASSERT public.time_clock_access(), 'the field level uses the time clock';
  ASSERT (SELECT count(*) FROM time_entries) = 2 AND (SELECT bool_and(user_id = auth.uid()) FROM time_entries), 'a crew member reads only their own entries';
  ASSERT pg_temp.t_raises($q$INSERT INTO time_entries (user_id, project_id, clock_in_at) VALUES (auth.uid(), '10000000-0000-0000-0000-0000000000e1', now() - interval '9 hours')$q$) LIKE 'permission denied%', 'the browser cannot write entries';
  ASSERT pg_temp.t_raises($q$UPDATE time_entries SET rounded_minutes = 900$q$) LIKE 'permission denied%', 'the browser cannot change entries';
  ASSERT (SELECT count(*) FROM person_rates) = 0, 'crews never read rates, not even their own';
  ASSERT (SELECT count(*) FROM project_person_rates) = 0 AND (SELECT count(*) FROM time_qbo_people) = 0, 'crews read no job rates or QuickBooks links';
  ASSERT pg_temp.t_raises($q$INSERT INTO person_rates (user_id, hourly_cost_cents) VALUES (auth.uid(), 9900)$q$) IS NOT NULL, 'crews cannot set a rate';
  ASSERT pg_temp.t_raises($q$SELECT * FROM public.time_people()$q$) = 'Not allowed', 'crews do not list people';
  ASSERT pg_temp.t_raises($q$SELECT * FROM public.time_clocked_in('10000000-0000-0000-0000-0000000000e1')$q$) = 'Not allowed', 'crews do not see who is clocked in';
  ASSERT (SELECT rounding_minutes FROM time_settings) = 15, 'everyone reads the rounding setting';
  UPDATE time_settings SET rounding_minutes = 1;
  ASSERT (SELECT rounding_minutes FROM time_settings) = 15, 'crews cannot change the settings';
END $$;
SELECT pg_temp.t_as(:'ben');
DO $$ BEGIN
  ASSERT public.time_clock_access(), 'a person marked Goes to site uses the time clock';
  ASSERT (SELECT bool_and(user_id = auth.uid()) FROM time_entries), 'the other crew member also sees only their own';
END $$;
SELECT pg_temp.t_as('00000000-0000-0000-0000-00000000e0a4');
DO $$ BEGIN
  ASSERT NOT public.time_clock_access(), 'a trade does not get the time clock';
  ASSERT (SELECT count(*) FROM time_entries) = 0, 'a trade reads no entries';
END $$;
-- The office.
SELECT pg_temp.t_as(:'office');
DO $$ BEGIN
  ASSERT public.time_clock_access(), 'the office sees the time clock too';
  ASSERT (SELECT count(*) FROM time_entries) = 4, 'the office reads every entry';
  ASSERT (SELECT count(*) FROM public.time_people() WHERE clocks AND email LIKE 't-%') = 2, 'the two crews are listed';
  ASSERT (SELECT count(*) FROM public.time_people() WHERE full_name = 'Olga Office' AND NOT clocks) = 1, 'someone who approved is listed for their name';
  ASSERT (SELECT string_agg(full_name, ', ') FROM public.time_clocked_in('10000000-0000-0000-0000-0000000000e1')) = 'Ana Crew, Ben Crew', 'who is clocked in on the job';
  ASSERT (SELECT hourly_cost_cents = 3250 AND billable_rate_cents IS NULL FROM person_rates), 'pricing people read rates; unknown stays NULL';
  INSERT INTO person_rates (user_id, hourly_cost_cents, billable_rate_cents) VALUES ('00000000-0000-0000-0000-00000000e0a3', 0, 8500);
  UPDATE person_rates SET billable_rate_cents = 9000 WHERE user_id = '00000000-0000-0000-0000-00000000e0a2';
  ASSERT (SELECT hourly_cost_cents FROM person_rates WHERE user_id = '00000000-0000-0000-0000-00000000e0a3') = 0, 'a zero cost is kept as zero';
  INSERT INTO project_person_rates (project_id, user_id, billable_rate_cents) VALUES ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000e0a2', 9500);
  ASSERT pg_temp.t_raises($q$INSERT INTO person_rates (user_id, hourly_cost_cents) VALUES ('00000000-0000-0000-0000-00000000e0a4', -1)$q$) IS NOT NULL, 'a negative rate is refused';
  ASSERT pg_temp.t_raises($q$INSERT INTO time_qbo_people (user_id, qbo_type, qbo_id) VALUES ('00000000-0000-0000-0000-00000000e0a2', 'Employee', '55')$q$) LIKE 'permission denied%', 'QuickBooks links are written by the server only';
  UPDATE time_settings SET rounding_minutes = 5, overtime_daily_minutes = 600;
  ASSERT (SELECT rounding_minutes = 5 AND overtime_daily_minutes = 600 FROM time_settings), 'the office changes the settings';
  ASSERT pg_temp.t_raises($q$UPDATE time_settings SET rounding_minutes = 0$q$) IS NOT NULL, 'a zero increment is refused';
END $$;
-- Manages users and projects but does not see pricing: no rates at all.
SELECT pg_temp.t_as('00000000-0000-0000-0000-00000000e0a5');
DO $$ BEGIN
  ASSERT public.has_capability('manage_users') AND NOT public.has_capability('view_pricing'), 'test person manages users without pricing';
  ASSERT (SELECT count(*) FROM person_rates) = 0 AND (SELECT count(*) FROM project_person_rates) = 0, 'without pricing, no rates are read';
  ASSERT pg_temp.t_raises($q$INSERT INTO person_rates (user_id, hourly_cost_cents) VALUES ('00000000-0000-0000-0000-00000000e0a4', 100)$q$) IS NOT NULL, 'without pricing, no rate is set';
  UPDATE person_rates SET hourly_cost_cents = 1;
  ASSERT (SELECT count(*) FROM time_entries) = 4, 'they still run timesheets';
END $$;
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT hourly_cost_cents FROM person_rates WHERE user_id = '00000000-0000-0000-0000-00000000e0a2') = 3250, 'the rate was not changed by someone without pricing'; END $$;
SELECT 'time clock SQL tests passed' AS result;
