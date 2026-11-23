-- BMD's subscription to ArrivePing's integration webhooks, and when BMD last checked its visits against ArrivePing.
-- One row for the company. The signing secret is stored encrypted and the table has no browser access at all:
-- only the server reads or writes it.
CREATE TABLE IF NOT EXISTS public.arriveping_link (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  subscription_id text,
  webhook_url text,
  secret_enc text,
  events text,
  connected_by uuid,
  connected_at timestamptz,
  last_check_at timestamptz,
  last_check_error text
);
--> statement-breakpoint
ALTER TABLE public.arriveping_link ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.arriveping_link FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
INSERT INTO public.arriveping_link (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
