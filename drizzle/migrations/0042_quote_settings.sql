-- Company details, logo, footer, short terms and standard terms and conditions used on every quote. One row.
CREATE TABLE IF NOT EXISTS public.quote_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name text NOT NULL DEFAULT 'BMD Materials' CHECK (btrim(company_name) <> '' AND char_length(company_name) <= 200),
  office_address text NOT NULL DEFAULT '' CHECK (char_length(office_address) <= 500),
  mailing_address text NOT NULL DEFAULT '' CHECK (char_length(mailing_address) <= 500),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 100),
  email text NOT NULL DEFAULT '' CHECK (char_length(email) <= 320),
  website text NOT NULL DEFAULT '' CHECK (char_length(website) <= 200),
  gst_number text NOT NULL DEFAULT '' CHECK (char_length(gst_number) <= 100),
  footer_text text NOT NULL DEFAULT '' CHECK (char_length(footer_text) <= 400),
  default_notes text NOT NULL DEFAULT '' CHECK (char_length(default_notes) <= 4000),
  short_terms text[] NOT NULL DEFAULT '{}' CHECK (cardinality(short_terms) <= 20),
  terms_title text NOT NULL DEFAULT 'Terms and Conditions' CHECK (btrim(terms_title) <> '' AND char_length(terms_title) <= 120),
  terms_text text NOT NULL DEFAULT '' CHECK (char_length(terms_text) <= 40000),
  logo_data_url text CHECK (logo_data_url IS NULL OR (logo_data_url ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$' AND char_length(logo_data_url) <= 300000)),
  logo_width int CHECK (logo_width IS NULL OR logo_width BETWEEN 1 AND 10000),
  logo_height int CHECK (logo_height IS NULL OR logo_height BETWEEN 1 AND 10000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
--> statement-breakpoint
INSERT INTO public.quote_settings (id, company_name, mailing_address, email, short_terms)
VALUES (1, 'BMD Materials', 'PO Box 69031, Winnipeg RPO Tuxedo Park, MB R3P 2G9', 'office@bmdmaterials.com',
        ARRAY['Overdue accounts are charged interest at 2% per month.',
              'Workmanship is warranted for one year from completion. Materials carry their manufacturer''s warranty.',
              'Prices are in Canadian dollars. GST is shown separately.'])
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE public.quote_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.quote_settings FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.quote_settings TO authenticated;
--> statement-breakpoint
GRANT UPDATE (company_name, office_address, mailing_address, phone, email, website, gst_number, footer_text, default_notes, short_terms, terms_title, terms_text, logo_data_url, logo_width, logo_height) ON public.quote_settings TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "quote_settings read" ON public.quote_settings;
--> statement-breakpoint
CREATE POLICY "quote_settings read" ON public.quote_settings FOR SELECT TO authenticated USING (public.has_capability('view_pricing'));
--> statement-breakpoint
DROP POLICY IF EXISTS "quote_settings write" ON public.quote_settings;
--> statement-breakpoint
CREATE POLICY "quote_settings write" ON public.quote_settings FOR UPDATE TO authenticated
  USING (public.has_capability('send_quotes')) WITH CHECK (public.has_capability('send_quotes'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.quote_settings_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS quote_settings_touch ON public.quote_settings;
--> statement-breakpoint
CREATE TRIGGER quote_settings_touch BEFORE UPDATE ON public.quote_settings FOR EACH ROW EXECUTE FUNCTION public.quote_settings_touch();
--> statement-breakpoint

-- Each quote: who it is addressed to, and notes written for the client.
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS attention text CHECK (attention IS NULL OR char_length(attention) <= 200);
--> statement-breakpoint
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS client_notes text NOT NULL DEFAULT '' CHECK (char_length(client_notes) <= 4000);
--> statement-breakpoint
GRANT UPDATE (attention, client_notes) ON public.quotes TO authenticated;
--> statement-breakpoint

-- A new quote starts with the standard notes. A revision keeps what the last one had: notes, attention, what the client sees and the drawings.
CREATE OR REPLACE FUNCTION public.create_quote(_project uuid, _version_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; co int; n int; rev int; pn text; qid uuid; prev public.quotes;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to prepare quotes'; END IF;
  SELECT count(*) INTO n FROM public.estimate_versions WHERE id = ANY(_version_ids) AND project_id = _project;
  IF n = 0 OR n <> coalesce(cardinality(_version_ids), 0) THEN RAISE EXCEPTION 'Choose at least one price from this project'; END IF;
  IF (SELECT count(DISTINCT kind) FROM public.estimate_versions WHERE id = ANY(_version_ids)) > 1 THEN RAISE EXCEPTION 'A quote cannot mix estimate prices and change orders'; END IF;
  SELECT CASE WHEN kind = 'change_order' THEN 'change_order' ELSE 'quote' END, co_number INTO k, co FROM public.estimate_versions WHERE id = _version_ids[1];
  IF k = 'change_order' AND n > 1 THEN RAISE EXCEPTION 'A change order is quoted on its own'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('quotes' || _project::text));
  IF EXISTS (SELECT 1 FROM public.quotes WHERE project_id = _project AND kind = k AND co_number IS NOT DISTINCT FROM co AND status = 'accepted') THEN
    RAISE EXCEPTION 'This has already been accepted. Use a change order to adjust the contract.';
  END IF;
  SELECT id INTO qid FROM public.quotes WHERE project_id = _project AND kind = k AND co_number IS NOT DISTINCT FROM co AND status = 'draft';
  IF qid IS NOT NULL THEN
    UPDATE public.quotes SET version_ids = _version_ids WHERE id = qid;
    RETURN qid;
  END IF;
  SELECT * INTO prev FROM public.quotes WHERE project_id = _project AND kind = k AND co_number IS NOT DISTINCT FROM co ORDER BY revision DESC LIMIT 1;
  rev := coalesce(prev.revision + 1, 0);
  SELECT project_number INTO pn FROM public.projects WHERE id = _project;
  INSERT INTO public.quotes (project_id, kind, co_number, revision, number, version_ids, validity_days, presentation, inclusions, exclusions, clarifications, deposit, display, drawing_sheet_ids, attention, client_notes)
  VALUES (_project, k, co, rev,
          CASE WHEN k = 'change_order' THEN 'CO-' || co || CASE WHEN rev > 0 THEN '-R' || rev ELSE '' END ELSE 'Q-' || coalesce(pn, left(_project::text, 8)) || '-R' || rev END,
          _version_ids, coalesce(prev.validity_days, 30), coalesce(prev.presentation, 'by_section'),
          coalesce(prev.inclusions, ARRAY(SELECT body FROM public.quote_clauses WHERE kind = 'inclusion' AND is_default AND active ORDER BY sort_order)),
          coalesce(prev.exclusions, ARRAY(SELECT body FROM public.quote_clauses WHERE kind = 'exclusion' AND is_default AND active ORDER BY sort_order)),
          coalesce(prev.clarifications, ARRAY(SELECT body FROM public.quote_clauses WHERE kind = 'clarification' AND is_default AND active ORDER BY sort_order)),
          prev.deposit, prev.display, coalesce(prev.drawing_sheet_ids, '{}'), prev.attention,
          coalesce(prev.client_notes, (SELECT default_notes FROM public.quote_settings WHERE id = 1), ''))
  RETURNING id INTO qid;
  RETURN qid;
END; $$;
