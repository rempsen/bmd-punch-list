ALTER TABLE public.deficiencies ADD COLUMN IF NOT EXISTS email_pending boolean NOT NULL DEFAULT false;
GRANT SELECT (email_pending) ON public.deficiencies TO authenticated;
UPDATE public.deficiencies SET email_pending = true WHERE source = 'email' AND status = 'open';
CREATE OR REPLACE FUNCTION public.def_email_pending_clear() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.email_pending AND auth.uid() IS NOT NULL THEN
    NEW.email_pending := false;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS def_email_pending_clear ON public.deficiencies;
CREATE TRIGGER def_email_pending_clear BEFORE UPDATE ON public.deficiencies FOR EACH ROW EXECUTE FUNCTION public.def_email_pending_clear();