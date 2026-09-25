ALTER TABLE public.deficiencies ADD COLUMN needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.deficiencies ADD COLUMN source text;
GRANT SELECT (needs_review, source) ON public.deficiencies TO authenticated;
GRANT UPDATE (needs_review) ON public.deficiencies TO authenticated;

CREATE TABLE public.intake_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  rules text NOT NULL DEFAULT '',
  cursor_at timestamptz,
  created_by_user uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.intake_settings TO authenticated;
GRANT ALL ON public.intake_settings TO service_role;
ALTER TABLE public.intake_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intake settings managers" ON public.intake_settings FOR ALL TO authenticated
  USING (public.has_capability('manage_settings')) WITH CHECK (public.has_capability('manage_settings'));

INSERT INTO public.intake_settings (id, default_project_id, created_by_user, cursor_at)
VALUES (1, 'df70313a-cf23-4ab6-916f-edb50a5bf35e', 'bf95c5e1-87e8-4bc5-964d-f684d311ff17', now());

CREATE TABLE public.email_intake (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text NOT NULL UNIQUE,
  from_name text, from_email text, subject text, body_text text,
  received_at timestamptz,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  deficiency_id uuid REFERENCES public.deficiencies(id) ON DELETE SET NULL,
  ai_json jsonb, confidence jsonb,
  status text NOT NULL DEFAULT 'parsed',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.email_intake TO authenticated;
GRANT ALL ON public.email_intake TO service_role;
ALTER TABLE public.email_intake ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intake read" ON public.email_intake FOR SELECT TO authenticated
  USING (public.has_capability('manage_settings'));
CREATE POLICY "intake update" ON public.email_intake FOR UPDATE TO authenticated
  USING (public.has_capability('manage_settings')) WITH CHECK (public.has_capability('manage_settings'));

CREATE TABLE public.intake_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_intake_id uuid REFERENCES public.email_intake(id) ON DELETE CASCADE,
  email_text text NOT NULL,
  corrected jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intake_examples TO authenticated;
GRANT ALL ON public.intake_examples TO service_role;
ALTER TABLE public.intake_examples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "examples managers" ON public.intake_examples FOR ALL TO authenticated
  USING (public.has_capability('manage_settings')) WITH CHECK (public.has_capability('manage_settings'));