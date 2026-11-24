CREATE TABLE IF NOT EXISTS public.scope_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL CHECK (length(btrim(term)) > 0),
  group_key text NOT NULL DEFAULT 'other',
  whole_word boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS scope_keywords_term_ci ON public.scope_keywords (lower(term));
GRANT SELECT, INSERT, UPDATE ON public.scope_keywords TO authenticated;
GRANT ALL ON public.scope_keywords TO service_role;
ALTER TABLE public.scope_keywords ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scope keywords read" ON public.scope_keywords;
CREATE POLICY "scope keywords read" ON public.scope_keywords FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "scope keywords insert" ON public.scope_keywords;
CREATE POLICY "scope keywords insert" ON public.scope_keywords FOR INSERT TO authenticated WITH CHECK (public.has_capability('manage_settings'));
DROP POLICY IF EXISTS "scope keywords update" ON public.scope_keywords;
CREATE POLICY "scope keywords update" ON public.scope_keywords FOR UPDATE TO authenticated USING (public.has_capability('manage_settings')) WITH CHECK (public.has_capability('manage_settings'));

CREATE TABLE IF NOT EXISTS public.document_scope_hits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  keyword_id uuid NOT NULL REFERENCES public.scope_keywords(id) ON DELETE CASCADE,
  page int,
  snippet text NOT NULL DEFAULT '' CHECK (length(snippet) <= 200),
  count int NOT NULL DEFAULT 1,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS document_scope_hits_unique ON public.document_scope_hits (document_id, keyword_id, page) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS document_scope_hits_project ON public.document_scope_hits (project_id, reviewed_at);
GRANT SELECT ON public.document_scope_hits TO authenticated;
GRANT UPDATE (reviewed_at, reviewed_by) ON public.document_scope_hits TO authenticated;
GRANT ALL ON public.document_scope_hits TO service_role;
ALTER TABLE public.document_scope_hits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scope hits read" ON public.document_scope_hits;
CREATE POLICY "scope hits read" ON public.document_scope_hits FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline', project_id));
DROP POLICY IF EXISTS "scope hits review" ON public.document_scope_hits;
CREATE POLICY "scope hits review" ON public.document_scope_hits FOR UPDATE TO authenticated
  USING (public.has_capability('manage_projects', project_id) OR public.has_capability('capture_items', project_id))
  WITH CHECK (public.has_capability('manage_projects', project_id) OR public.has_capability('capture_items', project_id));

CREATE TABLE IF NOT EXISTS public.scope_scan_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  backfilled_at timestamptz,
  documents int,
  hits int
);
GRANT SELECT ON public.scope_scan_state TO authenticated;
GRANT ALL ON public.scope_scan_state TO service_role;
ALTER TABLE public.scope_scan_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scope scan state read" ON public.scope_scan_state;
CREATE POLICY "scope scan state read" ON public.scope_scan_state FOR SELECT TO authenticated USING (true);
INSERT INTO public.scope_scan_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.scope_keywords (term, group_key, whole_word, sort)
SELECT v.term, v.g, v.w, v.s FROM (VALUES
 ('carpet','carpet',false,10),('carpet tile','carpet',false,11),('broadloom carpet','carpet',false,12),('carpet base','carpet',false,13),
 ('rubber base','wall_base',false,20),('wall base','wall_base',false,21),('millwork base','wall_base',false,22),('rigid wall base','wall_base',false,23),('resilient base','wall_base',false,24),('resilient wall base','wall_base',false,25),
 ('luxury vinyl tile','vinyl',false,30),('luxury vinyl plank','vinyl',false,31),('LVT','vinyl',true,32),('LVP','vinyl',true,33),('loose-lay plank','vinyl',false,34),('glue-down plank','vinyl',false,35),('vinyl click plank','vinyl',false,36),('vinyl click tile','vinyl',false,37),
 ('sheet vinyl','sheet_safety',false,40),('SV','sheet_safety',true,41),('safety floor','sheet_safety',false,42),('SF','sheet_safety',true,43),
 ('rubber tile','rubber',false,50),('rubber flooring','rubber',false,51),('gym floor','rubber',false,52),
 ('draperies','window_coverings',false,60),('window coverings','window_coverings',false,61),('roller shades','window_coverings',false,62),('blinds','window_coverings',false,63),('motorized shades','window_coverings',false,64),('motorized blinds','window_coverings',false,65),
 ('tile','tile',false,70),('wall tile','tile',false,71),('backsplash','tile',false,72),('backsplash tile','tile',false,73),('accent tile','tile',false,74),('ceramic tile','tile',false,75),('porcelain tile','tile',false,76),('quarry tile','tile',false,77),('CT','tile',true,78),('kitchen tile','tile',false,79),('entrance tile','tile',false,80),('Schluter','tile',false,81),
 ('kitchen floor','kitchen_entrance',false,90),('entrance matting','kitchen_entrance',false,91),
 ('laminate','laminate',false,100),('laminate flooring','laminate',false,101),('SPC flooring','laminate',false,102),('WPC flooring','laminate',false,103),
 ('stair nosings','stairs_transitions',false,110),('floor transitions','stairs_transitions',false,111),('warning tile','stairs_transitions',false,112),('tactile tiles','stairs_transitions',false,113),('grip tape','stairs_transitions',false,114),('stair treads','stairs_transitions',false,115),
 ('shower floor','wet_areas',false,120),('shower drain','wet_areas',false,121),('shower waterproofing','wet_areas',false,122),
 ('exterior decking','other',false,130),('DuraDeck','other',false,131),('hardwood flooring','other',false,132)
) AS v(term, g, w, s)
WHERE NOT EXISTS (SELECT 1 FROM public.scope_keywords k WHERE lower(k.term) = lower(v.term));