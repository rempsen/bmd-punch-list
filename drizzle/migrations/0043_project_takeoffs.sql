-- Where the OpenTakeoff workspace keeps each project's takeoff, its named snapshots, and the company's shared libraries.
CREATE TABLE IF NOT EXISTS public.project_takeoffs (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  doc jsonb NOT NULL,
  version int NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_takeoffs_size CHECK (octet_length(doc::text) <= 50000000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.project_takeoff_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 200),
  doc jsonb NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_takeoff_snapshots_size CHECK (octet_length(doc::text) <= 50000000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_takeoff_snapshots_project_idx ON public.project_takeoff_snapshots (project_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.takeoff_library (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  templates jsonb NOT NULL DEFAULT '[]',
  materials jsonb NOT NULL DEFAULT '[]',
  stamps jsonb NOT NULL DEFAULT '{}',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO public.takeoff_library (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_takeoffs','project_takeoff_snapshots','takeoff_library'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
  DROP POLICY IF EXISTS "project_takeoffs read" ON public.project_takeoffs;
  CREATE POLICY "project_takeoffs read" ON public.project_takeoffs FOR SELECT TO authenticated USING (public.can_project_documents(project_id, false));
  DROP POLICY IF EXISTS "project_takeoff_snapshots read" ON public.project_takeoff_snapshots;
  CREATE POLICY "project_takeoff_snapshots read" ON public.project_takeoff_snapshots FOR SELECT TO authenticated USING (public.can_project_documents(project_id, false));
  GRANT INSERT, DELETE ON public.project_takeoff_snapshots TO authenticated;
  DROP POLICY IF EXISTS "project_takeoff_snapshots add" ON public.project_takeoff_snapshots;
  CREATE POLICY "project_takeoff_snapshots add" ON public.project_takeoff_snapshots FOR INSERT TO authenticated
    WITH CHECK (public.can_project_documents(project_id, false) AND public.has_capability('manage_estimates'));
  DROP POLICY IF EXISTS "project_takeoff_snapshots remove" ON public.project_takeoff_snapshots;
  CREATE POLICY "project_takeoff_snapshots remove" ON public.project_takeoff_snapshots FOR DELETE TO authenticated
    USING (public.can_project_documents(project_id, false) AND public.has_capability('manage_estimates'));
  DROP POLICY IF EXISTS "takeoff_library read" ON public.takeoff_library;
  CREATE POLICY "takeoff_library read" ON public.takeoff_library FOR SELECT TO authenticated USING (public.has_capability('view_documents'));
  GRANT UPDATE (templates, materials, stamps) ON public.takeoff_library TO authenticated;
  DROP POLICY IF EXISTS "takeoff_library write" ON public.takeoff_library;
  CREATE POLICY "takeoff_library write" ON public.takeoff_library FOR UPDATE TO authenticated
    USING (public.has_capability('manage_estimates')) WITH CHECK (public.has_capability('manage_estimates'));
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.takeoff_library_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS takeoff_library_touch ON public.takeoff_library;
--> statement-breakpoint
CREATE TRIGGER takeoff_library_touch BEFORE UPDATE ON public.takeoff_library FOR EACH ROW EXECUTE FUNCTION public.takeoff_library_touch();
--> statement-breakpoint

-- Saves a project's takeoff only if nobody else has saved since this window loaded it.
-- _expected_version 0 means "there was no takeoff when I loaded". Returns the new version.
CREATE OR REPLACE FUNCTION public.save_project_takeoff(_project uuid, _doc jsonb, _expected_version int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur public.project_takeoffs; who text; v int;
BEGIN
  IF NOT (public.can_project_documents(_project, false) AND public.has_capability('manage_estimates')) THEN
    RAISE EXCEPTION 'Not allowed to save this takeoff';
  END IF;
  IF _doc IS NULL OR jsonb_typeof(_doc) <> 'object' THEN RAISE EXCEPTION 'A takeoff must be a document'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('takeoff' || _project::text));
  SELECT * INTO cur FROM public.project_takeoffs WHERE project_id = _project;
  IF coalesce(cur.version, 0) <> coalesce(_expected_version, 0) THEN
    SELECT coalesce(nullif(btrim(full_name), ''), email, 'someone else') INTO who FROM public.profiles WHERE id = cur.updated_by;
    RAISE EXCEPTION 'TAKEOFF_CONFLICT:%:%', coalesce(cur.version, 0), coalesce(who, 'someone else');
  END IF;
  IF cur.project_id IS NULL THEN
    INSERT INTO public.project_takeoffs (project_id, doc, version, updated_by) VALUES (_project, _doc, 1, auth.uid()) RETURNING version INTO v;
  ELSE
    UPDATE public.project_takeoffs SET doc = _doc, version = cur.version + 1, updated_by = auth.uid(), updated_at = now() WHERE project_id = _project RETURNING version INTO v;
  END IF;
  RETURN v;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.save_project_takeoff(uuid, jsonb, int) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.save_project_takeoff(uuid, jsonb, int) TO authenticated;
