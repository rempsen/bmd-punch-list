CREATE OR REPLACE FUNCTION public.decision_notes(_ids uuid[])
RETURNS TABLE(id uuid, note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.client_decision_note
  FROM public.deficiencies d
  WHERE public.has_capability('view_client_notes')
    AND d.id = ANY(_ids)
    AND d.client_decision_note IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.decision_notes(uuid[]) TO authenticated;
COMMENT ON FUNCTION public.decision_note(public.deficiencies) IS 'DEPRECATED: use decision_notes(uuid[])';