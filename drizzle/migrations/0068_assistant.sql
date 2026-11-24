-- The assistant (stage 6 of the takeoff/assistant design): a chat for BMD staff that answers from read-only lookups
-- run as the person asking. This migration adds the conversation record, the shared Knowledge section (memories and
-- uploaded files, each "all staff" or "pricing staff only"), the company's hours and business number, and the
-- read-only helpers the lookups use. "BMD staff" throughout means has_capability('view_pipeline'), the same test
-- bmd_staff() uses: trades, clients and viewers are never offered the assistant.
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------------------------------------------
-- Company details: hours and business number beside the details already kept for quotes.
ALTER TABLE public.quote_settings ADD COLUMN IF NOT EXISTS hours text NOT NULL DEFAULT '' CHECK (char_length(hours) <= 400);
--> statement-breakpoint
ALTER TABLE public.quote_settings ADD COLUMN IF NOT EXISTS business_number text NOT NULL DEFAULT '' CHECK (char_length(business_number) <= 100);
--> statement-breakpoint
GRANT UPDATE (hours, business_number) ON public.quote_settings TO authenticated;
--> statement-breakpoint

-- Company details for any BMD staff member (quote_settings itself is readable only with pricing access).
CREATE OR REPLACE FUNCTION public.company_details()
RETURNS TABLE (company_name text, office_address text, mailing_address text, phone text, email text, website text, gst_number text, business_number text, hours text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('view_pipeline') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  SELECT s.company_name, s.office_address, s.mailing_address, s.phone, s.email, s.website, s.gst_number, s.business_number, s.hours
    FROM public.quote_settings s WHERE s.id = 1;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.company_details() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.company_details() TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- Conversations: one per person per thread, with every lookup the assistant made so a wrong answer can be traced.
CREATE TABLE IF NOT EXISTS public.assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_conversations_user_idx ON public.assistant_conversations (user_id, updated_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.assistant_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL CHECK (char_length(content) <= 40000),
  -- The lookups made to answer: [{name, args}] (names and arguments only, never the results).
  lookups jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_messages_conversation_idx ON public.assistant_messages (conversation_id, created_at);
--> statement-breakpoint
ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.assistant_conversations FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON public.assistant_messages FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_conversations TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.assistant_messages TO authenticated;
--> statement-breakpoint
-- A person sees and writes only their own conversations, and only while they are BMD staff.
DROP POLICY IF EXISTS "assistant conversations own" ON public.assistant_conversations;
--> statement-breakpoint
CREATE POLICY "assistant conversations own" ON public.assistant_conversations FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.has_capability('view_pipeline'))
  WITH CHECK (user_id = auth.uid() AND public.has_capability('view_pipeline'));
--> statement-breakpoint
DROP POLICY IF EXISTS "assistant messages own" ON public.assistant_messages;
--> statement-breakpoint
CREATE POLICY "assistant messages own" ON public.assistant_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assistant_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()) AND public.has_capability('view_pipeline'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.assistant_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()) AND public.has_capability('view_pipeline'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- Knowledge: facts BMD keeps for the assistant across every project. Memories are short written notes; files are
-- uploaded documents whose page text is read into knowledge_pages (the same page-text approach as project documents,
-- kept in its own table because a knowledge file belongs to no project). Each item is for all staff or pricing staff only.
CREATE TABLE IF NOT EXISTS public.knowledge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('memory','file')),
  title text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 300),
  body text CHECK (body IS NULL OR char_length(body) <= 8000),
  folder text CHECK (folder IS NULL OR char_length(folder) <= 120),
  file_name text CHECK (file_name IS NULL OR char_length(file_name) <= 300),
  storage_path text UNIQUE,
  mime text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
  text_status text NOT NULL DEFAULT 'pending' CHECK (text_status IN ('pending','done','no_text','failed')),
  text_pages int,
  visibility text NOT NULL DEFAULT 'all_staff' CHECK (visibility IN ('all_staff','pricing_only')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'memory' AND body IS NOT NULL) OR (kind = 'file' AND file_name IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.knowledge_pages (
  item_id uuid NOT NULL REFERENCES public.knowledge_items(id) ON DELETE CASCADE,
  page int NOT NULL CHECK (page > 0),
  text text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  PRIMARY KEY (item_id, page)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_pages_tsv_idx ON public.knowledge_pages USING GIN (tsv);
--> statement-breakpoint
-- Memories are searched on their title and text too.
ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || coalesce(folder, ''))) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_items_tsv_idx ON public.knowledge_items USING GIN (tsv);
--> statement-breakpoint

