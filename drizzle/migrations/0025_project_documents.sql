-- BMD Projects: project documents (plans, specs, vendor info, quotes sent, contract, photos) with versions.
-- Idempotent: safe to run more than once.

DO $$ BEGIN
  CREATE TYPE public.document_section AS ENUM ('plans','specifications','vendor','quotes_sent','contract','photos','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.project_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  section public.document_section NOT NULL,
  file_name text NOT NULL CHECK (btrim(file_name) <> ''),
  storage_path text NOT NULL UNIQUE,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  mime text,
  version int NOT NULL DEFAULT 1,
  uploaded_by uuid DEFAULT auth.uid(),
  note text,
  catalogue_material_id uuid,
  onedrive_item_id text,
  mirror_status text NOT NULL DEFAULT 'pending' CHECK (mirror_status IN ('pending','done','failed','off')),
  mirror_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_documents_version_key
  ON public.project_documents (project_id, section, lower(file_name), version);
--> statement-breakpoint

-- Document access: the capability on that job, or the capability plus company-wide pipeline access.
CREATE OR REPLACE FUNCTION public.can_project_documents(_project uuid, _write boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _project IS NOT NULL AND (
    public.has_capability(CASE WHEN _write THEN 'manage_documents' ELSE 'view_documents' END, _project)
    OR (public.has_capability('view_pipeline')
        AND public.has_capability(CASE WHEN _write THEN 'manage_documents' ELSE 'view_documents' END))
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.can_project_documents(uuid, boolean) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.can_project_documents(uuid, boolean) TO authenticated;
--> statement-breakpoint

-- The project a storage object belongs to, from the first folder of its path. Null when the path is not ours.
CREATE OR REPLACE FUNCTION public.document_path_project(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  RETURN split_part(_name, '/', 1)::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END; $$;
--> statement-breakpoint

-- Same file name in the same section becomes the next version; earlier versions are kept.
CREATE OR REPLACE FUNCTION public.project_documents_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.file_name := btrim(NEW.file_name);
  NEW.uploaded_by := coalesce(auth.uid(), NEW.uploaded_by);
  IF public.document_path_project(NEW.storage_path) IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'Storage path does not belong to this project';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text || NEW.section::text || lower(NEW.file_name)));
  SELECT coalesce(max(d.version), 0) + 1 INTO NEW.version
    FROM public.project_documents d
   WHERE d.project_id = NEW.project_id AND d.section = NEW.section AND lower(d.file_name) = lower(NEW.file_name);
  RETURN NEW;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_documents_before_insert ON public.project_documents;
--> statement-breakpoint
CREATE TRIGGER project_documents_before_insert BEFORE INSERT ON public.project_documents
  FOR EACH ROW EXECUTE FUNCTION public.project_documents_before_insert();
--> statement-breakpoint

ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.project_documents FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.project_documents TO authenticated;
--> statement-breakpoint
GRANT UPDATE (note, section) ON public.project_documents TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "documents read" ON public.project_documents;
--> statement-breakpoint
CREATE POLICY "documents read" ON public.project_documents FOR SELECT TO authenticated
  USING (public.can_project_documents(project_id, false));
--> statement-breakpoint
DROP POLICY IF EXISTS "documents add" ON public.project_documents;
--> statement-breakpoint
CREATE POLICY "documents add" ON public.project_documents FOR INSERT TO authenticated
  WITH CHECK (public.can_project_documents(project_id, true));
--> statement-breakpoint
DROP POLICY IF EXISTS "documents edit" ON public.project_documents;
--> statement-breakpoint
CREATE POLICY "documents edit" ON public.project_documents FOR UPDATE TO authenticated
  USING (public.can_project_documents(project_id, true)) WITH CHECK (public.can_project_documents(project_id, true));
--> statement-breakpoint

-- Private bucket, 250 MB per file. Path: {project_id}/{section}/{document_id}/{filename}
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('project-documents', 'project-documents', false, 262144000)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 262144000;
--> statement-breakpoint
DROP POLICY IF EXISTS "project documents readable" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "project documents readable" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-documents' AND public.can_project_documents(public.document_path_project(name), false));
--> statement-breakpoint
DROP POLICY IF EXISTS "project documents uploadable" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "project documents uploadable" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-documents' AND public.can_project_documents(public.document_path_project(name), true));
--> statement-breakpoint
-- Resumable uploads update the object they are writing.
DROP POLICY IF EXISTS "project documents resumable" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "project documents resumable" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'project-documents' AND public.can_project_documents(public.document_path_project(name), true))
  WITH CHECK (bucket_id = 'project-documents' AND public.can_project_documents(public.document_path_project(name), true));
--> statement-breakpoint
-- Only a super admin can remove a document (a wrong upload); everyone else keeps history.
GRANT DELETE ON public.project_documents TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "documents delete" ON public.project_documents;
--> statement-breakpoint
CREATE POLICY "documents delete" ON public.project_documents FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "project documents deletable by super admin" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "project documents deletable by super admin" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-documents' AND public.is_super_admin(auth.uid()));
