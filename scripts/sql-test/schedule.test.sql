-- Tests for migration 0083. Each block raises on the first thing that is wrong.
INSERT INTO public.projects (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Test Take Off');
INSERT INTO public.profiles (id, email, full_name) VALUES ('00000000-0000-0000-0000-0000000000b1', 'alex@example.test', 'Alex Staff');
INSERT INTO public.test_caps VALUES ('manage_projects'), ('view_pipeline');

-- Settings: read by people who schedule, changed only with manage_settings.
DO $$ DECLARE n int; BEGIN
  SET LOCAL ROLE authenticated;
  IF (SELECT workdays FROM public.schedule_settings WHERE id = 1) <> '{1,2,3,4,5}' THEN RAISE EXCEPTION 'default workdays are Monday to Friday'; END IF;
  UPDATE public.schedule_settings SET workdays = '{1,2,3,4,5,6}' WHERE id = 1; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'without manage_settings nothing is changed'; END IF;
  RESET ROLE;
  INSERT INTO public.test_caps VALUES ('manage_settings');
  SET LOCAL ROLE authenticated;
  UPDATE public.schedule_settings SET holidays = '[{"day":"2026-12-25","name":"Christmas Day"}]', assignment_cc = '{ops@example.test}' WHERE id = 1; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'manage_settings may change the settings'; END IF;
  BEGIN UPDATE public.schedule_settings SET workdays = '{9}' WHERE id = 1; RAISE EXCEPTION 'weekday 9 must be refused'; EXCEPTION WHEN check_violation THEN NULL; END;
  RESET ROLE;
END $$;

-- A run of three days, made by the office.
DO $$ DECLARE run uuid := gen_random_uuid(); r record; BEGIN
  SET LOCAL ROLE authenticated;
  INSERT INTO public.install_visits (id, project_id, starts_at, run_id, run_day, run_total, report_to, report_time, tentative) VALUES
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '2026-07-06 13:00+00', run, 1, 3, 'shop', '07:00', false),
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '2026-07-07 13:00+00', run, 2, 3, 'shop', '07:00', false),
    ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', '2026-07-08 13:00+00', run, 3, 3, 'shop', '07:00', false);
  -- Moving day 1 past day 3 renumbers by date.
  UPDATE public.install_visits SET starts_at = '2026-07-09 13:00+00' WHERE id = '00000000-0000-0000-0000-000000000001';
  IF (SELECT string_agg(right(id::text, 1) || ':' || run_day || '/' || run_total, ' ' ORDER BY starts_at) FROM public.install_visits WHERE run_id = run) <> '2:1/3 3:2/3 1:3/3' THEN RAISE EXCEPTION 'a moved day is renumbered in date order'; END IF;
  -- Removing a day renumbers the rest and takes it out of the run.
  UPDATE public.install_visits SET status = 'cancelled' WHERE id = '00000000-0000-0000-0000-000000000003';
  IF (SELECT string_agg(right(id::text, 1) || ':' || run_day || '/' || run_total, ' ' ORDER BY starts_at) FROM public.install_visits WHERE run_id = run) <> '2:1/2 1:2/2' THEN RAISE EXCEPTION 'removing a day renumbers the rest'; END IF;
  SELECT run_id, run_day, run_total INTO r FROM public.install_visits WHERE id = '00000000-0000-0000-0000-000000000003';
  IF r.run_id IS NOT NULL OR r.run_day IS NOT NULL THEN RAISE EXCEPTION 'a cancelled day leaves the run'; END IF;
  -- A run left with one day is an ordinary visit.
  UPDATE public.install_visits SET status = 'cancelled' WHERE id = '00000000-0000-0000-0000-000000000002';
  SELECT run_id, run_day, run_total INTO r FROM public.install_visits WHERE id = '00000000-0000-0000-0000-000000000001';
  IF r.run_id IS NOT NULL OR r.run_day IS NOT NULL OR r.run_total IS NOT NULL THEN RAISE EXCEPTION 'one day left is no run'; END IF;
  -- The office cannot write a confirmation itself.
  BEGIN UPDATE public.install_visits SET confirmation = 'confirmed' WHERE id = '00000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'confirmation must not be writable from the browser'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.respond_to_assignment(repeat('a', 64), 'confirmed'); RAISE EXCEPTION 'respond_to_assignment is server only'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.activate_assignment_link(gen_random_uuid()); RAISE EXCEPTION 'activate_assignment_link is server only'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM token_hash FROM public.crew_assignment_links; RAISE EXCEPTION 'the link hash must not be readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
