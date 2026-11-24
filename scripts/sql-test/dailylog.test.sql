-- Daily logs, requests and the crew's lists: who can read and write what. Each block runs as one person, under row-level security.
\set dan '''00000000-0000-0000-0000-0000000000d1'''
\set chuck '''00000000-0000-0000-0000-0000000000c1'''
\set mgr '''00000000-0000-0000-0000-0000000000a1'''
\set field '''00000000-0000-0000-0000-0000000000f1'''
\set cleo '''00000000-0000-0000-0000-0000000000e1'''
\set p1 '''10000000-0000-0000-0000-000000000001'''
\set p2 '''10000000-0000-0000-0000-000000000002'''
CREATE FUNCTION public.t_as_user(u text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', u, false) $$;
-- True when the statement is refused (an error, or a write that row-level security turned into nothing).
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$ DECLARE n bigint; BEGIN EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT; RETURN n = 0; EXCEPTION WHEN others THEN RETURN true; END $$;

-- An estimate on Hyatt: Base (accepted) with an LVT line (material + adhesive + labour), an optional line and a not-needed row; a draft option that must not show.
INSERT INTO suppliers (id, name) VALUES ('50000000-0000-0000-0000-000000000001', 'Prosol');
INSERT INTO catalogue_materials (id, name, colour, supplier_id, unit_cost_cents) VALUES ('60000000-0000-0000-0000-000000000001', 'LVT Oak', 'Natural', '50000000-0000-0000-0000-000000000001', 5000);
INSERT INTO estimate_versions (id, project_id, name, is_base, status, sort_order) VALUES
  ('70000000-0000-0000-0000-000000000001', :p1, 'Base', true, 'accepted', 1), ('70000000-0000-0000-0000-000000000002', :p1, 'Option B', false, 'draft', 2),
  ('70000000-0000-0000-0000-000000000003', :p2, 'Base', true, 'draft', 1);
INSERT INTO estimate_lines (id, version_id, section, description, driver_qty, driver_uom, selection, sort_order) VALUES
  ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'Level 1', 'Corridor LVT', 1000, 'SF', 'required', 1),
  ('80000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'Level 1', 'Optional upgrade', 100, 'SF', 'optional', 2),
  ('80000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 'Level 2', 'Option B room', 200, 'SF', 'required', 1),
  ('80000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000003', '', 'Lobby carpet', 900, 'SF', 'required', 1);
INSERT INTO estimate_line_components (line_id, kind, label, catalogue_material_id, unit_cost_cents, cost_uom, purchase_uom, coverage_per_purchase_unit, waste_pct, round_up, not_applicable, sort_order) VALUES
  ('80000000-0000-0000-0000-000000000001', 'material', 'LVT Oak', '60000000-0000-0000-0000-000000000001', 5000, 'carton', 'carton', 23.6, 10, true, false, 1),
  ('80000000-0000-0000-0000-000000000001', 'material', 'Adhesive', NULL, NULL, 'pail', 'pail', 250, 0, true, false, 2),
  ('80000000-0000-0000-0000-000000000001', 'labour', 'Install', NULL, 200, 'SF', 'SF', NULL, 0, false, false, 3),
  ('80000000-0000-0000-0000-000000000001', 'material', 'Primer', NULL, 900, 'pail', 'pail', 400, 0, true, true, 4),
  ('80000000-0000-0000-0000-000000000002', 'material', 'Upgrade', NULL, 5000, 'carton', 'carton', 20, 0, true, false, 1),
  ('80000000-0000-0000-0000-000000000003', 'material', 'Option tile', NULL, 5000, 'carton', 'carton', 20, 0, true, false, 1),
  ('80000000-0000-0000-0000-000000000004', 'material', 'Carpet', NULL, 3000, 'SY', 'SY', NULL, 8, false, false, 1);
INSERT INTO standard_tools (name, sort_order) VALUES ('Floor roller', 1), ('Knee kicker', 2);

SET ROLE authenticated;

-- ── Fred (BMD field, on Hyatt) writes today's log ──────────────────────────────────────────────────────────
SELECT public.t_as_user(:field);
INSERT INTO daily_logs (id, project_id, what_happened, next_steps) VALUES ('a0000000-0000-0000-0000-000000000001', :p1, 'Laid corridor', 'Need 2 pails of adhesive');
DO $$ BEGIN
  ASSERT (SELECT author_name FROM daily_logs WHERE id = 'a0000000-0000-0000-0000-000000000001') = 'Fred Field', 'the author''s name is stamped';
  ASSERT (SELECT log_date FROM daily_logs WHERE id = 'a0000000-0000-0000-0000-000000000001') = public.bmd_today(), 'dated today in Winnipeg';
  ASSERT NOT (SELECT shared_with_client FROM daily_logs WHERE id = 'a0000000-0000-0000-0000-000000000001'), 'internal by default';
  ASSERT (SELECT weather_status FROM daily_logs WHERE id = 'a0000000-0000-0000-0000-000000000001') = 'pending', 'no weather until the server adds it';
  ASSERT public.t_refused($q$INSERT INTO daily_logs (project_id, what_happened) VALUES ('10000000-0000-0000-0000-000000000001', 'again')$q$), 'one log per job, per day, per person';
  ASSERT public.t_refused($q$INSERT INTO daily_logs (project_id, log_date, what_happened) VALUES ('10000000-0000-0000-0000-000000000001', public.bmd_today() - 1, 'yesterday')$q$), 'crew cannot back-date a log';
  ASSERT public.t_refused($q$INSERT INTO daily_logs (project_id, author_id, log_date, what_happened) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', public.bmd_today(), 'as someone else')$q$), 'a log is always the signed-in person''s own (it would be a second log for Fred today)';
  ASSERT public.t_refused($q$INSERT INTO daily_logs (project_id, what_happened) VALUES ('10000000-0000-0000-0000-000000000002', 'not my job')$q$), 'no log on a job where he is only a client';
  ASSERT public.t_refused($q$UPDATE daily_logs SET shared_with_client = true WHERE id = 'a0000000-0000-0000-0000-000000000001'$q$), 'crew cannot share a log with the client';
  ASSERT NOT public.t_refused($q$UPDATE daily_logs SET what_happened = 'Laid corridor and lobby' WHERE id = 'a0000000-0000-0000-0000-000000000001'$q$), 'own log can be edited the same day';
END $$;
-- Photos: uploaded under job-site/<job>/..., then filed on the log.
INSERT INTO storage.objects (bucket_id, name) VALUES ('deficiency-photos', 'job-site/10000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000001/one.jpg');
INSERT INTO daily_log_photos (log_id, project_id, storage_path) VALUES ('a0000000-0000-0000-0000-000000000001', :p1, 'job-site/10000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000001/one.jpg');
DO $$ BEGIN
  ASSERT public.t_refused($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('deficiency-photos', 'job-site/10000000-0000-0000-0000-000000000002/x/one.jpg')$q$), 'no upload into a job he has no crew access to';
  ASSERT public.t_refused($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('deficiency-photos', 'job-site/not-a-job/one.jpg')$q$), 'no upload outside a job folder';
END $$;
-- A request, straight from the log's next steps.
INSERT INTO job_requests (id, project_id, what, quantity, daily_log_id) VALUES ('b0000000-0000-0000-0000-000000000001', :p1, 'Need 2 pails of adhesive', '2 pails', 'a0000000-0000-0000-0000-000000000001');
DO $$ BEGIN
  ASSERT (SELECT status FROM job_requests WHERE id = 'b0000000-0000-0000-0000-000000000001') = 'open', 'starts open';
  ASSERT (SELECT requested_by_name FROM job_requests WHERE id = 'b0000000-0000-0000-0000-000000000001') = 'Fred Field', 'requester stamped';
  ASSERT public.t_refused($q$UPDATE job_requests SET status = 'ordered' WHERE id = 'b0000000-0000-0000-0000-000000000001'$q$), 'crew cannot set a request''s status';
  ASSERT NOT public.t_refused($q$UPDATE job_requests SET quantity = '3 pails' WHERE id = 'b0000000-0000-0000-0000-000000000001'$q$), 'requester can fix their own open request';
  ASSERT public.t_refused($q$INSERT INTO job_requests (project_id, what, status) VALUES ('10000000-0000-0000-0000-000000000001', 'sneaky', 'done') RETURNING CASE WHEN status = 'open' THEN 1/0 END$q$), 'a new request is always open, whatever is sent';
END $$;
DELETE FROM job_requests WHERE what = 'sneaky';

-- Materials for the crew: quantities to work out, and nothing about money.
DO $$ DECLARE r record; keys text; BEGIN
  ASSERT public.t_refused($q$SELECT 1 FROM estimate_lines$q$), 'field staff cannot read the estimate tables directly';
  ASSERT (SELECT count(*) FROM public.job_material_list('10000000-0000-0000-0000-000000000001')) = 2, 'the accepted price''s required material rows only (no labour, optional, not-needed or draft-option rows)';
  SELECT * INTO r FROM public.job_material_list('10000000-0000-0000-0000-000000000001') ORDER BY sort_c LIMIT 1;
  ASSERT r.description = 'LVT Oak Natural' AND r.section = 'Level 1' AND r.purchase_uom = 'carton', 'named from the catalogue, with its section and unit';
  ASSERT ceil(r.driver_qty * r.qty_per_driver * (1 + r.waste_pct / 100) / r.coverage_per_purchase_unit) = 47, 'carries what the Order quantity needs: 1000 SF + 10% at 23.6 a carton = 47';
  SELECT string_agg(k, ',' ORDER BY k) INTO keys FROM (SELECT jsonb_object_keys(to_jsonb(m)) AS k FROM public.job_material_list('10000000-0000-0000-0000-000000000001') m LIMIT 100) s;
  ASSERT keys !~* '(cost|cents|price|markup|margin|supplier|sell)', 'no cost, price, markup or supplier among the returned columns: ' || keys;
  ASSERT (SELECT to_jsonb(m)::text FROM public.job_material_list('10000000-0000-0000-0000-000000000001') m ORDER BY sort_c LIMIT 1) !~* '(5000|Prosol)', 'no cost value or supplier name in the row';
  ASSERT public.t_refused($q$SELECT * FROM public.job_material_list('10000000-0000-0000-0000-000000000002')$q$), 'not for a job where he is only a client';
END $$;
INSERT INTO job_material_checks (project_id, item_key) SELECT :p1, item_key FROM public.job_material_list(:p1) ORDER BY sort_c LIMIT 1;
-- Tools.
INSERT INTO job_tools (project_id, name) VALUES (:p1, 'Shop vac');
INSERT INTO job_tools (project_id, name, sort_order) SELECT :p1, name, sort_order FROM standard_tools;
UPDATE job_tools SET checked = true WHERE project_id = :p1 AND name = 'Floor roller';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM job_tools WHERE project_id = '10000000-0000-0000-0000-000000000001') = 3, 'own item plus the standard list';
  ASSERT public.t_refused($q$INSERT INTO standard_tools (name) VALUES ('Mine')$q$), 'crew cannot change the company''s standard list';
  ASSERT (SELECT logs_this_week_job FROM public.job_site_counts('10000000-0000-0000-0000-000000000001')) = 1 AND (SELECT open_requests FROM public.job_site_counts('10000000-0000-0000-0000-000000000001')) = 1, 'counts for the Overview';
END $$;

-- ── Chuck (subcontractor crew on Hyatt) ────────────────────────────────────────────────────────────────────
SELECT public.t_as_user(:chuck);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM daily_logs) = 0, 'a trade does not see internal logs';
  ASSERT (SELECT count(*) FROM daily_log_photos) = 0 AND (SELECT count(*) FROM storage.objects) = 0, 'nor their photos';
END $$;
INSERT INTO daily_logs (id, project_id, what_happened) VALUES ('a0000000-0000-0000-0000-000000000002', :p1, 'Stairs done');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM daily_logs) = 1, 'a subcontractor crew sees their own log, still not the staff ones';
  ASSERT (SELECT count(*) FROM job_requests) = 1 AND (SELECT count(*) FROM job_tools) = 3 AND (SELECT count(*) FROM public.job_material_list('10000000-0000-0000-0000-000000000001')) = 2, 'and the job''s requests, tools and material list';
  ASSERT public.t_refused($q$UPDATE job_requests SET what = 'changed' WHERE id = 'b0000000-0000-0000-0000-000000000001'$q$), 'cannot edit someone else''s request';
  ASSERT public.t_refused($q$DELETE FROM daily_logs WHERE id = 'a0000000-0000-0000-0000-000000000001'$q$), 'cannot delete someone else''s log';