-- Who may read a knowledge item: BMD staff for "all staff", pricing staff for "pricing staff only".
CREATE OR REPLACE FUNCTION public.can_read_knowledge(_visibility text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_capability('view_pipeline') AND (_visibility = 'all_staff' OR public.has_capability('view_pricing'));
$$;
--> statement-breakpoint
-- Who may add, change or remove knowledge: managers and admins (manage_settings), and only at a visibility they can read.
CREATE OR REPLACE FUNCTION public.can_write_knowledge(_visibility text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_capability('manage_settings') AND public.can_read_knowledge(_visibility);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.can_read_knowledge(text) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.can_write_knowledge(text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.can_read_knowledge(text) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.can_write_knowledge(text) TO authenticated;
--> statement-breakpoint
ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.knowledge_pages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.knowledge_items FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON public.knowledge_pages FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_items TO authenticated;
--> statement-breakpoint
GRANT SELECT ON public.knowledge_pages TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "knowledge read" ON public.knowledge_items;
--> statement-breakpoint
CREATE POLICY "knowledge read" ON public.knowledge_items FOR SELECT TO authenticated USING (public.can_read_knowledge(visibility));
--> statement-breakpoint
DROP POLICY IF EXISTS "knowledge insert" ON public.knowledge_items;
--> statement-breakpoint
CREATE POLICY "knowledge insert" ON public.knowledge_items FOR INSERT TO authenticated WITH CHECK (public.can_write_knowledge(visibility));
--> statement-breakpoint
DROP POLICY IF EXISTS "knowledge update" ON public.knowledge_items;
--> statement-breakpoint
CREATE POLICY "knowledge update" ON public.knowledge_items FOR UPDATE TO authenticated
  USING (public.can_write_knowledge(visibility)) WITH CHECK (public.can_write_knowledge(visibility));
--> statement-breakpoint
DROP POLICY IF EXISTS "knowledge delete" ON public.knowledge_items;
--> statement-breakpoint
CREATE POLICY "knowledge delete" ON public.knowledge_items FOR DELETE TO authenticated USING (public.can_write_knowledge(visibility));
--> statement-breakpoint
-- Page text is readable exactly when its item is. No browser writes (a server function stores pages).
DROP POLICY IF EXISTS "knowledge pages read" ON public.knowledge_pages;
--> statement-breakpoint
CREATE POLICY "knowledge pages read" ON public.knowledge_pages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.knowledge_items k WHERE k.id = item_id AND public.can_read_knowledge(k.visibility)));
--> statement-breakpoint

-- Knowledge files live in their own private bucket. Path: knowledge/{item_id}/{filename}
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('knowledge', 'knowledge', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.knowledge_path_item(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  RETURN split_part(_name, '/', 1)::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END; $$;
--> statement-breakpoint
DROP POLICY IF EXISTS "knowledge files readable" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "knowledge files readable" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'knowledge' AND EXISTS (SELECT 1 FROM public.knowledge_items k WHERE k.id = public.knowledge_path_item(name) AND public.can_read_knowledge(k.visibility)));
--> statement-breakpoint
DROP POLICY IF EXISTS "knowledge files uploadable" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "knowledge files uploadable" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'knowledge' AND EXISTS (SELECT 1 FROM public.knowledge_items k WHERE k.id = public.knowledge_path_item(name) AND public.can_write_knowledge(k.visibility)));
--> statement-breakpoint
DROP POLICY IF EXISTS "knowledge files deletable" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "knowledge files deletable" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'knowledge' AND EXISTS (SELECT 1 FROM public.knowledge_items k WHERE k.id = public.knowledge_path_item(name) AND public.can_write_knowledge(k.visibility)));
--> statement-breakpoint

