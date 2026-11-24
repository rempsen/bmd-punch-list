-- Calendar links: who may turn what on, what a link returns, and that a revoked link returns nothing.
\set cmgr '''c0000000-0000-0000-0000-0000000000a1'''
\set cfield '''c0000000-0000-0000-0000-0000000000f1'''
\set cfield2 '''c0000000-0000-0000-0000-0000000000f2'''
CREATE FUNCTION pg_temp.hash(t text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;
CREATE FUNCTION pg_temp.ids(j jsonb) RETURNS text LANGUAGE sql AS $$ SELECT coalesce(string_agg(right(e->>'id', 1), ',' ORDER BY e->>'id'), '') FROM jsonb_array_elements(j) e $$;
CREATE TEMP TABLE cal_tok (who text PRIMARY KEY, tok text);
GRANT ALL ON cal_tok TO authenticated;

SET ROLE authenticated;
-- Field staff: own visits only, on jobs they belong to.
SELECT pg_temp.as_user(:cfield);
DO $$ BEGIN
  ASSERT pg_temp.raises($q$SELECT public.calendar_feed_save('all', NULL)$q$), 'field staff cannot choose All visits';
  ASSERT pg_temp.raises($q$SELECT public.calendar_feed_save('mine', 'c1000000-0000-0000-0000-000000000002')$q$), 'cannot choose a job they do not belong to';
  ASSERT pg_temp.raises($q$SELECT public.calendar_feed_save('everything', NULL)$q$), 'unknown choice refused';
  ASSERT pg_temp.raises($q$SELECT public.calendar_feed_read(repeat('a', 64))$q$), 'the browser cannot read a link''s contents';
  ASSERT pg_temp.raises($q$SELECT public.calendar_visits_for('c0000000-0000-0000-0000-0000000000a1')$q$), 'the browser cannot ask for someone''s visits';
  ASSERT pg_temp.raises($q$SELECT token_hash FROM public.calendar_feeds$q$), 'the token hash cannot be read from the browser';
  ASSERT pg_temp.raises($q$UPDATE public.calendar_feeds SET scope = 'all'$q$), 'no direct writes';
  ASSERT pg_temp.raises($q$SELECT * FROM public.calendar_outlook_events$q$), 'event links are server only';
END $$;
SELECT public.calendar_feed_save('mine', NULL);
INSERT INTO cal_tok SELECT 'field', public.calendar_feed_link(true);
DO $$ BEGIN
  ASSERT (SELECT length(tok) = 64 AND tok ~ '^[0-9a-f]+$' FROM cal_tok WHERE who = 'field'), 'token is 64 hex characters';
  ASSERT (SELECT count(*) FROM public.calendar_feeds) = 1, 'a person sees their own row only';
  ASSERT (SELECT link_created_at IS NOT NULL FROM public.calendar_feeds), 'link shows as on';
END $$;

SELECT pg_temp.as_user(:cmgr);
SELECT public.calendar_feed_save('all', NULL);
INSERT INTO cal_tok SELECT 'mgr', public.calendar_feed_link(true);
DO $$ BEGIN ASSERT (SELECT count(*) FROM public.calendar_feeds WHERE link_created_at IS NOT NULL) = 2, 'an admin sees who has a link on'; END $$;

RESET ROLE;
DO $$ DECLARE j jsonb; t text; BEGIN
  -- The token itself is not stored anywhere.
  ASSERT NOT EXISTS (SELECT 1 FROM public.calendar_feeds f JOIN cal_tok c ON f.token_hash = c.tok), 'only the hash is kept';
  SELECT tok INTO t FROM cal_tok WHERE who = 'field';
  j := public.calendar_feed_read(pg_temp.hash(t));
  ASSERT j->>'scope' = 'mine', 'field feed is My visits';
  ASSERT pg_temp.ids(j->'visits') = '1,2', format('field: own visits on their own job, inside the window, cancelled included; got %s', pg_temp.ids(j->'visits'));
  ASSERT j->'visits'->0->'project'->>'address' = '1 Main St, Winnipeg' AND j->'visits'->0->'project'->>'project_number' = '26-001', 'job details come with each visit';
  ASSERT (SELECT link_last_used_at IS NOT NULL FROM public.calendar_feeds WHERE user_id = 'c0000000-0000-0000-0000-0000000000f1'), 'last used is recorded';

  SELECT tok INTO t FROM cal_tok WHERE who = 'mgr';
  j := public.calendar_feed_read(pg_temp.hash(t));
  ASSERT j->>'scope' = 'all' AND pg_temp.ids(j->'visits') = '1,2,3,4,7', format('manager: every visit in the window; got %s', pg_temp.ids(j->'visits'));

  -- One job.
  UPDATE public.calendar_feeds SET project_id = 'c1000000-0000-0000-0000-000000000002' WHERE user_id = 'c0000000-0000-0000-0000-0000000000a1';
  j := public.calendar_feed_read(pg_temp.hash(t));
  ASSERT pg_temp.ids(j->'visits') = '3,7' AND j->>'job' = 'Cal Job Two', 'one job only';
  UPDATE public.calendar_feeds SET project_id = NULL WHERE user_id = 'c0000000-0000-0000-0000-0000000000a1';

  -- The manager loses view_pipeline: All visits falls back to their own (none are assigned to them).
  UPDATE public.user_access SET level = 'bmd_field', all_jobs = false WHERE user_id = 'c0000000-0000-0000-0000-0000000000a1';
  j := public.calendar_feed_read(pg_temp.hash(t));
  ASSERT j->>'scope' = 'mine' AND pg_temp.ids(j->'visits') = '', 'without view_pipeline an All visits link returns only their own';
  UPDATE public.user_access SET level = 'bmd_manager', all_jobs = true WHERE user_id = 'c0000000-0000-0000-0000-0000000000a1';

  -- A field person taken off the job stops getting its visits.
  DELETE FROM public.project_members WHERE user_id = 'c0000000-0000-0000-0000-0000000000f1';
  SELECT tok INTO t FROM cal_tok WHERE who = 'field';
  ASSERT pg_temp.ids(public.calendar_feed_read(pg_temp.hash(t))->'visits') = '', 'off the job, off the calendar';
  INSERT INTO public.project_members (project_id, user_id, role, role_source) VALUES ('c1000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000f1','bmd_field','level');

  -- Deactivated: the link returns nothing at all.
  UPDATE public.user_access SET status = 'deactivated' WHERE user_id = 'c0000000-0000-0000-0000-0000000000f1';
  ASSERT public.calendar_feed_read(pg_temp.hash(t)) IS NULL, 'a deactivated person''s link is dead';
  ASSERT public.calendar_visits_for('c0000000-0000-0000-0000-0000000000f1') = '[]'::jsonb, 'and so is their Outlook sync';
  UPDATE public.user_access SET status = 'active' WHERE user_id = 'c0000000-0000-0000-0000-0000000000f1';

  ASSERT public.calendar_feed_read(repeat('0', 64)) IS NULL AND public.calendar_feed_read('nonsense') IS NULL AND public.calendar_feed_read(NULL) IS NULL, 'unknown token';
  ASSERT public.calendar_visits_for('c0000000-0000-0000-0000-0000000000f2') = '[]'::jsonb, 'no row, no visits';

  -- Rate limit: 30 reads in five minutes, then refused until the window passes.
  UPDATE public.calendar_feeds SET window_started_at = now(), window_hits = 29 WHERE user_id = 'c0000000-0000-0000-0000-0000000000f1';
  ASSERT public.calendar_feed_read(pg_temp.hash(t)) ? 'visits', 'the 30th read is served';
  ASSERT public.calendar_feed_read(pg_temp.hash(t)) = '{"limited": true}'::jsonb, 'the 31st is refused';
  UPDATE public.calendar_feeds SET window_started_at = now() - interval '6 minutes' WHERE user_id = 'c0000000-0000-0000-0000-0000000000f1';
  ASSERT public.calendar_feed_read(pg_temp.hash(t)) ? 'visits', 'and served again after the window';
END $$;

-- New link: the old token dies at once. Turn off: so does the new one.
SET ROLE authenticated;
SELECT pg_temp.as_user(:cfield);
INSERT INTO cal_tok SELECT 'field-new', public.calendar_feed_link(true);
RESET ROLE;
DO $$ BEGIN
  ASSERT public.calendar_feed_read(pg_temp.hash((SELECT tok FROM cal_tok WHERE who = 'field'))) IS NULL, 'old token revoked by New link';
  ASSERT public.calendar_feed_read(pg_temp.hash((SELECT tok FROM cal_tok WHERE who = 'field-new'))) ? 'visits', 'new token works';
END $$;
SET ROLE authenticated;
SELECT public.calendar_feed_link(false);
DO $$ BEGIN
  ASSERT (SELECT link_created_at IS NULL AND scope = 'mine' FROM public.calendar_feeds), 'turned off, choice kept';
  ASSERT pg_temp.raises($q$SELECT public.calendar_feed_revoke('c0000000-0000-0000-0000-0000000000a1')$q$), 'field staff cannot revoke someone else''s link';
END $$;
RESET ROLE;
DO $$ BEGIN ASSERT public.calendar_feed_read(pg_temp.hash((SELECT tok FROM cal_tok WHERE who = 'field-new'))) IS NULL, 'turned off: nothing'; END $$;

-- An admin revokes the manager's... here the manager revokes their own through the admin action (manage_users).
SET ROLE authenticated;
SELECT pg_temp.as_user(:cmgr);
SELECT public.calendar_feed_revoke('c0000000-0000-0000-0000-0000000000a1');
RESET ROLE;
DO $$ BEGIN ASSERT public.calendar_feed_read(pg_temp.hash((SELECT tok FROM cal_tok WHERE who = 'mgr'))) IS NULL, 'admin revoke kills the link'; END $$;

-- A deactivated person cannot turn a link on.
UPDATE public.user_access SET status = 'deactivated' WHERE user_id = 'c0000000-0000-0000-0000-0000000000f2';
SET ROLE authenticated;
SELECT pg_temp.as_user(:cfield2);
DO $$ BEGIN ASSERT pg_temp.raises($q$SELECT public.calendar_feed_link(true)$q$), 'deactivated: no link'; END $$;
RESET ROLE;
SELECT 'calendar SQL tests passed' AS result;
