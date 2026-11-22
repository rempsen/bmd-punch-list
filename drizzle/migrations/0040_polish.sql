-- Second review pass: lock a quote before checking it, and tighten three insert rules.
CREATE OR REPLACE FUNCTION public.issue_quote(_id uuid, _snapshot jsonb, _rollup jsonb, _recipients text[], _document_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.quotes; why text;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = _id FOR UPDATE;
  why := public.quote_issue_block(_id);
  IF why IS NOT NULL THEN RAISE EXCEPTION '%', why; END IF;
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
DROP POLICY IF EXISTS "install_visit_events add" ON public.install_visit_events;
--> statement-breakpoint
CREATE POLICY "install_visit_events add" ON public.install_visit_events FOR INSERT TO authenticated
  WITH CHECK (public.has_capability('manage_projects') AND source = 'staff' AND EXISTS (SELECT 1 FROM public.install_visits v WHERE v.id = visit_id AND v.project_id = install_visit_events.project_id));
--> statement-breakpoint
DROP POLICY IF EXISTS "takeoff_shapes same project" ON public.takeoff_shapes;
--> statement-breakpoint
CREATE POLICY "takeoff_shapes same project" ON public.takeoff_shapes AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.plan_sheets s WHERE s.id = sheet_id AND s.project_id = takeoff_shapes.project_id)
          AND EXISTS (SELECT 1 FROM public.takeoff_conditions c WHERE c.id = condition_id AND c.project_id = takeoff_shapes.project_id));
--> statement-breakpoint
DROP POLICY IF EXISTS "sheet_scales same project" ON public.sheet_scales;
--> statement-breakpoint
CREATE POLICY "sheet_scales same project" ON public.sheet_scales AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.plan_sheets s WHERE s.id = sheet_id AND s.project_id = sheet_scales.project_id));
