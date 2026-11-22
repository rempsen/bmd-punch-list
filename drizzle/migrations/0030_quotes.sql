-- Quotes: what was sent to the client, frozen. Change orders are quotes of kind 'change_order'.
CREATE TABLE IF NOT EXISTS public.quote_clauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('inclusion','exclusion','clarification')),
  body text NOT NULL CHECK (btrim(body) <> ''),
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('quote','change_order')),
  co_number int,
  revision int NOT NULL DEFAULT 0,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined','superseded')),
  version_ids uuid[] NOT NULL CHECK (cardinality(version_ids) > 0),
  validity_days int NOT NULL DEFAULT 30 CHECK (validity_days BETWEEN 1 AND 365),
  presentation text NOT NULL DEFAULT 'by_section' CHECK (presentation IN ('lump_sum','by_section','itemised')),
  inclusions text[] NOT NULL DEFAULT '{}',
  exclusions text[] NOT NULL DEFAULT '{}',
  clarifications text[] NOT NULL DEFAULT '{}',
  deposit text,
  snapshot jsonb,
  rollup jsonb,
  value_cents bigint,
  recipients text[] NOT NULL DEFAULT '{}',
  sent_at timestamptz,
  sent_by uuid,
  accepted_version_id uuid,
  accepted_at timestamptz,
  accepted_value_cents bigint,
  decided_by uuid,
  decision_note text,
  qbo_estimate_id text,
  document_id uuid REFERENCES public.project_documents(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotes_project_idx ON public.quotes (project_id, created_at);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotes','quote_clauses'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_capability(''view_pricing''))', t || ' read', t);
  END LOOP;
  GRANT INSERT, UPDATE, DELETE ON public.quote_clauses TO authenticated;
  DROP POLICY IF EXISTS "quote_clauses write" ON public.quote_clauses;
  CREATE POLICY "quote_clauses write" ON public.quote_clauses FOR ALL TO authenticated
    USING (public.has_capability('send_quotes')) WITH CHECK (public.has_capability('send_quotes'));
  GRANT UPDATE (validity_days, presentation, inclusions, exclusions, clarifications, deposit) ON public.quotes TO authenticated;
  DROP POLICY IF EXISTS "quotes edit draft" ON public.quotes;
  CREATE POLICY "quotes edit draft" ON public.quotes FOR UPDATE TO authenticated
    USING (public.has_capability('send_quotes') AND status = 'draft') WITH CHECK (public.has_capability('send_quotes') AND status = 'draft');
END $$;
--> statement-breakpoint
INSERT INTO public.quote_clauses (kind, body, sort_order)
SELECT k, b, o FROM (VALUES
  ('inclusion','Supply and installation of the materials listed.',1),
  ('inclusion','Removal of our own debris from site.',2),
  ('exclusion','Floor preparation or levelling beyond what is listed.',1),
  ('exclusion','Moving of furniture, appliances or equipment.',2),
  ('exclusion','Work outside regular working hours.',3),
  ('clarification','Quantities are based on the drawings provided and are subject to site measure.',1)
) AS v(k, b, o) WHERE NOT EXISTS (SELECT 1 FROM public.quote_clauses);
--> statement-breakpoint

