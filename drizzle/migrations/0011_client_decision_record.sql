ALTER TABLE public.deficiencies
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by uuid,
  ADD COLUMN IF NOT EXISTS decision_outcome public.deficiency_status;
GRANT SELECT (decided_at, decided_by, decision_outcome) ON public.deficiencies TO authenticated;

CREATE OR REPLACE FUNCTION public.def_decision_stamp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'awaiting_client' AND NEW.status IN ('accepted_as_is','fix_required') THEN
    NEW.decided_at := now();
    NEW.decided_by := auth.uid();
    NEW.decision_outcome := NEW.status;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS def_decision_stamp ON public.deficiencies;
CREATE TRIGGER def_decision_stamp BEFORE UPDATE ON public.deficiencies
FOR EACH ROW EXECUTE FUNCTION public.def_decision_stamp();

CREATE OR REPLACE FUNCTION public.def_decision_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.decided_at IS DISTINCT FROM OLD.decided_at AND NEW.decided_at IS NOT NULL THEN
    INSERT INTO public.deficiency_events(deficiency_id, user_id, event_type, from_value, to_value)
    VALUES (NEW.id, NEW.decided_by, 'client_decision', 'awaiting_client', NEW.decision_outcome::text);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS def_decision_event ON public.deficiencies;
CREATE TRIGGER def_decision_event AFTER UPDATE ON public.deficiencies
FOR EACH ROW EXECUTE FUNCTION public.def_decision_event();