END $$;

-- ── Cleo (client on Hyatt) ─────────────────────────────────────────────────────────────────────────────────
SELECT public.t_as_user(:cleo);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM daily_logs) = 0 AND (SELECT count(*) FROM daily_log_photos) = 0 AND (SELECT count(*) FROM storage.objects) = 0, 'a client sees no internal log or photo';
  ASSERT (SELECT count(*) FROM job_requests) = 0 AND (SELECT count(*) FROM job_tools) = 0 AND (SELECT count(*) FROM job_material_checks) = 0, 'and none of the crew''s lists';
  ASSERT public.t_refused($q$SELECT * FROM public.job_material_list('10000000-0000-0000-0000-000000000001')$q$), 'nor the material list';
  ASSERT public.t_refused($q$INSERT INTO daily_logs (project_id, what_happened) VALUES ('10000000-0000-0000-0000-000000000001', 'client log')$q$), 'a client cannot add a log';
  ASSERT public.t_refused($q$INSERT INTO job_requests (project_id, what) VALUES ('10000000-0000-0000-0000-000000000001', 'client ask')$q$), 'or a request';
END $$;

-- ── Mia (BMD manager on Hyatt) handles things ──────────────────────────────────────────────────────────────
SELECT public.t_as_user(:mgr);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM daily_logs) = 2, 'staff read every log on the job';
  ASSERT public.t_refused($q$UPDATE job_requests SET status = 'cant_do' WHERE id = 'b0000000-0000-0000-0000-000000000001'$q$), 'can''t do needs a reason';
