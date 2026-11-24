-- Open-book jobs: contract type, terms, entries, the bill made from them, and fixed-price billing left as it was.
\set mgr '''00000000-0000-0000-0000-0000000000a1'''
\set field '''00000000-0000-0000-0000-0000000000f1'''
\set chuck '''00000000-0000-0000-0000-0000000000c1'''
\set p1 '''10000000-0000-0000-0000-000000000001'''
\set p2 '''10000000-0000-0000-0000-000000000002'''
CREATE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', u, false) $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
-- A manager who prices, bills and manages jobs; a field person who only sees jobs; an estimator-like person who prices and bills but does not manage jobs.
INSERT INTO public.user_access (user_id, level, all_jobs) VALUES
  ('00000000-0000-0000-0000-0000000000a1','bmd_manager',true), ('00000000-0000-0000-0000-0000000000f1','bmd_field',true), ('00000000-0000-0000-0000-0000000000c1','trade',true)
ON CONFLICT (user_id) DO UPDATE SET level = EXCLUDED.level, all_jobs = EXCLUDED.all_jobs, status = 'active';
INSERT INTO public.role_permissions (role, capability, allowed) VALUES
  ('bmd_manager','view_pricing',true), ('bmd_manager','send_quotes',true), ('bmd_manager','manage_projects',true), ('bmd_manager','view_pipeline',true),
  ('bmd_field','view_pricing',false), ('bmd_field','send_quotes',false), ('bmd_field','manage_projects',false), ('bmd_field','view_pipeline',true),
  ('trade','view_pricing',true), ('trade','send_quotes',true), ('trade','manage_projects',false), ('trade','view_pipeline',false)
ON CONFLICT (role, capability) DO UPDATE SET allowed = EXCLUDED.allowed;
UPDATE public.projects SET project_number = '26-041' WHERE id = :p1;
INSERT INTO public.quotes (project_id, kind, status, accepted_value_cents) VALUES (:p2, 'quote', 'accepted', 20000000);

-- Every existing job is fixed price.
DO $$ BEGIN ASSERT (SELECT count(*) FROM projects WHERE contract_type <> 'fixed') = 0, 'existing jobs stay fixed price'; END $$;

-- Only people who manage jobs can change the contract type.
SELECT pg_temp.as_user(:field);
DO $$ BEGIN ASSERT pg_temp.err($q$UPDATE projects SET contract_type = 'open_book' WHERE id = '10000000-0000-0000-0000-000000000001'$q$) = 'Not allowed to change the contract type', 'field staff cannot change it'; END $$;
SELECT pg_temp.as_user(:mgr);
UPDATE projects SET contract_type = 'open_book' WHERE id = :p1;
DO $$ BEGIN ASSERT pg_temp.err($q$UPDATE projects SET contract_type = 'cost_plus' WHERE id = '10000000-0000-0000-0000-000000000001'$q$) IS NOT NULL, 'only the two known types'; END $$;

SET ROLE authenticated;
-- Terms: read with pricing access; set by someone with pricing access who also manages jobs.
SELECT pg_temp.as_user(:chuck);
DO $$ BEGIN ASSERT pg_temp.err($q$INSERT INTO open_book_terms (project_id, materials_markup_pct) VALUES ('10000000-0000-0000-0000-000000000001', 15)$q$) LIKE '%row-level security%', 'pricing access alone cannot set terms'; END $$;
SELECT pg_temp.as_user(:mgr);
INSERT INTO open_book_terms (project_id, labour_rate_cents, named_rates) VALUES (:p1, 8500, '[{"name":"Installer","rateCents":8500},{"name":"Helper","rateCents":5500}]');
DO $$ BEGIN ASSERT (SELECT materials_markup_pct IS NULL AND holdback_applies FROM open_book_terms) , 'markup starts unknown, holdback applies as on any job'; END $$;

-- Entries. The amount is always hours × rate, half a cent up.
INSERT INTO open_book_labour (id, project_id, description, work_date, work_date_end, hours, rate_cents) VALUES
  ('a0000000-0000-0000-0000-000000000001', :p1, 'Remove carpet, level 2 corridor', '2026-11-02', '2026-11-06', 32, 8500),
  ('a0000000-0000-0000-0000-000000000002', :p1, 'Helper', '2026-11-04', NULL, 7.25, 5500),
  ('a0000000-0000-0000-0000-000000000003', :p1, 'Half cent', '2026-11-05', NULL, 0.5, 8555),
  ('a0000000-0000-0000-0000-000000000004', :p1, 'Half cent again', '2026-11-05', NULL, 1.15, 8530);
