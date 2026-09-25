CREATE OR REPLACE FUNCTION public.def_decision_stamp()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'awaiting_client' AND NEW.status IN ('accepted_as_is','fix_required') THEN
    NEW.decided_at := now();
    NEW.decided_by := auth.uid();
    NEW.decision_outcome := NEW.status;
    IF NEW.status = 'fix_required' THEN
      -- Keep a future due date; otherwise give the trade 7 days from the decision
      IF NEW.due_date IS NULL OR NEW.due_date < current_date THEN
        NEW.due_date := current_date + 7;
      END IF;
    ELSE
      NEW.due_date := NULL; -- accepted as-is: nothing left to do
    END IF;
  END IF;
  RETURN NEW;
END $function$;