-- Sending catalogue changes to QuickBooks. Off until someone turns it on under Company settings → Sync.
CREATE TABLE IF NOT EXISTS public.sync_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  quickbooks_send_enabled boolean NOT NULL DEFAULT false,
  last_send_at timestamptz,
  -- Set while a send run is in progress so the schedule and a manual "Send now" never send the same change twice.
  sending_since timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
--> statement-breakpoint
INSERT INTO public.sync_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE public.sync_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.sync_settings FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.sync_settings TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "sync_settings read" ON public.sync_settings;
--> statement-breakpoint
CREATE POLICY "sync_settings read" ON public.sync_settings FOR SELECT TO authenticated USING (public.has_capability('manage_integrations'));
--> statement-breakpoint
DO $$ BEGIN
  PERFORM cron.unschedule('bmd-qbo-send');
EXCEPTION WHEN others THEN NULL; END $$;
--> statement-breakpoint
SELECT cron.schedule('bmd-qbo-send', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--4ee30e5b-d222-45f5-8a77-2a181efc21f2.lovable.app/api/public/sync/send',
    headers := jsonb_build_object('Content-Type','application/json','x-intake-token',(SELECT token FROM public.intake_cron WHERE id = 1)),
    body := '{}'::jsonb
  );
$$);
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
