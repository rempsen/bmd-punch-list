-- BMD Projects' own QuickBooks connection (one for the company), and the staging area a pull lands in.
-- qbo_connection holds an encrypted sign-in and has no browser access at all: only the server reads or writes it.
CREATE TABLE IF NOT EXISTS public.qbo_connection (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  realm_id text NOT NULL,
  company_name text,
  refresh_token_enc text NOT NULL,
  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  last_pull_at timestamptz
);
--> statement-breakpoint
ALTER TABLE public.qbo_connection ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.qbo_connection FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- A read-only copy of another system's records, held here before anything is created in BMD.
CREATE TABLE IF NOT EXISTS public.sync_staging (
  system text NOT NULL CHECK (system IN ('quickbooks','arriveping','companycam')),
  entity text NOT NULL,
  external_id text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}',
  pulled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (system, entity, external_id)
);
--> statement-breakpoint
ALTER TABLE public.sync_staging ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.sync_staging FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.sync_staging TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "sync_staging read" ON public.sync_staging;
--> statement-breakpoint
CREATE POLICY "sync_staging read" ON public.sync_staging FOR SELECT TO authenticated USING (public.has_capability('manage_integrations') OR public.has_capability('manage_catalogue'));
