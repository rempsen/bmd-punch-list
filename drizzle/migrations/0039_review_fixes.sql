-- Fixes from the whole-branch review.

-- Only one accepted quote per project, and one per change order.
CREATE UNIQUE INDEX IF NOT EXISTS quotes_one_accepted_key ON public.quotes (project_id, kind, coalesce(co_number, 0)) WHERE status = 'accepted';
--> statement-breakpoint

-- A quote cannot be sent when it has already been accepted in another revision, or while a line has no margin or selling price set.
CREATE OR REPLACE FUNCTION public.quote_issue_block(_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.quotes; found text;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RETURN 'Not allowed to send quotes'; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = _id;
  IF q.id IS NULL THEN RETURN 'Quote not found'; END IF;
  IF q.status <> 'draft' THEN RETURN 'This quote has already been sent. Revise it to send again.'; END IF;
  IF EXISTS (SELECT 1 FROM public.quotes s WHERE s.project_id = q.project_id AND s.kind = q.kind AND s.co_number IS NOT DISTINCT FROM q.co_number AND s.status = 'accepted') THEN
    RETURN 'This has already been accepted. Use a change order to adjust the contract.';
  END IF;
  IF (SELECT count(*) FROM public.estimate_versions WHERE id = ANY(q.version_ids)) <> cardinality(q.version_ids) THEN
    RETURN 'A price on this quote was deleted. Choose the prices again.';
  END IF;
  SELECT v.name INTO found FROM public.estimate_versions v
   WHERE v.id = ANY(q.version_ids) AND NOT EXISTS (SELECT 1 FROM public.estimate_lines l WHERE l.version_id = v.id) LIMIT 1;
  IF found IS NOT NULL THEN RETURN '"' || found || '" has no lines to quote.'; END IF;
  SELECT string_agg(label, '; ') INTO found FROM (
    SELECT v.name || ': ' || l.description || CASE WHEN l.price_basis = 'margin' THEN ' (no margin set)' ELSE ' (no selling price set)' END AS label
      FROM public.estimate_versions v JOIN public.estimate_lines l ON l.version_id = v.id
     WHERE v.id = ANY(q.version_ids) AND ((l.price_basis = 'margin' AND l.margin_pct IS NULL) OR (l.price_basis = 'fixed_sell' AND l.fixed_sell_cents IS NULL))
     ORDER BY v.sort_order, l.sort_order LIMIT 5) x;
  IF found IS NOT NULL THEN RETURN 'A price is not set: ' || found || '.'; END IF;
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

-- Sent quotes and contracts carry prices: reading them needs pricing access, not just document access.
DROP POLICY IF EXISTS "priced sections need pricing access" ON public.project_documents;
--> statement-breakpoint
CREATE POLICY "priced sections need pricing access" ON public.project_documents AS RESTRICTIVE FOR SELECT TO authenticated
  USING (section NOT IN ('quotes_sent','contract') OR public.has_capability('view_pricing'));
--> statement-breakpoint
DROP POLICY IF EXISTS "priced document files need pricing access" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "priced document files need pricing access" ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id <> 'project-documents' OR split_part(name, '/', 2) NOT IN ('quotes_sent','contract') OR public.has_capability('view_pricing'));
--> statement-breakpoint