-- Starts (or reopens) the draft quote for these prices. One draft at a time per quote or change order.
CREATE OR REPLACE FUNCTION public.create_quote(_project uuid, _version_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; co int; n int; rev int; pn text; qid uuid; prev public.quotes;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to prepare quotes'; END IF;
  SELECT count(*) INTO n FROM public.estimate_versions WHERE id = ANY(_version_ids) AND project_id = _project;
  IF n = 0 OR n <> coalesce(cardinality(_version_ids), 0) THEN RAISE EXCEPTION 'Choose at least one price from this project'; END IF;
  IF (SELECT count(DISTINCT kind) FROM public.estimate_versions WHERE id = ANY(_version_ids)) > 1 THEN RAISE EXCEPTION 'A quote cannot mix estimate prices and change orders'; END IF;
  SELECT CASE WHEN kind = 'change_order' THEN 'change_order' ELSE 'quote' END, co_number INTO k, co FROM public.estimate_versions WHERE id = _version_ids[1];
  IF k = 'change_order' AND n > 1 THEN RAISE EXCEPTION 'A change order is quoted on its own'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('quotes' || _project::text));
  IF EXISTS (SELECT 1 FROM public.quotes WHERE project_id = _project AND kind = k AND co_number IS NOT DISTINCT FROM co AND status = 'accepted') THEN
    RAISE EXCEPTION 'This has already been accepted. Use a change order to adjust the contract.';
  END IF;
  SELECT id INTO qid FROM public.quotes WHERE project_id = _project AND kind = k AND co_number IS NOT DISTINCT FROM co AND status = 'draft';
  IF qid IS NOT NULL THEN
    UPDATE public.quotes SET version_ids = _version_ids WHERE id = qid;
    RETURN qid;
  END IF;
  SELECT * INTO prev FROM public.quotes WHERE project_id = _project AND kind = k AND co_number IS NOT DISTINCT FROM co ORDER BY revision DESC LIMIT 1;
  rev := coalesce(prev.revision + 1, 0);
  SELECT project_number INTO pn FROM public.projects WHERE id = _project;
  INSERT INTO public.quotes (project_id, kind, co_number, revision, number, version_ids, validity_days, presentation, inclusions, exclusions, clarifications, deposit)
  VALUES (_project, k, co, rev,
          CASE WHEN k = 'change_order' THEN 'CO-' || co || CASE WHEN rev > 0 THEN '-R' || rev ELSE '' END ELSE 'Q-' || coalesce(pn, left(_project::text, 8)) || '-R' || rev END,
          _version_ids, coalesce(prev.validity_days, 30), coalesce(prev.presentation, 'by_section'),
          coalesce(prev.inclusions, ARRAY(SELECT body FROM public.quote_clauses WHERE kind = 'inclusion' AND is_default AND active ORDER BY sort_order)),
          coalesce(prev.exclusions, ARRAY(SELECT body FROM public.quote_clauses WHERE kind = 'exclusion' AND is_default AND active ORDER BY sort_order)),
          coalesce(prev.clarifications, ARRAY(SELECT body FROM public.quote_clauses WHERE kind = 'clarification' AND is_default AND active ORDER BY sort_order)),
          prev.deposit)
  RETURNING id INTO qid;
  RETURN qid;
END; $$;
--> statement-breakpoint

