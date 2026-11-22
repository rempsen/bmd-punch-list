-- Progress billing with holdback. All figures are worked out here from the accepted contract, never taken from the browser.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS holdback_pct numeric NOT NULL DEFAULT 7.5 CHECK (holdback_pct >= 0 AND holdback_pct <= 50);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.progress_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  seq int NOT NULL,
  number text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('progress','holdback_release')),
  period_note text,
  lines jsonb NOT NULL DEFAULT '[]',
  gross_cents bigint NOT NULL CHECK (gross_cents > 0),
  holdback_pct numeric NOT NULL,
  holdback_cents bigint NOT NULL,
  net_cents bigint NOT NULL,
  gst_cents bigint NOT NULL,
  total_cents bigint NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','void')),
  issued_at timestamptz,
  qbo_invoice_id text,
  document_id uuid REFERENCES public.project_documents(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, seq)
);
--> statement-breakpoint
ALTER TABLE public.progress_bills ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.progress_bills FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.progress_bills TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "progress_bills read" ON public.progress_bills;
--> statement-breakpoint
CREATE POLICY "progress_bills read" ON public.progress_bills FOR SELECT TO authenticated USING (public.has_capability('view_pricing'));
--> statement-breakpoint

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
  SELECT coalesce(sum(accepted_value_cents), 0) INTO contract FROM public.quotes WHERE project_id = _project AND status = 'accepted';
  SELECT coalesce(sum(gross_cents) FILTER (WHERE kind = 'progress'), 0), coalesce(sum(holdback_cents) FILTER (WHERE kind = 'progress'), 0), coalesce(sum(gross_cents) FILTER (WHERE kind = 'holdback_release'), 0)
    INTO billed, held, released FROM public.progress_bills WHERE project_id = _project AND status <> 'void';
  SELECT sum((l->>'amountCents')::bigint) INTO gross FROM jsonb_array_elements(_lines) l;
  SELECT gst_pct INTO gst FROM public.tax_settings WHERE id = 1;
  IF _kind = 'holdback_release' THEN
    IF gross > held - released THEN RAISE EXCEPTION 'Only % of holdback is being held.', to_char((held - released) / 100.0, 'FM$999,999,990.00'); END IF;
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

-- Draft → issued, issued → void, and a draft can be deleted. An issued bill is never edited.
CREATE OR REPLACE FUNCTION public.set_progress_bill_status(_id uuid, _to text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.progress_bills;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to change bills'; END IF;
  SELECT * INTO b FROM public.progress_bills WHERE id = _id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF _to = 'issued' AND b.status = 'draft' THEN UPDATE public.progress_bills SET status = 'issued', issued_at = now() WHERE id = _id;
  ELSIF _to = 'void' AND b.status = 'issued' THEN UPDATE public.progress_bills SET status = 'void' WHERE id = _id;
  ELSIF _to = 'deleted' AND b.status = 'draft' THEN DELETE FROM public.progress_bills WHERE id = _id;
  ELSE RAISE EXCEPTION 'A % bill cannot be changed to %.', b.status, _to;
  END IF;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_progress_bill(uuid, text, jsonb, text), public.set_progress_bill_status(uuid, text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_progress_bill(uuid, text, jsonb, text), public.set_progress_bill_status(uuid, text) TO authenticated;
