-- 0082: Warranty stage, internal jobs, site-contact roles, job templates, QuickBooks badge lookup, new job from the form.
\set ON_ERROR_STOP 1
CREATE FUNCTION pg_temp.act_as(_u text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', _u, false) $$;
CREATE FUNCTION pg_temp.refused(_sql text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN EXECUTE _sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
\set admin '''a0000000-0000-0000-0000-000000000001'''
\set manager '''a0000000-0000-0000-0000-000000000002'''
\set field '''a0000000-0000-0000-0000-000000000003'''

-- Stage: Warranty sits between In progress and Closed; existing jobs are client jobs with no standard tasks.
DO $$ BEGIN
  ASSERT (SELECT array_agg(enumlabel::text ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid = 'public.project_stage'::regtype)
         = ARRAY['opportunity','estimating','quote_out','won','in_progress','warranty','closed','lost'], 'warranty sits between in_progress and closed';
  ASSERT (SELECT kind FROM projects WHERE name = 'Existing job') = 'client', 'existing jobs are client jobs';
  ASSERT (SELECT standard_tasks FROM projects WHERE name = 'Existing job') = '{}', 'no standard tasks by default';
  ASSERT pg_temp.refused($q$UPDATE projects SET kind = 'other'$q$), 'kind is client or internal only';
END $$;
UPDATE projects SET stage = 'warranty' WHERE name = 'Existing job';
DO $$ BEGIN ASSERT (SELECT to_stage FROM project_stage_events ORDER BY changed_at DESC, id LIMIT 1) IS NOT NULL, 'the move is logged'; END $$;
DO $$ BEGIN ASSERT EXISTS (SELECT 1 FROM project_stage_events WHERE from_stage = 'in_progress' AND to_stage = 'warranty'), 'in_progress -> warranty logged'; END $$;

-- New client job from the form, as a manager: goes through create_pipeline_project, then gets stage, tasks and contacts.
SELECT pg_temp.act_as(:manager);
SET ROLE authenticated;
SELECT public.create_project_from_form('{"name":" Hotel L4 ","client_id":"c0000000-0000-0000-0000-000000000001","stage":"won","job_type":"Hotel",
  "scopes":[{"scope":"carpet","other_text":null}],
  "standard_tasks":[" Check moisture ","","Photos before"],
  "contacts":[{"kind":"pm","name":"Pat Lee","phone":"204-555-0142","email":"pat@example.com"},{"kind":"super","name":"","phone":"","email":""},{"kind":"super","name":"Sam","phone":"","email":""}]}'::jsonb) AS client_job \gset
RESET ROLE;
DO $$ DECLARE p projects; BEGIN
  SELECT * INTO p FROM projects WHERE name = 'Hotel L4';
  ASSERT p.kind = 'client' AND p.stage = 'won' AND p.client_name = 'Acme Hotels' AND p.job_type = 'Hotel', 'client job created in the chosen stage';
  ASSERT p.standard_tasks = ARRAY['Check moisture','Photos before'], 'tasks trimmed, blanks dropped, order kept';
  ASSERT (SELECT array_agg(kind || ':' || name ORDER BY sort_order) FROM project_contacts WHERE project_id = p.id) = ARRAY['pm:Pat Lee','super:Sam'], 'blank contact skipped, roles kept';
  ASSERT (SELECT phone_mobile FROM project_contacts WHERE project_id = p.id AND kind = 'pm') = '204-555-0142', 'phone saved';
  ASSERT (SELECT count(*) FROM project_scopes WHERE project_id = p.id) = 1, 'scope saved';
  ASSERT (SELECT array_agg(to_stage::text ORDER BY changed_at, (from_stage IS NOT NULL)) FROM project_stage_events WHERE project_id = p.id) = ARRAY['opportunity','won'], 'stage history shows the start and the chosen stage';
  ASSERT EXISTS (SELECT 1 FROM project_members WHERE project_id = p.id AND user_id = 'a0000000-0000-0000-0000-000000000002'), 'creator is on the job';
END $$;

-- Internal job: no client needed, starts In progress, never in another stage.
SET ROLE authenticated;
SELECT public.create_project_from_form('{"name":"Shop time","kind":"internal","standard_tasks":["Sweep"]}'::jsonb) AS internal_job \gset
DO $$ BEGIN
  ASSERT pg_temp.refused($q$SELECT public.create_project_from_form('{"name":"No client"}')$q$), 'a client job still needs a client';
  ASSERT pg_temp.refused($q$SELECT public.create_project_from_form('{"name":"X","kind":"internal","stage":"opportunity"}')$q$), 'an internal job starts In progress';
  ASSERT pg_temp.refused($q$SELECT public.create_project_from_form('{"name":"X","kind":"internal","stage":"closed"}')$q$), 'no starting in Closed';
  ASSERT pg_temp.refused($q$SELECT public.create_project_from_form('{"name":"X","kind":"shop"}')$q$), 'unknown kind refused';
  ASSERT pg_temp.refused($q$SELECT public.create_project_from_form('{"name":" ","kind":"internal"}')$q$), 'name required';
END $$;
RESET ROLE;
DO $$ DECLARE p projects; BEGIN
  SELECT * INTO p FROM projects WHERE name = 'Shop time';
  ASSERT p.kind = 'internal' AND p.stage = 'in_progress' AND p.client_id IS NULL AND p.client_name IS NULL, 'internal job, no client, open';
  ASSERT p.standard_tasks = ARRAY['Sweep'], 'internal job tasks';
  ASSERT EXISTS (SELECT 1 FROM project_members WHERE project_id = p.id AND user_id = 'a0000000-0000-0000-0000-000000000002'), 'creator is on the internal job';
END $$;

-- A field person cannot create jobs, cannot see contacts of a job they are not on, and cannot touch templates.
SELECT pg_temp.act_as(:field);
SET ROLE authenticated;
DO $$ BEGIN
  ASSERT pg_temp.refused($q$SELECT public.create_project_from_form('{"name":"X","kind":"internal"}')$q$), 'field staff cannot create jobs';
  ASSERT (SELECT count(*) FROM project_contacts) = 0, 'field staff see no contacts on jobs they are not on';
  ASSERT (SELECT count(*) FROM project_qbo_links()) = 0, 'field staff get no QuickBooks links';
  ASSERT pg_temp.refused($q$INSERT INTO job_templates (name) VALUES ('Sneaky')$q$), 'field staff cannot add templates';
  ASSERT pg_temp.refused($q$INSERT INTO project_contacts (project_id, kind, name) VALUES ('10000000-0000-0000-0000-000000000001', 'pm', 'X')$q$), 'field staff cannot add contacts';
END $$;
RESET ROLE;

-- A manager edits contacts on a pipeline job and manages templates.
SELECT pg_temp.act_as(:manager);
SET ROLE authenticated;
INSERT INTO project_contacts (project_id, kind, name) SELECT id, 'super', 'Lee' FROM projects WHERE name = 'Shop time';
UPDATE project_contacts SET phone_mobile = '204-555-0100' WHERE name = 'Lee';
INSERT INTO job_templates (name, kind, default_stage, contact_roles, visit_tasks, notes) VALUES ('Hotel refresh', 'client', 'won', '{pm,super}', '{Check moisture}', 'Night work');
INSERT INTO job_templates (name, kind, default_stage) VALUES ('Shop time', 'internal', 'in_progress');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM project_contacts) = 3, 'manager sees contacts across jobs';
  ASSERT (SELECT count(*) FROM job_templates) = 2, 'manager sees templates';
  ASSERT pg_temp.refused($q$INSERT INTO job_templates (name) VALUES (' hotel REFRESH ')$q$), 'template names are unique, ignoring case and spaces';
  ASSERT pg_temp.refused($q$INSERT INTO job_templates (name, kind, default_stage) VALUES ('Bad', 'internal', 'opportunity')$q$), 'an internal template starts In progress';
  ASSERT pg_temp.refused($q$INSERT INTO job_templates (name, default_stage) VALUES ('Bad2', 'closed')$q$), 'a template cannot start a job Closed';
  ASSERT pg_temp.refused($q$INSERT INTO job_templates (name, contact_roles) VALUES ('Bad3', '{boss}')$q$), 'unknown contact role refused';
  ASSERT pg_temp.refused($q$INSERT INTO project_contacts (project_id, kind) SELECT id, 'boss' FROM projects LIMIT 1$q$), 'unknown contact kind refused';
END $$;
UPDATE job_templates SET name = 'Hotel refresh 2' WHERE name = 'Hotel refresh';
DELETE FROM job_templates WHERE name = 'Shop time';
DO $$ BEGIN ASSERT (SELECT array_agg(name) FROM job_templates) = ARRAY['Hotel refresh 2'], 'rename and delete work'; END $$;
RESET ROLE;

-- QuickBooks badge: only project links to QuickBooks count, and only real jobs.
INSERT INTO sync_links (kind, bmd_id, system, external_id) VALUES
  ('project', :'client_job', 'quickbooks', 'Q1'), ('project', :'internal_job', 'arriveping', 'A1'),
  ('client', :'internal_job', 'quickbooks', 'Q2'), ('project', 'not-a-job', 'quickbooks', 'Q3');
SET ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT array_agg(project_id) FROM project_qbo_links()) = ARRAY[(SELECT id FROM projects WHERE name = 'Hotel L4')], 'only the job linked to QuickBooks';
  ASSERT pg_temp.refused($q$SELECT * FROM sync_links$q$), 'the link table itself stays closed';
END $$;
RESET ROLE;
SELECT 'jobs.test.sql: all assertions passed' AS result;