INSERT INTO open_book_materials (id, project_id, supplier_name, invoice_number, invoice_date, amount_cents, markup_pct, markup_note) VALUES
  ('b0000000-0000-0000-0000-000000000001', :p1, 'Prosol', 'INV-1001', '2026-11-03', 240000, NULL, NULL),
  ('b0000000-0000-0000-0000-000000000002', :p1, 'Shnier', '88123', '2026-11-04', 3330, 10, 'Agreed 10% on adhesive'),
  ('b0000000-0000-0000-0000-000000000003', :p1, 'Shnier', '88124', '2026-11-05', 1004, 12.5, NULL);
DO $$ BEGIN
  ASSERT (SELECT array_agg(amount_cents ORDER BY id) FROM open_book_labour) = ARRAY[272000, 39875, 4278, 9810]::bigint[], 'hours × rate, half up: ' || (SELECT array_agg(amount_cents ORDER BY id) FROM open_book_labour)::text;
  ASSERT pg_temp.err($q$INSERT INTO open_book_materials (project_id, supplier_name, invoice_number, invoice_date, amount_cents) VALUES ('10000000-0000-0000-0000-000000000001', ' prosol', 'inv-1001 ', '2026-11-09', 100)$q$) LIKE '%open_book_materials_invoice_once%', 'the same supplier invoice cannot be entered twice';
  ASSERT pg_temp.err($q$INSERT INTO open_book_labour (project_id, description, work_date, hours, rate_cents, bill_id) VALUES ('10000000-0000-0000-0000-000000000001', 'x', '2026-11-09', 1, 100, gen_random_uuid())$q$) LIKE '%row-level security%', 'a person cannot put an entry on a bill by hand';
  ASSERT pg_temp.err($q$INSERT INTO open_book_labour (project_id, description, work_date, hours, rate_cents) VALUES ('10000000-0000-0000-0000-000000000001', 'x', '2026-11-09', 0, 100)$q$) IS NOT NULL, 'hours must be above zero';
END $$;

-- Field staff see none of it and can add none of it.
SELECT pg_temp.as_user(:field);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM open_book_terms) + (SELECT count(*) FROM open_book_labour) + (SELECT count(*) FROM open_book_materials) = 0, 'field staff see no terms or entries';
  ASSERT pg_temp.err($q$INSERT INTO open_book_labour (project_id, description, work_date, hours, rate_cents) VALUES ('10000000-0000-0000-0000-000000000001', 'x', '2026-11-09', 1, 100)$q$) LIKE '%row-level security%', 'field staff cannot add labour';
  ASSERT pg_temp.err($q$SELECT create_open_book_bill('10000000-0000-0000-0000-000000000001', ARRAY['a0000000-0000-0000-0000-000000000001']::uuid[], NULL)$q$) = 'Not allowed to prepare bills', 'field staff cannot bill';
END $$;

-- The bill. Materials wait until the job's markup is set: unknown is not 0%.
SELECT pg_temp.as_user(:mgr);
DO $$ BEGIN
  ASSERT pg_temp.err($q$SELECT create_open_book_bill('10000000-0000-0000-0000-000000000001', NULL, ARRAY['b0000000-0000-0000-0000-000000000001']::uuid[])$q$) = 'Set the materials markup for this job before billing materials.', 'no markup, no materials bill';
  ASSERT pg_temp.err($q$SELECT create_open_book_bill('10000000-0000-0000-0000-000000000001', NULL, NULL)$q$) = 'Tick the labour and material invoices to put on this bill.', 'nothing ticked';
