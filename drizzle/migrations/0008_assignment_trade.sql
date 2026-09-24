ALTER TABLE public.deficiencies ADD COLUMN IF NOT EXISTS assigned_trade text, ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

CREATE OR REPLACE FUNCTION public.def_assign_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF tg_op = 'INSERT' THEN
    IF new.assigned_to IS NOT NULL OR coalesce(new.assigned_trade,'') <> '' THEN new.assigned_at := now(); END IF;
    RETURN new;
  END IF;
  IF coalesce(new.assigned_trade,'') IS DISTINCT FROM coalesce(old.assigned_trade,'')
     OR coalesce(new.assigned_to::text,'') IS DISTINCT FROM coalesce(old.assigned_to::text,'') THEN
    IF auth.uid() IS NOT NULL AND NOT public.has_capability('assign_items', old.project_id) THEN
      RAISE EXCEPTION 'You do not have permission to assign items';
    END IF;
    new.assigned_trade := nullif(trim(new.assigned_trade), '');
    new.assigned_at := CASE WHEN new.assigned_to IS NULL AND new.assigned_trade IS NULL THEN NULL ELSE now() END;
  END IF;
  RETURN new;
END; $$;

DROP TRIGGER IF EXISTS def_assign_before ON public.deficiencies;
CREATE TRIGGER def_assign_before BEFORE INSERT OR UPDATE ON public.deficiencies
FOR EACH ROW EXECUTE FUNCTION public.def_assign_before();

CREATE OR REPLACE FUNCTION public.def_trade_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(new.assigned_trade,'') <> coalesce(old.assigned_trade,'') THEN
    INSERT INTO public.deficiency_events (deficiency_id, user_id, event_type, from_value, to_value)
    VALUES (new.id, auth.uid(), 'trade_assignment', old.assigned_trade, new.assigned_trade);
  END IF;
  RETURN null;
END; $$;

DROP TRIGGER IF EXISTS def_trade_after ON public.deficiencies;
CREATE TRIGGER def_trade_after AFTER UPDATE ON public.deficiencies
FOR EACH ROW EXECUTE FUNCTION public.def_trade_after();

CREATE OR REPLACE FUNCTION public.project_people(_project uuid)
RETURNS TABLE(id uuid, email text, full_name text, company text, role app_role)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_project_member(_project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  SELECT p.id, p.email, p.full_name, p.company, m.role
  FROM public.project_members m JOIN public.profiles p ON p.id = m.user_id
  WHERE m.project_id = _project
  ORDER BY coalesce(p.full_name, p.email);
END; $$;
GRANT EXECUTE ON FUNCTION public.project_people(uuid) TO authenticated;