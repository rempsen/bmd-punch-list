-- Run lock for the QuickBooks sender (follow-up to 0061): the 5-minute schedule and a manual "Send now" must never
-- send the same waiting change twice.
ALTER TABLE public.sync_settings ADD COLUMN IF NOT EXISTS sending_since timestamptz;
--> statement-breakpoint
-- Takes the run lock: true when this caller may send, false when another run started less than 10 minutes ago.
CREATE OR REPLACE FUNCTION public.sync_send_lock()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE got boolean;
BEGIN
  UPDATE public.sync_settings SET sending_since = now()
   WHERE id = 1 AND (sending_since IS NULL OR sending_since < now() - interval '10 minutes')
   RETURNING true INTO got;
  RETURN coalesce(got, false);
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sync_send_unlock()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.sync_settings SET sending_since = NULL WHERE id = 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sync_send_lock() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sync_send_unlock() FROM PUBLIC, anon, authenticated;
