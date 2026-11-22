-- A record of each price import: what the source said, what was brought in, what was left out.
CREATE TABLE IF NOT EXISTS public.estimate_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version_id uuid REFERENCES public.estimate_versions(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.project_documents(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('procore','graber')),
  file_name text NOT NULL CHECK (btrim(file_name) <> ''),
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('review','applied','discarded')),
  source_totals jsonb NOT NULL DEFAULT '{}',
  reconciliation jsonb NOT NULL DEFAULT '{}',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.estimate_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.estimate_imports(id) ON DELETE CASCADE,
  source_ref text NOT NULL,
  raw jsonb NOT NULL,
  proposed jsonb,
  issue text,
  decision text NOT NULL CHECK (decision IN ('imported','left_out'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS estimate_imports_project_idx ON public.estimate_imports (project_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS estimate_import_rows_import_idx ON public.estimate_import_rows (import_id);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['estimate_imports','estimate_import_rows'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_capability(''view_pricing''))', t || ' read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' add', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_capability(''manage_estimates''))', t || ' add', t);
  END LOOP;
END $$;