END $$;
UPDATE open_book_terms SET materials_markup_pct = 15 WHERE project_id = :p1;
SELECT create_open_book_bill(:p1, ARRAY['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002']::uuid[], ARRAY['b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002']::uuid[], 'Work to November 6') AS bill1 \gset
DO $$ DECLARE b progress_bills; BEGIN
  SELECT * INTO b FROM progress_bills WHERE project_id = '10000000-0000-0000-0000-000000000001';
  ASSERT b.number = '26-041-B01' AND b.kind = 'progress' AND b.status = 'draft', 'numbered and drafted like any bill';
  -- Labour 3,118.75 + invoices 2,433.30 + markup 363.33 (15% of 2,400.00, and 10% of 33.30).
  ASSERT (b.gross_cents, b.holdback_pct, b.holdback_cents, b.net_cents, b.gst_cents, b.total_cents) = (591538::bigint, 7.5, 44365::bigint, 547173::bigint, 27359::bigint, 574532::bigint), 'totals: ' || row(b.gross_cents, b.holdback_cents, b.net_cents, b.gst_cents, b.total_cents)::text;
  ASSERT b.lines = '[{"description":"Labour","amountCents":311875},{"description":"Materials","amountCents":243330},{"description":"Markup on materials","amountCents":36333}]'::jsonb, 'roll-up for QuickBooks: ' || b.lines::text;
  -- Only what the client is shown is kept on the bill.
  ASSERT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(b.open_book) k) = ARRAY['labour','labourCents','markupCents','materials','materialsCents'], 'bill fields';
  ASSERT (SELECT array_agg(DISTINCT k ORDER BY k) FROM jsonb_array_elements(b.open_book->'labour') l, jsonb_object_keys(l) k) = ARRAY['amountCents','dateFrom','dateTo','description','hours','rateCents'], 'labour fields';
  ASSERT (SELECT array_agg(DISTINCT k ORDER BY k) FROM jsonb_array_elements(b.open_book->'materials') m, jsonb_object_keys(m) k) = ARRAY['attachmentName','invoiceCents','invoiceDate','invoiceNumber','markupCents','markupPct','supplier','totalCents'], 'material fields';
  ASSERT b.open_book::text NOT LIKE '%Agreed 10%', 'the markup note stays in the office';
  ASSERT b.open_book->'materials'->1 = '{"supplier":"Shnier","invoiceNumber":"88123","invoiceDate":"2026-11-04","invoiceCents":3330,"markupPct":10,"markupCents":333,"totalCents":3663,"attachmentName":null}'::jsonb, 'an invoice with its own markup: ' || (b.open_book->'materials'->1)::text;
END $$;

-- On a bill means locked: not edited, not removed, not billed twice.
DO $$ DECLARE n int; BEGIN
  UPDATE open_book_labour SET hours = 99 WHERE id = 'a0000000-0000-0000-0000-000000000001'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'billed labour cannot be edited';
  DELETE FROM open_book_materials WHERE id = 'b0000000-0000-0000-0000-000000000001'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'billed invoice cannot be removed';
  ASSERT pg_temp.err($q$UPDATE open_book_labour SET bill_id = NULL WHERE id = 'a0000000-0000-0000-0000-000000000001'$q$) IS NULL AND (SELECT bill_id IS NOT NULL FROM open_book_labour WHERE id = 'a0000000-0000-0000-0000-000000000001'), 'nor taken off the bill by hand';
  ASSERT pg_temp.err($q$SELECT create_open_book_bill('10000000-0000-0000-0000-000000000001', ARRAY['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003']::uuid[], NULL)$q$) = 'One of these entries is already on a bill. Refresh and pick again.', 'an entry cannot be on two bills';
  ASSERT pg_temp.err($q$SELECT create_open_book_bill('10000000-0000-0000-0000-000000000001', ARRAY['a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000003']::uuid[], NULL)$q$) = 'The same entry was picked twice.', 'nor twice on one';
  ASSERT (SELECT count(*) FROM progress_bills) = 1, 'no second bill was made';
END $$;
RESET ROLE;
-- The fixed-price builder is refused on an open-book job (it would bill a made-up amount), even with an accepted quote there.
INSERT INTO public.quotes (project_id, kind, status, accepted_value_cents) VALUES (:p1, 'quote', 'accepted', 5000000);
DO $$ BEGIN ASSERT pg_temp.err($q$SELECT create_progress_bill('10000000-0000-0000-0000-000000000001', 'progress', '[{"description":"Progress","amountCents":1000}]')$q$) = 'This is an open-book job. Bill it from its labour and material invoices.', 'fixed-price bill on an open-book job'; END $$;

