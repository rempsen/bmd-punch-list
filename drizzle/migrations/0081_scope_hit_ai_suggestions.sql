ALTER TABLE public.document_scope_hits ADD COLUMN IF NOT EXISTS ai_verdict text CHECK (ai_verdict IN ('in_scope','not_scope','unclear'));
ALTER TABLE public.document_scope_hits ADD COLUMN IF NOT EXISTS ai_suggestion text CHECK (length(ai_suggestion) <= 500);
ALTER TABLE public.document_scope_hits ADD COLUMN IF NOT EXISTS ai_model text;
ALTER TABLE public.document_scope_hits ADD COLUMN IF NOT EXISTS ai_at timestamptz;