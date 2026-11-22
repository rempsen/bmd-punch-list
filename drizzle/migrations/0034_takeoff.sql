-- Takeoff: sheet scales, conditions (what is being measured) and the shapes drawn for them.
CREATE TABLE IF NOT EXISTS public.sheet_scales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sheet_id uuid NOT NULL REFERENCES public.plan_sheets(id) ON DELETE CASCADE,
  region jsonb,
  feet_per_point numeric NOT NULL CHECK (feet_per_point > 0),
  provenance text NOT NULL CHECK (provenance IN ('suggested','chosen','calibrated')),
  set_by uuid DEFAULT auth.uid(),
  set_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sheet_scales_whole_sheet_key ON public.sheet_scales (sheet_id) WHERE region IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.takeoff_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  finish_id uuid REFERENCES public.project_finishes(id) ON DELETE SET NULL,
  label text NOT NULL CHECK (btrim(label) <> ''),
  kind text NOT NULL CHECK (kind IN ('area','linear','count')),
  colour text NOT NULL DEFAULT '#2563eb',
  default_section text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.takeoff_shapes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sheet_id uuid NOT NULL REFERENCES public.plan_sheets(id) ON DELETE CASCADE,
  condition_id uuid NOT NULL REFERENCES public.takeoff_conditions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('area','linear','count')),
  vertices jsonb NOT NULL,
  cutouts jsonb NOT NULL DEFAULT '[]',
  openings_ft numeric NOT NULL DEFAULT 0 CHECK (openings_ft >= 0),
  multiplier numeric NOT NULL DEFAULT 1 CHECK (multiplier > 0),
  label text,
  section text,
  qty numeric NOT NULL DEFAULT 0,
  scale_feet_per_point numeric NOT NULL CHECK (scale_feet_per_point > 0),
  scale_provenance text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS takeoff_shapes_project_idx ON public.takeoff_shapes (project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS takeoff_shapes_sheet_idx ON public.takeoff_shapes (sheet_id);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sheet_scales','takeoff_conditions','takeoff_shapes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_project_documents(project_id, false) OR public.has_capability(''manage_estimates''))', t || ' read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.has_capability(''manage_estimates'')) WITH CHECK (public.has_capability(''manage_estimates''))', t || ' write', t);
  END LOOP;
END $$;