END $$;
UPDATE job_requests SET status = 'ordered' WHERE id = 'b0000000-0000-0000-0000-000000000001';
UPDATE daily_logs SET shared_with_client = true, what_happened = 'Laid corridor and lobby (office tidy-up)' WHERE id = 'a0000000-0000-0000-0000-000000000001';
INSERT INTO standard_tools (name, sort_order) VALUES ('Trowels', 3);
INSERT INTO daily_logs (id, project_id, log_date, what_happened) VALUES ('a0000000-0000-0000-0000-000000000003', :p1, public.bmd_today() - 3, 'Entered by the office for an earlier day');
DO $$ BEGIN
  ASSERT (SELECT status_by_name FROM job_requests WHERE id = 'b0000000-0000-0000-0000-000000000001') = 'Mia Manager', 'who set the status is recorded';
  ASSERT (SELECT author_name FROM daily_logs WHERE id = 'a0000000-0000-0000-0000-000000000001') = 'Fred Field', 'an office edit keeps the author';
  ASSERT public.job_crew_can('10000000-0000-0000-0000-000000000002'), 'office staff who see the pipeline have crew access on every job, as they do for documents';
END $$;

-- The requester sees the status change; a shared log now reaches the client (and its photo), and the trade.
SELECT public.t_as_user(:field);
DO $$ BEGIN
  ASSERT (SELECT status FROM job_requests WHERE id = 'b0000000-0000-0000-0000-000000000001') = 'ordered', 'requester sees Ordered';
  ASSERT public.t_refused($q$UPDATE job_requests SET quantity = '9' WHERE id = 'b0000000-0000-0000-0000-000000000001'$q$), 'no editing once it is being handled';
  ASSERT (SELECT open_requests FROM public.job_site_counts('10000000-0000-0000-0000-000000000001')) = 1, 'ordered still counts as open';
  ASSERT public.t_refused($q$DELETE FROM daily_logs WHERE id = 'a0000000-0000-0000-0000-000000000003'$q$), 'crew cannot delete an office log';
