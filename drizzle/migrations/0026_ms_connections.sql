-- Microsoft 365 connections. Refresh tokens are encrypted by the server and never readable from the browser:
-- row level security is on and no role but the service role has any grant.
CREATE TABLE IF NOT EXISTS public.ms_connections (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_email text NOT NULL,
  refresh_token_enc text NOT NULL,
  scopes text,
  is_library_connection boolean NOT NULL DEFAULT false,
  onedrive_root_item_id text,
  onedrive_root_path text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ms_connections_one_library ON public.ms_connections (is_library_connection) WHERE is_library_connection;
--> statement-breakpoint
ALTER TABLE public.ms_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.ms_connections FROM PUBLIC, anon, authenticated;
