ALTER TABLE public.catalogue_aliases ADD COLUMN IF NOT EXISTS item_key text GENERATED ALWAYS AS (CASE WHEN catalogue_item_id IS NOT NULL THEN 'material' ELSE 'assembly' END) STORED;

CREATE OR REPLACE FUNCTION public.save_import_decision(_row uuid, _decision jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE imp public.estimate_imports;
BEGIN
  SELECT i.* INTO imp FROM public.estimate_imports i JOIN public.estimate_import_rows r ON r.import_id = i.id WHERE r.id = _row;
  IF imp.id IS NULL OR NOT public.has_capability('manage_projects', imp.project_id) OR NOT public.has_capability('view_pricing', imp.project_id) THEN
    RAISE EXCEPTION 'Not allowed to change this import';
  END IF;
  IF imp.status NOT IN ('parsed','reviewing') THEN RAISE EXCEPTION 'This import is already committed and is read-only'; END IF;
  IF _decision IS NULL OR jsonb_typeof(_decision) <> 'object' OR NOT (_decision->>'action' IN ('keep_imported','catalogue','new_product','skip')) THEN
    RAISE EXCEPTION 'Unknown decision';
  END IF;
  UPDATE public.estimate_import_rows SET match = jsonb_set(coalesce(match,'{}'::jsonb), '{decision}', _decision), decision_meta = _decision, updated_at = now() WHERE id = _row;
  UPDATE public.estimate_imports SET status = 'reviewing', updated_at = now() WHERE id = imp.id AND status = 'parsed';
END $$;
REVOKE ALL ON FUNCTION public.save_import_decision(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_import_decision(uuid, jsonb) TO authenticated, service_role;