-- Search Knowledge: memories and file pages together, best match first. Web-search syntax, as for documents.
CREATE OR REPLACE FUNCTION public.search_knowledge(_q text, _limit int DEFAULT 20)
RETURNS TABLE (item_id uuid, kind text, title text, folder text, file_name text, visibility text, page int, rank real, snippet text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (SELECT websearch_to_tsquery('english', coalesce(_q, '')) AS query),
  hits AS (
    SELECT k.id, k.kind, k.title, k.folder, k.file_name, k.visibility, NULL::int AS page,
           ts_rank_cd(k.tsv, q.query)::real AS rank,
           ts_headline('english', coalesce(k.body, k.title), q.query, 'MaxWords=40, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "') AS snippet
      FROM q, public.knowledge_items k
     WHERE k.kind = 'memory' AND numnode(q.query) > 0 AND k.tsv @@ q.query AND public.can_read_knowledge(k.visibility)
    UNION ALL
    SELECT k.id, k.kind, k.title, k.folder, k.file_name, k.visibility, p.page,
           ts_rank_cd(p.tsv, q.query)::real,
           ts_headline('english', p.text, q.query, 'MaxWords=24, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "')
      FROM q, public.knowledge_pages p JOIN public.knowledge_items k ON k.id = p.item_id
     WHERE numnode(q.query) > 0 AND p.tsv @@ q.query AND public.can_read_knowledge(k.visibility)
  )
  SELECT * FROM hits ORDER BY rank DESC, title, page LIMIT greatest(1, least(coalesce(_limit, 20), 100));
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.search_knowledge(text, int) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.search_knowledge(text, int) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';

-- Document text (0064) must keep the pricing rule of 0039: pages of quotes-sent and contract documents are for pricing staff only.
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
--> statement-breakpoint

-- Catalogue names for staff without pricing access (the tables themselves are readable only with view_pricing): no cost columns.
CREATE OR REPLACE FUNCTION public.search_catalogue_names(_q text, _limit int DEFAULT 25)
RETURNS TABLE (kind text, id uuid, name text, category text, manufacturer text, product_line text, sku text, colour text, cost_code text, purchase_uom text, cost_uom text, coverage_per_purchase_unit numeric, coverage_uom text, uom text, pst_applies boolean, active boolean, supplier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM (
    SELECT 'material'::text AS kind, m.id, m.name, m.category, m.manufacturer, m.product_line, m.sku, m.colour, m.cost_code, m.purchase_uom, m.cost_uom, m.coverage_per_purchase_unit, m.coverage_uom, NULL::text AS uom, m.pst_applies, m.active, s.name AS supplier
      FROM public.catalogue_materials m LEFT JOIN public.suppliers s ON s.id = m.supplier_id
     WHERE public.has_capability('view_pipeline')
       AND (m.name ILIKE '%' || _q || '%' OR m.manufacturer ILIKE '%' || _q || '%' OR m.product_line ILIKE '%' || _q || '%' OR m.sku ILIKE '%' || _q || '%' OR m.cost_code ILIKE '%' || _q || '%' OR m.category ILIKE '%' || _q || '%')
    UNION ALL
    SELECT 'labour'::text, l.id, l.name, NULL, NULL, NULL, NULL, NULL, l.cost_code, NULL, NULL, NULL, NULL, l.uom, NULL, l.active, NULL
      FROM public.labour_rates l
     WHERE public.has_capability('view_pipeline') AND (l.name ILIKE '%' || _q || '%' OR l.cost_code ILIKE '%' || _q || '%')
  ) x ORDER BY kind, name LIMIT greatest(1, least(coalesce(_limit, 25), 100));
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.search_catalogue_names(text, int) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.search_catalogue_names(text, int) TO authenticated;