END $$;

-- Sending, answering, expiry and what resets an answer. Acting as the server.
DO $$ DECLARE link uuid; link2 uuid; old uuid; n int; r record; out text;
  v1 uuid := '00000000-0000-0000-0000-000000000011'; v2 uuid := '00000000-0000-0000-0000-000000000012'; v3 uuid := '00000000-0000-0000-0000-000000000013';
BEGIN
  INSERT INTO public.install_visits (id, project_id, starts_at, assigned_user_id) VALUES
    (v1, '00000000-0000-0000-0000-0000000000a1', now() + interval '1 day', '00000000-0000-0000-0000-0000000000b1'),
    (v2, '00000000-0000-0000-0000-0000000000a1', now() + interval '1 day', '00000000-0000-0000-0000-0000000000b1'),
    (v3, '00000000-0000-0000-0000-0000000000a1', now() + interval '1 day', '00000000-0000-0000-0000-0000000000b1');
  UPDATE public.install_visits SET tentative = true WHERE id = v3;
  INSERT INTO public.crew_assignment_links (token_hash, day, crew_key, crew_name, email, cc, visit_ids, sent_by_name, expires_at)
  VALUES (repeat('a', 64), current_date + 1, 'user:b1', 'Alex Staff', 'alex@example.test', '{ops@example.test}', ARRAY[v1, v2, v3], 'Dan', now() + interval '2 days') RETURNING id INTO link;
  -- Before the email has left, the link does nothing.
  IF public.respond_to_assignment(repeat('a', 64), 'confirmed') <> 'not_found' THEN RAISE EXCEPTION 'an unsent link must not answer'; END IF;
  n := public.activate_assignment_link(link);
  IF n <> 2 THEN RAISE EXCEPTION 'two visits are marked sent (the tentative one is not), got %', n; END IF;
  IF (SELECT count(*) FROM public.install_visits WHERE confirmation = 'waiting' AND assignment_link_id = link) <> 2 THEN RAISE EXCEPTION 'sent visits read Waiting'; END IF;
  IF (SELECT confirmation FROM public.install_visits WHERE id = v3) <> 'not_sent' THEN RAISE EXCEPTION 'a tentative visit is never marked sent'; END IF;
  IF (SELECT note FROM public.install_visit_events WHERE visit_id = v1 AND status = 'assignment_sent') <> 'Assignment emailed to Alex Staff by Dan (1 copied)' THEN RAISE EXCEPTION 'the send is on the visit''s activity'; END IF;
  IF public.activate_assignment_link(link) <> 0 THEN RAISE EXCEPTION 'activating twice does nothing'; END IF;
  -- An unknown link.
  IF public.respond_to_assignment(repeat('b', 64), 'confirmed') <> 'not_found' THEN RAISE EXCEPTION 'unknown link'; END IF;
  -- One tap confirms every visit in the message, once.
  IF public.respond_to_assignment(repeat('a', 64), 'confirmed') <> 'confirmed' THEN RAISE EXCEPTION 'confirm'; END IF;
  PERFORM public.respond_to_assignment(repeat('a', 64), 'confirmed');
  IF (SELECT count(*) FROM public.install_visits WHERE confirmation = 'confirmed') <> 2 THEN RAISE EXCEPTION 'both visits confirmed'; END IF;
  IF (SELECT count(*) FROM public.install_visit_events WHERE status = 'confirmed' AND source = 'crew') <> 2 THEN RAISE EXCEPTION 'one activity entry per visit, not one per tap'; END IF;
  -- The answer can change; the reason is kept.
  IF public.respond_to_assignment(repeat('a', 64), 'declined', '  truck is in the shop  ') <> 'declined' THEN RAISE EXCEPTION 'decline'; END IF;
  SELECT confirmation, decline_reason INTO r FROM public.install_visits WHERE id = v1;
  IF r.confirmation <> 'declined' OR r.decline_reason <> 'truck is in the shop' THEN RAISE EXCEPTION 'declined with its reason'; END IF;
  IF (SELECT note FROM public.install_visit_events WHERE visit_id = v1 AND status = 'declined') <> 'Alex Staff can''t make it: truck is in the shop' THEN RAISE EXCEPTION 'the decline is on the activity'; END IF;
  -- Giving the visit to someone else clears the answer, and the old link no longer covers it.
  UPDATE public.install_visits SET assigned_user_id = NULL, assigned_name = 'Brodie' WHERE id = v1;
  SELECT confirmation, assignment_link_id, decline_reason INTO r FROM public.install_visits WHERE id = v1;
  IF r.confirmation <> 'not_sent' OR r.assignment_link_id IS NOT NULL OR r.decline_reason IS NOT NULL THEN RAISE EXCEPTION 'a new crew starts at Not sent'; END IF;
  PERFORM public.respond_to_assignment(repeat('a', 64), 'confirmed');
  IF (SELECT confirmation FROM public.install_visits WHERE id = v1) <> 'not_sent' THEN RAISE EXCEPTION 'the old link must not touch a reassigned visit'; END IF;
  IF (SELECT confirmation FROM public.install_visits WHERE id = v2) <> 'confirmed' THEN RAISE EXCEPTION 'the other visit still follows the link'; END IF;
  -- A new time on the same day keeps the answer; another day clears it.
  UPDATE public.install_visits SET starts_at = starts_at + interval '1 minute' WHERE id = v2;
  IF (SELECT confirmation FROM public.install_visits WHERE id = v2) <> 'confirmed' THEN RAISE EXCEPTION 'a small time change keeps the answer'; END IF;
  UPDATE public.install_visits SET starts_at = starts_at + interval '3 days' WHERE id = v2;
  IF (SELECT confirmation FROM public.install_visits WHERE id = v2) <> 'not_sent' THEN RAISE EXCEPTION 'another day clears the answer'; END IF;
  -- With no visit left on it, the link says it was replaced.
  IF public.respond_to_assignment(repeat('a', 64), 'confirmed') <> 'replaced' THEN RAISE EXCEPTION 'replaced'; END IF;
  -- Sending again: a visit already confirmed stays confirmed.
  INSERT INTO public.crew_assignment_links (token_hash, day, crew_key, crew_name, email, visit_ids, sent_by_name, expires_at)
  VALUES (repeat('c', 64), current_date + 4, 'user:b1', 'Alex Staff', 'alex@example.test', ARRAY[v2], 'Dan', now() + interval '5 days') RETURNING id INTO link2;
  PERFORM public.activate_assignment_link(link2);
  PERFORM public.respond_to_assignment(repeat('c', 64), 'confirmed');
  INSERT INTO public.crew_assignment_links (token_hash, day, crew_key, crew_name, email, visit_ids, sent_by_name, expires_at)
  VALUES (repeat('d', 64), current_date + 4, 'user:b1', 'Alex Staff', 'alex@example.test', ARRAY[v2], 'Dan', now() + interval '5 days') RETURNING id INTO old;
  PERFORM public.activate_assignment_link(old);
  IF (SELECT confirmation FROM public.install_visits WHERE id = v2) <> 'confirmed' THEN RAISE EXCEPTION 'sending again keeps a confirmed visit confirmed'; END IF;
  IF public.respond_to_assignment(repeat('c', 64), 'declined') <> 'replaced' THEN RAISE EXCEPTION 'the earlier link is replaced by the newer message'; END IF;
  -- After the day is over the link is expired and changes nothing.
  UPDATE public.crew_assignment_links SET expires_at = now() - interval '1 second' WHERE id = old;
  IF public.respond_to_assignment(repeat('d', 64), 'declined') <> 'expired' THEN RAISE EXCEPTION 'expired'; END IF;
  IF (SELECT confirmation FROM public.install_visits WHERE id = v2) <> 'confirmed' THEN RAISE EXCEPTION 'an expired link changes nothing'; END IF;
  -- Marking a visit tentative, or cancelling it, clears the answer.
  UPDATE public.install_visits SET tentative = true WHERE id = v2;
  IF (SELECT confirmation FROM public.install_visits WHERE id = v2) <> 'not_sent' THEN RAISE EXCEPTION 'tentative clears the answer'; END IF;
END $$;
SELECT 'schedule tests passed' AS result;