-- A sheet's scale and every measurement on it change together or not at all.
CREATE OR REPLACE FUNCTION public.set_sheet_scale(_sheet uuid, _feet_per_point numeric, _provenance text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p uuid;
BEGIN
  IF NOT public.has_capability('manage_estimates') THEN RAISE EXCEPTION 'Not allowed to set scales'; END IF;
  IF NOT (_feet_per_point > 0) OR _provenance NOT IN ('suggested','chosen','calibrated') THEN RAISE EXCEPTION 'Invalid scale'; END IF;
  SELECT project_id INTO p FROM public.plan_sheets WHERE id = _sheet;
  IF p IS NULL THEN RAISE EXCEPTION 'Sheet not found'; END IF;
  UPDATE public.sheet_scales SET feet_per_point = _feet_per_point, provenance = _provenance, set_by = auth.uid(), set_at = now() WHERE sheet_id = _sheet AND region IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.sheet_scales (project_id, sheet_id, feet_per_point, provenance) VALUES (p, _sheet, _feet_per_point, _provenance);
  END IF;
  UPDATE public.takeoff_shapes
     SET qty = CASE kind WHEN 'area' THEN qty * power(_feet_per_point / scale_feet_per_point, 2)
                         WHEN 'linear' THEN greatest(0, (qty + openings_ft * multiplier) * (_feet_per_point / scale_feet_per_point) - openings_ft * multiplier)
                         ELSE qty END,
         scale_feet_per_point = _feet_per_point, scale_provenance = _provenance
   WHERE sheet_id = _sheet;
END; $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.set_project_holdback(_project uuid, _pct numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to change the holdback'; END IF;
  IF _pct IS NULL OR _pct < 0 OR _pct > 50 THEN RAISE EXCEPTION 'Holdback must be between 0 and 50 percent'; END IF;
  UPDATE public.projects SET holdback_pct = _pct WHERE id = _project;
END; $$;
--> statement-breakpoint

-- Holdback can be released only from issued bills; a job with lines that are not GST-rated is not billed here yet.
CREATE OR REPLACE FUNCTION public.create_progress_bill(_project uuid, _kind text, _lines jsonb, _period_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE contract bigint; billed bigint; held bigint; released bigint; gross bigint; hb numeric; gst numeric; hold bigint; net bigint; tax bigint; n int; pn text; bid uuid;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to prepare bills'; END IF;
  IF _kind NOT IN ('progress','holdback_release') THEN RAISE EXCEPTION 'Unknown kind of bill'; END IF;
  IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'Add at least one line to the bill'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) l WHERE btrim(coalesce(l->>'description', '')) = '' OR coalesce((l->>'amountCents')::bigint, 0) <= 0) THEN
    RAISE EXCEPTION 'Each line needs a description and an amount above zero';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('progress_bills' || _project::text));
  SELECT holdback_pct, project_number INTO hb, pn FROM public.projects WHERE id = _project;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.quotes q, jsonb_array_elements(q.snapshot->'versions') v, jsonb_array_elements(v->'sections') s, jsonb_array_elements(s->'lines') l
              WHERE q.project_id = _project AND q.status = 'accepted' AND v->>'id' = q.accepted_version_id::text AND coalesce(l->>'taxCode', 'GST') <> 'GST') THEN
    RAISE EXCEPTION 'This job has lines that are not GST-rated, so its bills cannot be worked out here yet. Invoice it in QuickBooks.';
  END IF;
  SELECT coalesce(sum(accepted_value_cents), 0) INTO contract FROM public.quotes WHERE project_id = _project AND status = 'accepted';
  SELECT coalesce(sum(gross_cents) FILTER (WHERE kind = 'progress'), 0), coalesce(sum(holdback_cents) FILTER (WHERE kind = 'progress' AND status = 'issued'), 0), coalesce(sum(gross_cents) FILTER (WHERE kind = 'holdback_release'), 0)
    INTO billed, held, released FROM public.progress_bills WHERE project_id = _project AND status <> 'void';
  SELECT sum((l->>'amountCents')::bigint) INTO gross FROM jsonb_array_elements(_lines) l;
  SELECT gst_pct INTO gst FROM public.tax_settings WHERE id = 1;
  IF _kind = 'holdback_release' THEN
    IF gross > held - released THEN RAISE EXCEPTION 'Only % of holdback is being held.', to_char(greatest(held - released, 0) / 100.0, 'FM$999,999,990.00'); END IF;
    hb := 0;
  ELSE
    IF contract <= 0 THEN RAISE EXCEPTION 'There is no accepted quote yet, so there is nothing to bill against.'; END IF;
    IF billed + gross > contract THEN RAISE EXCEPTION 'That would bill more than the contract of %. Add a change order first.', to_char(contract / 100.0, 'FM$999,999,990.00'); END IF;
  END IF;
  hold := round(gross * hb / 100.0);
  net := gross - hold;
  tax := round(net * coalesce(gst, 5) / 100.0);
  SELECT coalesce(max(seq), 0) + 1 INTO n FROM public.progress_bills WHERE project_id = _project;
  INSERT INTO public.progress_bills (project_id, seq, number, kind, period_note, lines, gross_cents, holdback_pct, holdback_cents, net_cents, gst_cents, total_cents)
  VALUES (_project, n, coalesce(pn || '-', '') || 'B' || lpad(n::text, 2, '0'), _kind, nullif(btrim(coalesce(_period_note, '')), ''), _lines, gross, hb, hold, net, tax, net + tax)
  RETURNING id INTO bid;
  RETURN bid;
END; $$;
--> statement-breakpoint

-- A bill whose holdback has already been released cannot be voided out from under the release.
CREATE OR REPLACE FUNCTION public.set_progress_bill_status(_id uuid, _to text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.progress_bills; held_after bigint; released bigint;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to change bills'; END IF;
  SELECT * INTO b FROM public.progress_bills WHERE id = _id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('progress_bills' || b.project_id::text));
  IF _to = 'void' AND b.status = 'issued' AND b.kind = 'progress' THEN
    SELECT coalesce(sum(holdback_cents) FILTER (WHERE kind = 'progress' AND status = 'issued' AND id <> _id), 0), coalesce(sum(gross_cents) FILTER (WHERE kind = 'holdback_release' AND status <> 'void'), 0)
      INTO held_after, released FROM public.progress_bills WHERE project_id = b.project_id;
    IF released > held_after THEN RAISE EXCEPTION 'Holdback from this bill has already been released. Void the holdback release first.'; END IF;
  END IF;
  IF _to = 'issued' AND b.status = 'draft' THEN UPDATE public.progress_bills SET status = 'issued', issued_at = now() WHERE id = _id;
  ELSIF _to = 'void' AND b.status = 'issued' THEN UPDATE public.progress_bills SET status = 'void' WHERE id = _id;
  ELSIF _to = 'deleted' AND b.status = 'draft' THEN DELETE FROM public.progress_bills WHERE id = _id;
  ELSE RAISE EXCEPTION 'A % bill cannot be changed to %.', b.status, _to;
  END IF;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.set_sheet_scale(uuid, numeric, text), public.set_project_holdback(uuid, numeric) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.set_sheet_scale(uuid, numeric, text), public.set_project_holdback(uuid, numeric) TO authenticated;
