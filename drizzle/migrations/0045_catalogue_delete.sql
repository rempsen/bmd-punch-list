-- Deleting a catalogue item. Something still in use is not deleted (it would quietly lose its place in an assembly
-- or on a job); it is made inactive instead. Estimate lines keep their own copy of costs, so they are not affected.
CREATE OR REPLACE FUNCTION public.delete_catalogue_item(_kind text, _id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; m int;
BEGIN
  IF NOT public.has_capability('manage_catalogue') THEN RAISE EXCEPTION 'Not allowed to change the catalogue'; END IF;
  IF _kind = 'material' THEN
    SELECT count(DISTINCT template_id) INTO n FROM public.assembly_template_components WHERE catalogue_material_id = _id;
    SELECT count(*) INTO m FROM public.project_finishes WHERE catalogue_material_id = _id;
    IF n + m > 0 THEN RAISE EXCEPTION 'IN_USE: used by % assembl% and % finish% on jobs. Make it inactive instead.', n, CASE WHEN n = 1 THEN 'y' ELSE 'ies' END, m, CASE WHEN m = 1 THEN '' ELSE 'es' END; END IF;
    DELETE FROM public.catalogue_materials WHERE id = _id;
  ELSIF _kind = 'labour' THEN
    SELECT count(DISTINCT template_id) INTO n FROM public.assembly_template_components WHERE labour_rate_id = _id;
    IF n > 0 THEN RAISE EXCEPTION 'IN_USE: used by % assembl%. Make it inactive instead.', n, CASE WHEN n = 1 THEN 'y' ELSE 'ies' END; END IF;
    DELETE FROM public.labour_rates WHERE id = _id;
  ELSIF _kind = 'assembly' THEN
    SELECT count(*) INTO n FROM public.project_finishes WHERE assembly_template_id = _id;
    IF n > 0 THEN RAISE EXCEPTION 'IN_USE: used by % finish% on jobs. Make it inactive instead.', n, CASE WHEN n = 1 THEN '' ELSE 'es' END; END IF;
    DELETE FROM public.assembly_templates WHERE id = _id;
  ELSIF _kind = 'supplier' THEN
    SELECT count(*) INTO n FROM public.catalogue_materials WHERE supplier_id = _id;
    IF n > 0 THEN RAISE EXCEPTION 'IN_USE: % material% bought from this supplier. Move them to another supplier first, or make this one inactive.', n, CASE WHEN n = 1 THEN ' is' ELSE 's are' END; END IF;
    DELETE FROM public.suppliers WHERE id = _id;
  ELSE
    RAISE EXCEPTION 'Unknown catalogue item';
  END IF;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.delete_catalogue_item(text, uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.delete_catalogue_item(text, uuid) TO authenticated;