END $$;
SELECT public.t_as_user(:cleo);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM daily_logs) = 1 AND (SELECT id FROM daily_logs) = 'a0000000-0000-0000-0000-000000000001', 'the client reads only the shared log';
  ASSERT (SELECT count(*) FROM daily_log_photos) = 1 AND (SELECT count(*) FROM storage.objects) = 1, 'and its photo';
  ASSERT public.t_refused($q$UPDATE daily_logs SET what_happened = 'x' WHERE id = 'a0000000-0000-0000-0000-000000000001'$q$), 'read only';
END $$;
SELECT public.t_as_user(:chuck);
DO $$ BEGIN ASSERT (SELECT count(*) FROM daily_logs) = 2, 'the trade sees the shared log and their own'; END $$;

-- Deleting: the author the same day, or the office.
SELECT public.t_as_user(:chuck);
DELETE FROM daily_logs WHERE id = 'a0000000-0000-0000-0000-000000000002';
SELECT public.t_as_user(:mgr);
DELETE FROM daily_logs WHERE id = 'a0000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM daily_logs) = 1, 'author and office deletes went through';
  ASSERT (SELECT count(*) FROM daily_log_photos) = 0, 'a deleted log takes its photo rows with it';
  ASSERT (SELECT daily_log_id FROM job_requests WHERE id = 'b0000000-0000-0000-0000-000000000001') IS NULL, 'a request outlives the log it came from';
END $$;
RESET ROLE;
SELECT 'daily log SQL tests passed' AS result;
