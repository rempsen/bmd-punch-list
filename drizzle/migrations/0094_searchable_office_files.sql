ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS text_error text;
ALTER TABLE public.project_documents ADD COLUMN IF NOT EXISTS text_error text;
ALTER TABLE public.knowledge_pages ADD COLUMN IF NOT EXISTS page_label text;
ALTER TABLE public.document_pages ADD COLUMN IF NOT EXISTS page_label text;
GRANT SELECT (text_error) ON public.knowledge_items TO authenticated;
GRANT SELECT (text_error) ON public.project_documents TO authenticated;
GRANT SELECT (page_label) ON public.knowledge_pages TO authenticated;
GRANT SELECT (page_label) ON public.document_pages TO authenticated;
NOTIFY pgrst, 'reload schema';