-- The contract type: not with a draft bill, and never again once a bill has been issued.
DO $$ BEGIN ASSERT pg_temp.err($q$UPDATE projects SET contract_type = 'fixed' WHERE id = '10000000-0000-0000-0000-000000000001'$q$) = 'Delete the draft bills on this job before changing its contract type.', 'draft bill blocks the change'; END $$;
SELECT set_progress_bill_status(:'bill1', 'issued');
DO $$ BEGIN
  ASSERT pg_temp.err($q$UPDATE projects SET contract_type = 'fixed' WHERE id = '10000000-0000-0000-0000-000000000001'$q$) = 'This job has issued bills, so its contract type can no longer be changed.', 'issued bill locks the contract type';
  ASSERT (SELECT contract_type FROM projects WHERE id = '10000000-0000-0000-0000-000000000001') = 'open_book', 'still open book';
  UPDATE projects SET name = 'Hyatt Centric' WHERE id = '10000000-0000-0000-0000-000000000001'; -- other details can still change
END $$;

-- Holdback release works as on any job: only what issued bills hold.
DO $$ BEGIN ASSERT pg_temp.err($q$SELECT create_progress_bill('10000000-0000-0000-0000-000000000001', 'holdback_release', '[{"description":"Release of holdback","amountCents":44366}]')$q$) = 'Only $443.65 of holdback is being held.', 'cannot release more than is held'; END $$;
SELECT create_progress_bill(:p1, 'holdback_release', '[{"description":"Release of holdback","amountCents":44365}]') AS rel \gset
DO $$ BEGIN
  ASSERT (SELECT (gross_cents, holdback_cents, gst_cents, total_cents) = (44365::bigint, 0::bigint, 2218::bigint, 46583::bigint) AND open_book IS NULL FROM progress_bills WHERE kind = 'holdback_release'), 'release bills the holdback plus GST';
END $$;
SELECT set_progress_bill_status(:'rel', 'deleted');

-- With holdback switched off in the job's terms, the next bill holds nothing back. Deleting that draft frees its entries.
UPDATE open_book_terms SET holdback_applies = false WHERE project_id = :p1;
SELECT create_open_book_bill(:p1, ARRAY['a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004']::uuid[], ARRAY['b0000000-0000-0000-0000-000000000003']::uuid[]) AS bill2 \gset
DO $$ DECLARE b progress_bills; BEGIN
  SELECT * INTO b FROM progress_bills WHERE status = 'draft' AND project_id = '10000000-0000-0000-0000-000000000001';
  -- Labour 42.78 + 98.10; invoice 10.04 at its own 12.5% = 1.26 (1.255 rounds up).
  ASSERT (b.gross_cents, b.holdback_pct, b.holdback_cents, b.net_cents, b.gst_cents, b.total_cents) = (15218::bigint, 0, 0::bigint, 15218::bigint, 761::bigint, 15979::bigint), 'no holdback: ' || row(b.gross_cents, b.holdback_cents, b.net_cents, b.gst_cents, b.total_cents)::text;
  ASSERT b.open_book->'materials'->0->>'markupCents' = '126', 'half-cent markup rounds up';
END $$;
SELECT set_progress_bill_status(:'bill2', 'deleted');
DO $$ BEGIN ASSERT (SELECT count(*) FROM open_book_labour WHERE bill_id IS NULL) = 2 AND (SELECT bill_id IS NULL FROM open_book_materials WHERE id = 'b0000000-0000-0000-0000-000000000003'), 'a deleted draft gives its entries back'; END $$;
-- Voiding an issued bill gives its entries back too, and they can then be billed again.
SELECT set_progress_bill_status(:'bill1', 'void');
DO $$ BEGIN ASSERT (SELECT count(*) FROM open_book_labour WHERE bill_id IS NOT NULL) + (SELECT count(*) FROM open_book_materials WHERE bill_id IS NOT NULL) = 0, 'a voided bill gives its entries back'; END $$;
SELECT create_open_book_bill(:p1, ARRAY['a0000000-0000-0000-0000-000000000001']::uuid[], NULL) AS bill3 \gset
DO $$ BEGIN ASSERT (SELECT gross_cents = 272000 AND lines = '[{"description":"Labour","amountCents":272000}]'::jsonb FROM progress_bills WHERE status = 'draft'), 'labour-only bill'; END $$;

