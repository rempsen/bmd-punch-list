ALTER TYPE public.document_section ADD VALUE IF NOT EXISTS 'estimates_imported';

CREATE TABLE IF NOT EXISTS public.import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  header_signature text NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  uses int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS import_templates_signature_idx ON public.import_templates(header_signature);

ALTER TABLE public.estimate_imports
  ADD COLUMN IF NOT EXISTS source_kind text CHECK (source_kind IN ('xlsx','csv','pdf')),
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.import_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS estimate_version_id uuid REFERENCES public.estimate_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.estimate_imports ALTER COLUMN kind DROP NOT NULL, ALTER COLUMN file_name DROP NOT NULL;
ALTER TABLE public.estimate_imports DROP CONSTRAINT IF EXISTS estimate_imports_status_check;
ALTER TABLE public.estimate_imports ADD CONSTRAINT estimate_imports_status_check CHECK (status IN ('review','applied','discarded','parsed','reviewing','committed'));

ALTER TABLE public.estimate_import_rows
  ADD COLUMN IF NOT EXISTS row_no int,
  ADD COLUMN IF NOT EXISTS kind text CHECK (kind IN ('group','item','total','ignored')),
  ADD COLUMN IF NOT EXISTS group_name text,
  ADD COLUMN IF NOT EXISTS parsed jsonb,
  ADD COLUMN IF NOT EXISTS match jsonb NOT NULL DEFAULT '{"status":"none"}'::jsonb,
  ADD COLUMN IF NOT EXISTS estimate_line_id uuid REFERENCES public.estimate_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_meta jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.estimate_import_rows ALTER COLUMN source_ref DROP NOT NULL, ALTER COLUMN decision DROP NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_import_rows_import_row_idx ON public.estimate_import_rows(import_id, row_no);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_templates, public.estimate_imports, public.estimate_import_rows TO authenticated;
GRANT ALL ON public.import_templates, public.estimate_imports, public.estimate_import_rows TO service_role;
ALTER TABLE public.import_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "estimate_imports job read" ON public.estimate_imports;
CREATE POLICY "estimate_imports job read" ON public.estimate_imports FOR SELECT TO authenticated
  USING (public.has_capability('view_pricing', project_id) OR public.has_capability('manage_projects', project_id));
DROP POLICY IF EXISTS "estimate_imports job write" ON public.estimate_imports;
CREATE POLICY "estimate_imports job write" ON public.estimate_imports FOR ALL TO authenticated
  USING (public.has_capability('manage_projects', project_id)) WITH CHECK (public.has_capability('manage_projects', project_id));

DROP POLICY IF EXISTS "estimate_import_rows job read" ON public.estimate_import_rows;
CREATE POLICY "estimate_import_rows job read" ON public.estimate_import_rows FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.estimate_imports i WHERE i.id = import_id AND (public.has_capability('view_pricing', i.project_id) OR public.has_capability('manage_projects', i.project_id))));
DROP POLICY IF EXISTS "estimate_import_rows job write" ON public.estimate_import_rows;
CREATE POLICY "estimate_import_rows job write" ON public.estimate_import_rows FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.estimate_imports i WHERE i.id = import_id AND public.has_capability('manage_projects', i.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.estimate_imports i WHERE i.id = import_id AND public.has_capability('manage_projects', i.project_id)));

DROP POLICY IF EXISTS "import_templates read" ON public.import_templates;
CREATE POLICY "import_templates read" ON public.import_templates FOR SELECT TO authenticated
  USING (public.has_capability('view_pricing') OR public.has_capability('manage_projects'));
DROP POLICY IF EXISTS "import_templates write" ON public.import_templates;
CREATE POLICY "import_templates write" ON public.import_templates FOR ALL TO authenticated
  USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
