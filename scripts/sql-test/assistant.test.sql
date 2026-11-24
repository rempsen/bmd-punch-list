-- Ask BMD: BMD managers and BMD field staff may ask and read all-staff Knowledge; pricing stays with pricing staff; trades never.
SET ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
INSERT INTO knowledge_items (kind, title, body, visibility) VALUES ('memory', 'Lead time', 'Ceratech lead time is six weeks.', 'all_staff'), ('memory', 'Ceratech price', 'ABC tile 4.85 per sq ft.', 'pricing_only');
INSERT INTO assistant_conversations (title) VALUES ('Manager chat');
DO $$ BEGIN ASSERT (SELECT count(*) FROM knowledge_items) = 2, 'manager reads both'; END $$;

SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
DO $$ BEGIN
  ASSERT public.has_capability('use_assistant'), 'BMD field staff may use Ask BMD';
  ASSERT (SELECT count(*) FROM knowledge_items) = 1, 'field staff read all-staff Knowledge only';
  ASSERT (SELECT count(*) FROM public.search_knowledge('ceratech', 10)) = 1, 'search hides pricing-only Knowledge from field staff';
  ASSERT (SELECT gst_number FROM public.company_details()) = '81234 5678 RT0001', 'field staff get company details';
  ASSERT (SELECT count(*) FROM assistant_conversations) = 0, 'field staff do not see the manager''s conversations';
  ASSERT NOT public.can_write_knowledge('all_staff'), 'field staff do not edit Knowledge';
END $$;
INSERT INTO assistant_conversations (title) VALUES ('Field chat');
DO $$ BEGIN ASSERT (SELECT count(*) FROM assistant_conversations) = 1, 'field staff keep their own conversation'; END $$;

SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
DO $$ BEGIN
  ASSERT NOT public.has_capability('use_assistant'), 'trades may not use Ask BMD';
  ASSERT (SELECT count(*) FROM knowledge_items) = 0, 'trades read no Knowledge';
END $$;
DO $$ BEGIN
  PERFORM public.company_details();
  RAISE EXCEPTION 'trades should not get company details';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'Not allowed' THEN RAISE; END IF;
END $$;
RESET ROLE;
SELECT 'assistant SQL tests passed' AS result;