-- A fixed-price job bills exactly as before, and cannot be billed open book.
DO $$ DECLARE b progress_bills; BEGIN
  PERFORM create_progress_bill('10000000-0000-0000-0000-000000000002', 'progress', '[{"description":"Materials delivered to site","amountCents":6000000},{"description":"Progress to date","amountCents":4000000}]', 'Work to November 30');
  SELECT * INTO b FROM progress_bills WHERE project_id = '10000000-0000-0000-0000-000000000002';
  ASSERT (b.gross_cents, b.holdback_pct, b.holdback_cents, b.net_cents, b.gst_cents, b.total_cents) = (10000000::bigint, 7.5, 750000::bigint, 9250000::bigint, 462500::bigint, 9712500::bigint), 'fixed-price totals unchanged';
  ASSERT b.open_book IS NULL AND b.number = 'B01', 'a fixed-price bill carries no open-book detail';
  ASSERT pg_temp.err($q$SELECT create_progress_bill('10000000-0000-0000-0000-000000000002', 'progress', '[{"description":"Too much","amountCents":10000001}]')$q$) LIKE 'That would bill more than the contract of $200,000.00%', 'still held to the contract';
  ASSERT pg_temp.err($q$SELECT create_open_book_bill('10000000-0000-0000-0000-000000000002', ARRAY['a0000000-0000-0000-0000-000000000003']::uuid[], NULL)$q$) = 'This is a fixed-price job. Bill it against its contract.', 'no open-book bill on a fixed-price job';
END $$;

-- Approved hours: nothing offered until the time clock provides them; then only approved rows not already added.
DO $$ BEGIN ASSERT open_book_approved_hours('10000000-0000-0000-0000-000000000001') IS NULL, 'no time clock yet: nothing to offer'; END $$;
CREATE FUNCTION public.approved_hours_for_job(_project uuid) RETURNS TABLE (id uuid, person_name text, work_date date, hours numeric, approved boolean) LANGUAGE sql STABLE AS $$
  SELECT * FROM (VALUES ('c0000000-0000-0000-0000-000000000001'::uuid, 'Jo Installer', '2026-11-09'::date, 7.5, true), ('c0000000-0000-0000-0000-000000000002'::uuid, 'Sam Helper', '2026-11-09'::date, 8.0, false),
                        ('c0000000-0000-0000-0000-000000000003'::uuid, 'Sam Helper', '2026-11-10'::date, 6.25, true)) v $$;
DO $$ BEGIN
  ASSERT open_book_approved_hours('10000000-0000-0000-0000-000000000001') = '[{"id":"c0000000-0000-0000-0000-000000000001","person":"Jo Installer","date":"2026-11-09","hours":7.5},{"id":"c0000000-0000-0000-0000-000000000003","person":"Sam Helper","date":"2026-11-10","hours":6.25}]'::jsonb, 'approved rows only: ' || open_book_approved_hours('10000000-0000-0000-0000-000000000001')::text;
  INSERT INTO open_book_labour (project_id, description, work_date, hours, rate_cents, source_ref) VALUES ('10000000-0000-0000-0000-000000000001', 'Jo Installer', '2026-11-09', 7.5, 8500, 'time:c0000000-0000-0000-0000-000000000001');
  ASSERT jsonb_array_length(open_book_approved_hours('10000000-0000-0000-0000-000000000001')) = 1, 'hours already added are not offered again';
  ASSERT pg_temp.err($q$INSERT INTO open_book_labour (project_id, description, work_date, hours, rate_cents, source_ref) VALUES ('10000000-0000-0000-0000-000000000001', 'Jo Installer', '2026-11-09', 7.5, 8500, 'time:c0000000-0000-0000-0000-000000000001')$q$) LIKE '%duplicate key%', 'the same approved hours cannot be added twice';
END $$;

-- Job lists: who sees that a job is open book, and who sees what has been billed.
DO $$ BEGIN ASSERT (SELECT array_agg(billed_cents) FROM open_book_jobs()) = ARRAY[272000]::bigint[], 'manager sees billed to date (void bills not counted)'; END $$;
SELECT pg_temp.as_user(:field);
DO $$ BEGIN ASSERT (SELECT count(*) = 1 AND bool_and(billed_cents IS NULL) FROM open_book_jobs()), 'field staff see the tag, never the dollars'; END $$;
SELECT 'open-book SQL tests passed' AS result;
