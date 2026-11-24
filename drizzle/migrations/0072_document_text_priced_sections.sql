-- Document text follows the same rule as the documents themselves: "Quotes sent" and "Contract" hold BMD's prices,
-- so their page text is hidden from people without pricing access (0039's restrictive policy on project_documents
-- did not reach document_pages or search_document_pages, which read with the definer's rights).
DROP POLICY IF EXISTS "document pages read" ON public.document_pages;
--> statement-breakpoint
CREATE POLICY "document pages read" ON public.document_pages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.project_documents d WHERE d.id = document_id AND public.can_project_documents(d.project_id, false)
                 AND (d.section NOT IN ('quotes_sent','contract') OR public.has_capability('view_pricing'))));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.search_document_pages(_project uuid, _q text, _limit int DEFAULT 20)
RETURNS TABLE (document_id uuid, file_name text, section public.document_section, version int, page int, rank real, snippet text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (SELECT websearch_to_tsquery('english', coalesce(_q, '')) AS query),
  latest AS (
    SELECT DISTINCT ON (d.project_id, d.section, lower(d.file_name)) d.id, d.project_id, d.file_name, d.section, d.version
      FROM public.project_documents d
     WHERE (_project IS NULL OR d.project_id = _project)
       AND public.can_project_documents(d.project_id, false)
       AND (d.section NOT IN ('quotes_sent','contract') OR public.has_capability('view_pricing'))
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
