DO $$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.def_before_update'::regproc);
  IF position('bmd.move_job' in src) = 0 THEN
    src := replace(src, 'IF new.project_id <> old.project_id THEN',
      'IF new.project_id <> old.project_id AND coalesce(current_setting(''bmd.move_job'', true), '''') <> ''on'' THEN');
    EXECUTE src;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.move_deficiency(_id uuid, _location uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.deficiencies;
  p1 uuid := public.location_project(_location);
  n integer;
  from_txt text; to_txt text;
BEGIN
  SELECT * INTO d FROM public.deficiencies WHERE id = _id;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;
  IF p1 IS NULL THEN RAISE EXCEPTION 'Room not found'; END IF;
  IF NOT public.has_capability('edit_any_item', d.project_id)
     OR NOT public.has_capability('edit_any_item', p1) THEN
    RAISE EXCEPTION 'You do not have permission to move this item';
  END IF;
  SELECT p.name || ' · ' || f.label || ' · ' || l.name INTO from_txt
    FROM locations l JOIN floors f ON f.id = l.floor_id JOIN projects p ON p.id = f.project_id WHERE l.id = d.location_id;
  SELECT p.name || ' · ' || f.label || ' · ' || l.name INTO to_txt
    FROM locations l JOIN floors f ON f.id = l.floor_id JOIN projects p ON p.id = f.project_id WHERE l.id = _location;
  IF p1 = d.project_id THEN
    UPDATE deficiencies SET location_id = _location WHERE id = _id;
    n := d.item_number;
  ELSE
    PERFORM set_config('bmd.move_job', 'on', true);
    SELECT coalesce(max(item_number), 0) + 1 INTO n FROM deficiencies WHERE project_id = p1;
    UPDATE deficiencies SET
      project_id = p1, location_id = _location, item_number = n,
      assigned_to = CASE WHEN assigned_to IS NOT NULL AND EXISTS (
        SELECT 1 FROM project_members m WHERE m.project_id = p1 AND m.user_id = d.assigned_to)
        THEN assigned_to ELSE NULL END
    WHERE id = _id;
    PERFORM set_config('bmd.move_job', '', true);
  END IF;
  INSERT INTO deficiency_events (deficiency_id, user_id, event_type, from_value, to_value, note)
  VALUES (_id, auth.uid(), 'moved', from_txt, to_txt,
    CASE WHEN p1 <> d.project_id THEN 'Moved to another job; was D-' || lpad(d.item_number::text, 4, '0') END);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.move_deficiency(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.move_deficiency(uuid, uuid) TO authenticated;