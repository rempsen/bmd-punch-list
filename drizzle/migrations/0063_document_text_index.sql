-- Document text index: the text of every page of every project document, searchable with Postgres full-text search.
-- No AI is involved. It is the foundation for the assistant (stage 5 of the takeoff/assistant design).
-- Text is read in the browser (pdf.js) and stored through a server function; the browser never writes pages directly.

ALTER TABLE public.project_documents ADD COLUMN IF NOT EXISTS text_status text NOT NULL DEFAULT 'pending'
  CHECK (text_status IN ('pending','done','no_text','failed'));
--> statement-breakpoint
ALTER TABLE public.project_documents ADD COLUMN IF NOT EXISTS text_pages int;
--> statement-breakpoint
ALTER TABLE public.project_documents ADD COLUMN IF NOT EXISTS text_indexed_at timestamptz;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.document_pages (
  document_id uuid NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  page int NOT NULL CHECK (page > 0),
  text text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  PRIMARY KEY (document_id, page)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS document_pages_tsv_idx ON public.document_pages USING GIN (tsv);
--> statement-breakpoint
ALTER TABLE public.document_pages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.document_pages FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.document_pages TO authenticated;
--> statement-breakpoint
-- Readable exactly when the parent document is readable (same rule as "documents read" in 0025). No browser writes.
DROP POLICY IF EXISTS "document pages read" ON public.document_pages;
--> statement-breakpoint
CREATE POLICY "document pages read" ON public.document_pages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.project_documents d WHERE d.id = document_id AND public.can_project_documents(d.project_id, false)));
--> statement-breakpoint

-- Search inside documents. Only the latest version of each file name in a section is searched; `_project` null means
-- every project the caller can read. Matches use web-search syntax ("tile -carpet", "\"floor base\"").
CREATE OR REPLACE FUNCTION public.search_document_pages(_project uuid, _q text, _limit int DEFAULT 20)
RETURNS TABLE (document_id uuid, file_name text, section public.document_section, version int, page int, rank real, snippet text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (SELECT websearch_to_tsquery('english', coalesce(_q, '')) AS query),
  latest AS (
    SELECT DISTINCT ON (d.project_id, d.section, lower(d.file_name)) d.id, d.project_id, d.file_name, d.section, d.version
      FROM public.project_documents d
     WHERE (_project IS NULL OR d.project_id = _project)
       AND public.can_project_documents(d.project_id, false)
     ORDER BY d.project_id, d.section, lower(d.file_name), d.version DESC
  )
  SELECT l.id, l.file_name, l.section, l.version, p.page,
         ts_rank_cd(p.tsv, q.query)::real,
         ts_headline('english', p.text, q.query, 'MaxWords=24, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "')
    FROM q, public.document_pages p
    JOIN latest l ON l.id = p.document_id
   WHERE numnode(q.query) > 0 AND p.tsv @@ q.query
   ORDER BY ts_rank_cd(p.tsv, q.query) DESC, l.file_name, p.page
   LIMIT greatest(1, least(coalesce(_limit, 20), 100));
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.search_document_pages(uuid, text, int) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.search_document_pages(uuid, text, int) TO authenticated;
--> statement-breakpoint

-- Documents whose text has not been read yet, for the "Index remaining" button.
CREATE OR REPLACE FUNCTION public.document_text_backlog(_project uuid)
RETURNS TABLE (id uuid, file_name text, section public.document_section, mime text, size_bytes bigint, storage_path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.file_name, d.section, d.mime, d.size_bytes, d.storage_path
    FROM public.project_documents d
   WHERE d.text_status = 'pending'
     AND (_project IS NULL OR d.project_id = _project)
     AND public.can_project_documents(d.project_id, false)
   ORDER BY d.created_at DESC
   LIMIT 200;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.document_text_backlog(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.document_text_backlog(uuid) TO authenticated;
