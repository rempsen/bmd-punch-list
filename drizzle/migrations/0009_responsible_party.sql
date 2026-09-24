CREATE TYPE public.responsible_party AS ENUM ('bmd','trade','client','unassigned');
ALTER TABLE public.deficiencies ADD COLUMN responsible_party public.responsible_party NOT NULL DEFAULT 'unassigned';

CREATE OR REPLACE FUNCTION public.def_resp_log()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
begin
  if new.responsible_party is distinct from old.responsible_party then
    insert into public.deficiency_events (deficiency_id, user_id, event_type, from_value, to_value)
    values (new.id, auth.uid(), 'responsible_change', old.responsible_party::text, new.responsible_party::text);
  end if;
  return null;
end; $$;
CREATE TRIGGER def_resp_log AFTER UPDATE ON public.deficiencies FOR EACH ROW EXECUTE FUNCTION public.def_resp_log();