ALTER TABLE public.deficiencies
  ADD COLUMN IF NOT EXISTS decision_recommendation public.deficiency_status,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS decision_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_requested_by uuid;
GRANT SELECT (decision_recommendation, decision_reason, decision_requested_at, decision_requested_by) ON public.deficiencies TO authenticated;
GRANT UPDATE (decision_recommendation, decision_reason, decision_requested_at, decision_requested_by) ON public.deficiencies TO authenticated;

CREATE OR REPLACE FUNCTION public.def_decision_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.decision_requested_at IS DISTINCT FROM OLD.decision_requested_at AND NEW.decision_requested_at IS NOT NULL THEN
    INSERT INTO public.deficiency_events(deficiency_id, user_id, event_type, to_value, note)
    VALUES (NEW.id, auth.uid(), 'decision_request', NEW.decision_recommendation::text, NEW.decision_reason);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS def_decision_log ON public.deficiencies;
CREATE TRIGGER def_decision_log AFTER UPDATE ON public.deficiencies
FOR EACH ROW EXECUTE FUNCTION public.def_decision_log();