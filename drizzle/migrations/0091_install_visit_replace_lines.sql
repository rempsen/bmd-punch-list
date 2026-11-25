-- Replaces a work order's lines in one transaction, so a refused line (a negative quantity, say) leaves the saved ones
-- in place. SECURITY INVOKER: RLS on install_visit_lines still decides who may write.
CREATE OR REPLACE FUNCTION public.install_visit_replace_lines(_visit uuid, _lines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  _project uuid;
  l jsonb;
  i int := 0;
BEGIN
  SELECT project_id INTO _project FROM public.install_visits WHERE id = _visit;
  IF _project IS NULL THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF NOT public.has_capability('manage_projects', _project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' THEN RAISE EXCEPTION 'Lines must be a list'; END IF;
  DELETE FROM public.install_visit_lines WHERE visit_id = _visit;
  FOR l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    INSERT INTO public.install_visit_lines (visit_id, project_id, estimate_line_id, finish_id, description, quantity, uom, cost_code, sort_order)
    VALUES (_visit, _project, (l->>'estimate_line_id')::uuid, (l->>'finish_id')::uuid, coalesce(l->>'description', ''),
            coalesce((l->>'quantity')::numeric, 0), coalesce(nullif(btrim(l->>'uom'), ''), 'EA'), nullif(btrim(l->>'cost_code'), ''), coalesce((l->>'sort_order')::int, i));
    i := i + 1;
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.install_visit_replace_lines(uuid, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.install_visit_replace_lines(uuid, jsonb) TO authenticated;
--> statement-breakpoint
