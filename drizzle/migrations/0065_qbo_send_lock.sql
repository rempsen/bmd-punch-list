-- Run lock for the QuickBooks sender (follow-up to 0061): the 5-minute schedule and a manual "Send now" must never
-- send the same waiting change twice.
ALTER TABLE public.sync_settings ADD COLUMN IF NOT EXISTS sending_since timestamptz;
--> statement-breakpoint
ALTER TABLE public.sync_settings ADD COLUMN IF NOT EXISTS sending_token uuid;
--> statement-breakpoint
-- Takes the run lock. Returns a token when this caller may send, null when another run started less than 30 minutes
-- ago. The token is what lets only the owning run release the lock.
CREATE OR REPLACE FUNCTION public.sync_send_lock()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tok uuid := gen_random_uuid(); got uuid;
BEGIN
  UPDATE public.sync_settings SET sending_since = now(), sending_token = tok
   WHERE id = 1 AND (sending_since IS NULL OR sending_since < now() - interval '30 minutes')
   RETURNING sending_token INTO got;
  RETURN got;
END; $$;
--> statement-breakpoint
-- Releases the lock only when the caller still owns it, so a run that outlived its lease cannot clear a newer run's lock.
CREATE OR REPLACE FUNCTION public.sync_send_unlock(_token uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.sync_settings SET sending_since = NULL, sending_token = NULL WHERE id = 1 AND sending_token = _token;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sync_send_lock() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sync_send_unlock(uuid) FROM PUBLIC, anon, authenticated;