-- Why this quote cannot be sent yet, or NULL when it can. An unknown cost is never treated as zero.
CREATE OR REPLACE FUNCTION public.quote_issue_block(_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.quotes; found text;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RETURN 'Not allowed to send quotes'; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = _id;
  IF q.id IS NULL THEN RETURN 'Quote not found'; END IF;
  IF q.status <> 'draft' THEN RETURN 'This quote has already been sent. Revise it to send again.'; END IF;
  IF (SELECT count(*) FROM public.estimate_versions WHERE id = ANY(q.version_ids)) <> cardinality(q.version_ids) THEN
    RETURN 'A price on this quote was deleted. Choose the prices again.';
  END IF;
  SELECT v.name INTO found FROM public.estimate_versions v
   WHERE v.id = ANY(q.version_ids) AND NOT EXISTS (SELECT 1 FROM public.estimate_lines l WHERE l.version_id = v.id) LIMIT 1;
  IF found IS NOT NULL THEN RETURN '"' || found || '" has no lines to quote.'; END IF;
  SELECT string_agg(label, '; ') INTO found FROM (
    SELECT v.name || ': ' || l.description || ' (' || coalesce(c.label, 'no cost entered') || ')' AS label
      FROM public.estimate_versions v
      JOIN public.estimate_lines l ON l.version_id = v.id
      LEFT JOIN public.estimate_line_components c ON c.line_id = l.id
     WHERE v.id = ANY(q.version_ids) AND (c.id IS NULL OR (c.unit_cost_cents IS NULL AND NOT c.not_applicable))
     ORDER BY v.sort_order, l.sort_order LIMIT 5) x;
  IF found IS NOT NULL THEN RETURN 'A cost is still unknown: ' || found || '. Enter it or mark it not needed before sending.'; END IF;
  RETURN NULL;
END; $$;
--> statement-breakpoint

-- Marks the quote sent, freezes what the client was shown, locks its prices and moves the project to Quote out.
CREATE OR REPLACE FUNCTION public.issue_quote(_id uuid, _snapshot jsonb, _rollup jsonb, _recipients text[], _document_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.quotes; why text;
BEGIN
  why := public.quote_issue_block(_id);
  IF why IS NOT NULL THEN RAISE EXCEPTION '%', why; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = _id FOR UPDATE;
  IF _snapshot->>'number' IS DISTINCT FROM q.number OR jsonb_typeof(_snapshot->'versions') IS DISTINCT FROM 'array'
     OR (SELECT array_agg(v->>'id' ORDER BY v->>'id') FROM jsonb_array_elements(_snapshot->'versions') v)
        IS DISTINCT FROM (SELECT array_agg(x::text ORDER BY x::text) FROM unnest(q.version_ids) x) THEN
    RAISE EXCEPTION 'The quote preview does not match its prices. Preview it again.';
  END IF;
  UPDATE public.quotes SET status = 'superseded'
   WHERE project_id = q.project_id AND kind = q.kind AND co_number IS NOT DISTINCT FROM q.co_number AND status IN ('sent','declined') AND id <> _id;
  UPDATE public.quotes
     SET status = 'sent', snapshot = _snapshot, rollup = _rollup, value_cents = (_snapshot->'versions'->0->>'subtotalCents')::bigint,
         recipients = coalesce(_recipients, '{}'), document_id = _document_id, sent_at = now(), sent_by = auth.uid()
   WHERE id = _id;
  UPDATE public.estimate_versions SET locked = true, status = 'sent' WHERE id = ANY(q.version_ids);
  IF q.kind = 'quote' THEN
    PERFORM set_config('bmd.stage_note', 'Quote ' || q.number || ' sent', true);
    UPDATE public.projects SET stage = 'quote_out' WHERE id = q.project_id AND stage IN ('opportunity','estimating');
    PERFORM set_config('bmd.stage_note', '', true);
  END IF;
END; $$;
--> statement-breakpoint

-- The client said yes to one price. Contract value is that price before GST, as the client was shown it.
CREATE OR REPLACE FUNCTION public.accept_quote(_id uuid, _version uuid, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.quotes; val bigint;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to record acceptance'; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = _id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF q.status <> 'sent' THEN RAISE EXCEPTION 'Only a sent quote can be accepted.'; END IF;
  SELECT (v->>'subtotalCents')::bigint INTO val FROM jsonb_array_elements(q.snapshot->'versions') v WHERE v->>'id' = _version::text;
  IF val IS NULL OR NOT (_version = ANY(q.version_ids)) THEN RAISE EXCEPTION 'Choose one of the prices on this quote.'; END IF;
  UPDATE public.quotes
     SET status = 'accepted', accepted_version_id = _version, accepted_at = now(), accepted_value_cents = val,
         decided_by = auth.uid(), decision_note = nullif(btrim(coalesce(_note, '')), '')
   WHERE id = _id;
  UPDATE public.estimate_versions SET locked = true, status = CASE WHEN id = _version THEN 'accepted' ELSE 'not_taken' END WHERE id = ANY(q.version_ids);
  IF q.kind = 'quote' THEN
    PERFORM set_config('bmd.stage_note', 'Quote ' || q.number || ' accepted', true);
    UPDATE public.projects SET estimated_value_cents = val,
           stage = CASE WHEN stage IN ('opportunity','estimating','quote_out') THEN 'won'::public.project_stage ELSE stage END
     WHERE id = q.project_id;
    PERFORM set_config('bmd.stage_note', '', true);
  END IF;
END; $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.decline_quote(_id uuid, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.quotes;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to record a decision'; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = _id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF q.status <> 'sent' THEN RAISE EXCEPTION 'Only a sent quote can be declined.'; END IF;
  UPDATE public.quotes SET status = 'declined', decided_by = auth.uid(), decision_note = nullif(btrim(coalesce(_note, '')), '') WHERE id = _id;
  UPDATE public.estimate_versions SET status = 'not_taken' WHERE id = ANY(q.version_ids);
END; $$;
--> statement-breakpoint

-- Reopens a sent or declined quote for changes: the old one is kept as superseded, its prices unlock, and the next revision starts as a draft.
CREATE OR REPLACE FUNCTION public.revise_quote(_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.quotes;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to revise quotes'; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = _id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF q.status NOT IN ('sent','declined') THEN RAISE EXCEPTION 'Only a sent or declined quote can be revised.'; END IF;
  UPDATE public.quotes SET status = 'superseded' WHERE id = _id;
  UPDATE public.estimate_versions SET locked = false, status = 'draft' WHERE id = ANY(q.version_ids);
  RETURN public.create_quote(q.project_id, ARRAY(SELECT v.id FROM public.estimate_versions v WHERE v.id = ANY(q.version_ids) ORDER BY v.sort_order));
END; $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.delete_quote(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to delete quotes'; END IF;
  IF EXISTS (SELECT 1 FROM public.quotes WHERE id = _id AND status <> 'draft') THEN RAISE EXCEPTION 'A quote that has been sent is kept on record.'; END IF;
  DELETE FROM public.quotes WHERE id = _id;
END; $$;
--> statement-breakpoint

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['create_quote(uuid, uuid[])','quote_issue_block(uuid)','issue_quote(uuid, jsonb, jsonb, text[], uuid)','accept_quote(uuid, uuid, text)',
                           'decline_quote(uuid, text)','revise_quote(uuid)','delete_quote(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
