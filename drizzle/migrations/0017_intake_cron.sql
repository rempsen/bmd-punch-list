-- lovable-cron-fallback-reviewed: Microsoft 365 mailbox has no Lovable-side push; plan approved 5-minute pickup of forwarded issue emails
CREATE TABLE public.intake_cron (id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), token text NOT NULL);
GRANT ALL ON public.intake_cron TO service_role;
ALTER TABLE public.intake_cron ENABLE ROW LEVEL SECURITY;
INSERT INTO public.intake_cron (id, token) VALUES (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
SELECT cron.schedule('bmd-email-intake', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--4ee30e5b-d222-45f5-8a77-2a181efc21f2.lovable.app/api/public/intake/poll',
    headers := jsonb_build_object('Content-Type','application/json','x-intake-token',(SELECT token FROM public.intake_cron WHERE id = 1)),
    body := '{}'::jsonb
  );
$$);