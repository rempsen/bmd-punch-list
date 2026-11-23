-- Marked-up drawings on quotes now come from the project's takeoff (the takeoff workspace's document).
-- quotes.drawing_sheets holds the chosen sheets as the takeoff names them ("Plans.pdf#4").
-- takeoff_sheet_labels remembers the sheet number the takeoff screen read from each title block ("A-101"),
-- so the quote can name its drawings without opening the PDF.
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS drawing_sheets text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
GRANT UPDATE (drawing_sheets) ON public.quotes TO authenticated;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.takeoff_sheet_labels (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sheet_key text NOT NULL CHECK (length(sheet_key) BETWEEN 3 AND 400),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, sheet_key)
);
--> statement-breakpoint
ALTER TABLE public.takeoff_sheet_labels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.takeoff_sheet_labels FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.takeoff_sheet_labels TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "takeoff_sheet_labels read" ON public.takeoff_sheet_labels;
--> statement-breakpoint
CREATE POLICY "takeoff_sheet_labels read" ON public.takeoff_sheet_labels FOR SELECT TO authenticated
  USING (public.can_project_documents(project_id, false) OR public.has_capability('manage_estimates'));
--> statement-breakpoint
DROP POLICY IF EXISTS "takeoff_sheet_labels add" ON public.takeoff_sheet_labels;
--> statement-breakpoint
CREATE POLICY "takeoff_sheet_labels add" ON public.takeoff_sheet_labels FOR INSERT TO authenticated
  WITH CHECK (public.has_capability('manage_estimates') AND public.can_project_documents(project_id, false));
--> statement-breakpoint
DROP POLICY IF EXISTS "takeoff_sheet_labels change" ON public.takeoff_sheet_labels;
--> statement-breakpoint
CREATE POLICY "takeoff_sheet_labels change" ON public.takeoff_sheet_labels FOR UPDATE TO authenticated
  USING (public.has_capability('manage_estimates') AND public.can_project_documents(project_id, false))
  WITH CHECK (public.has_capability('manage_estimates') AND public.can_project_documents(project_id, false));
--> statement-breakpoint
-- A new revision of a quote carries the chosen drawings forward, as it does the other choices.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.create_quote(uuid, uuid[])'::regprocedure) INTO def;
  IF position('drawing_sheets' in def) = 0 THEN
    def := replace(def, 'display, drawing_sheet_ids, attention', 'display, drawing_sheet_ids, drawing_sheets, attention');
    def := replace(def, 'coalesce(prev.drawing_sheet_ids, ''{}''), prev.attention', 'coalesce(prev.drawing_sheet_ids, ''{}''), coalesce(prev.drawing_sheets, ''{}''), prev.attention');
    IF position('drawing_sheets, attention' in def) = 0 OR position('prev.drawing_sheets' in def) = 0 THEN
      RAISE EXCEPTION 'create_quote is not in the expected form; drawing_sheets was not added';
    END IF;
    EXECUTE def;
  END IF;
END $$;
