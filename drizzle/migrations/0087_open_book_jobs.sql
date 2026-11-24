-- Open-book jobs (time and materials, cost plus). A job is either fixed price (billed against its accepted quote, as before)
-- or open book: billed from labour hours at an agreed rate and supplier invoices plus a markup.
-- Fixed-price jobs and their functions (create_progress_bill, set_progress_bill_status) are not changed.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'fixed';
--> statement-breakpoint
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_contract_type_check;
--> statement-breakpoint
ALTER TABLE public.projects ADD CONSTRAINT projects_contract_type_check CHECK (contract_type IN ('fixed','open_book'));
--> statement-breakpoint
-- An open-book bill is an ordinary progress bill (same numbering, issue, void, holdback and release) that also keeps
-- the labour lines and supplier invoices it was made from. Null on every fixed-price bill.
ALTER TABLE public.progress_bills ADD COLUMN IF NOT EXISTS open_book jsonb;
--> statement-breakpoint

-- The contract type can be changed by people who manage jobs, until the job has a bill.
CREATE OR REPLACE FUNCTION public.guard_contract_type() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contract_type IS NOT DISTINCT FROM OLD.contract_type THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('manage_projects') THEN RAISE EXCEPTION 'Not allowed to change the contract type'; END IF;
  IF EXISTS (SELECT 1 FROM public.progress_bills WHERE project_id = NEW.id AND status <> 'draft') THEN
    RAISE EXCEPTION 'This job has issued bills, so its contract type can no longer be changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.progress_bills WHERE project_id = NEW.id) THEN
    RAISE EXCEPTION 'Delete the draft bills on this job before changing its contract type.';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS projects_contract_type_guard ON public.projects;
--> statement-breakpoint
CREATE TRIGGER projects_contract_type_guard BEFORE UPDATE OF contract_type ON public.projects FOR EACH ROW EXECUTE FUNCTION public.guard_contract_type();
--> statement-breakpoint

-- The terms agreed for an open-book job. Markup stays empty until someone sets it: an unknown markup is not 0%.
CREATE TABLE IF NOT EXISTS public.open_book_terms (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  materials_markup_pct numeric CHECK (materials_markup_pct >= 0 AND materials_markup_pct <= 100),
  labour_rate_cents bigint CHECK (labour_rate_cents > 0),
  named_rates jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(named_rates) = 'array'),
  holdback_applies boolean NOT NULL DEFAULT true,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.open_book_terms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.open_book_terms FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.open_book_terms TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "open_book_terms read" ON public.open_book_terms;
--> statement-breakpoint
CREATE POLICY "open_book_terms read" ON public.open_book_terms FOR SELECT TO authenticated USING (public.has_capability('view_pricing'));
--> statement-breakpoint
DROP POLICY IF EXISTS "open_book_terms add" ON public.open_book_terms;
--> statement-breakpoint
CREATE POLICY "open_book_terms add" ON public.open_book_terms FOR INSERT TO authenticated WITH CHECK (public.has_capability('view_pricing') AND public.has_capability('manage_projects'));
--> statement-breakpoint
DROP POLICY IF EXISTS "open_book_terms change" ON public.open_book_terms;
--> statement-breakpoint
CREATE POLICY "open_book_terms change" ON public.open_book_terms FOR UPDATE TO authenticated
  USING (public.has_capability('view_pricing') AND public.has_capability('manage_projects')) WITH CHECK (public.has_capability('view_pricing') AND public.has_capability('manage_projects'));
--> statement-breakpoint

-- Labour to bill: a description of the work, when, hours and the rate. The amount is always hours × rate, half a cent up.
CREATE TABLE IF NOT EXISTS public.open_book_labour (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  description text NOT NULL CHECK (btrim(description) <> ''),
  work_date date NOT NULL,
  work_date_end date CHECK (work_date_end IS NULL OR work_date_end >= work_date),
  hours numeric(7,2) NOT NULL CHECK (hours > 0),
  rate_cents bigint NOT NULL CHECK (rate_cents > 0),
  rate_name text,
  amount_cents bigint GENERATED ALWAYS AS (floor(hours * rate_cents + 0.5)::bigint) STORED,
  -- Where the hours came from when they were not typed, e.g. 'time:<approved entry id>', so the same hours are not added twice.
  source_ref text UNIQUE,
  bill_id uuid REFERENCES public.progress_bills(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS open_book_labour_project_idx ON public.open_book_labour (project_id, work_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS open_book_labour_bill_idx ON public.open_book_labour (bill_id);
--> statement-breakpoint

-- Supplier invoices to bill: what the supplier charged before GST, marked up at the job's rate unless this invoice has its own.
CREATE TABLE IF NOT EXISTS public.open_book_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text NOT NULL CHECK (btrim(supplier_name) <> ''),
  invoice_number text NOT NULL CHECK (btrim(invoice_number) <> ''),
  invoice_date date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  markup_pct numeric CHECK (markup_pct >= 0 AND markup_pct <= 100),
  markup_note text,
  -- A copy of the invoice already filed in the job's Documents. No file is stored here.
  document_id uuid REFERENCES public.project_documents(id) ON DELETE SET NULL,
  bill_id uuid REFERENCES public.progress_bills(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS open_book_materials_invoice_once ON public.open_book_materials (project_id, lower(btrim(supplier_name)), lower(btrim(invoice_number)));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS open_book_materials_bill_idx ON public.open_book_materials (bill_id);
--> statement-breakpoint
ALTER TABLE public.open_book_labour ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.open_book_materials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.open_book_labour, public.open_book_materials FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_book_labour, public.open_book_materials TO authenticated;
--> statement-breakpoint
-- Read with pricing access. Add, change and remove with billing access, and only while the entry is not on a bill:
-- bill_id is set by create_open_book_bill alone, and an entry on a bill is locked.
DROP POLICY IF EXISTS "open_book_labour read" ON public.open_book_labour;
--> statement-breakpoint
CREATE POLICY "open_book_labour read" ON public.open_book_labour FOR SELECT TO authenticated USING (public.has_capability('view_pricing'));
--> statement-breakpoint
DROP POLICY IF EXISTS "open_book_labour add" ON public.open_book_labour;
--> statement-breakpoint
CREATE POLICY "open_book_labour add" ON public.open_book_labour FOR INSERT TO authenticated WITH CHECK (public.has_capability('send_quotes') AND bill_id IS NULL);
--> statement-breakpoint
DROP POLICY IF EXISTS "open_book_labour change" ON public.open_book_labour;
--> statement-breakpoint
CREATE POLICY "open_book_labour change" ON public.open_book_labour FOR UPDATE TO authenticated USING (public.has_capability('send_quotes') AND bill_id IS NULL) WITH CHECK (public.has_capability('send_quotes') AND bill_id IS NULL);
--> statement-breakpoint
DROP POLICY IF EXISTS "open_book_labour remove" ON public.open_book_labour;
--> statement-breakpoint
CREATE POLICY "open_book_labour remove" ON public.open_book_labour FOR DELETE TO authenticated USING (public.has_capability('send_quotes') AND bill_id IS NULL);
--> statement-breakpoint
DROP POLICY IF EXISTS "open_book_materials read" ON public.open_book_materials;
--> statement-breakpoint
CREATE POLICY "open_book_materials read" ON public.open_book_materials FOR SELECT TO authenticated USING (public.has_capability('view_pricing'));
--> statement-breakpoint
DROP POLICY IF EXISTS "open_book_materials add" ON public.open_book_materials;
--> statement-breakpoint
CREATE POLICY "open_book_materials add" ON public.open_book_materials FOR INSERT TO authenticated WITH CHECK (public.has_capability('send_quotes') AND bill_id IS NULL);
--> statement-breakpoint
DROP POLICY IF EXISTS "open_book_materials change" ON public.open_book_materials;
--> statement-breakpoint
CREATE POLICY "open_book_materials change" ON public.open_book_materials FOR UPDATE TO authenticated USING (public.has_capability('send_quotes') AND bill_id IS NULL) WITH CHECK (public.has_capability('send_quotes') AND bill_id IS NULL);
--> statement-breakpoint
DROP POLICY IF EXISTS "open_book_materials remove" ON public.open_book_materials;
--> statement-breakpoint
CREATE POLICY "open_book_materials remove" ON public.open_book_materials FOR DELETE TO authenticated USING (public.has_capability('send_quotes') AND bill_id IS NULL);
--> statement-breakpoint

-- An open-book job is billed from its entries only; and when one of its bills is voided, its entries can be billed again.
CREATE OR REPLACE FUNCTION public.progress_bills_open_book() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'progress' AND NEW.open_book IS NULL AND (SELECT contract_type FROM public.projects WHERE id = NEW.project_id) = 'open_book' THEN
      RAISE EXCEPTION 'This is an open-book job. Bill it from its labour and material invoices.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'void' AND OLD.status <> 'void' THEN
    UPDATE public.open_book_labour SET bill_id = NULL WHERE bill_id = NEW.id;
    UPDATE public.open_book_materials SET bill_id = NULL WHERE bill_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS progress_bills_open_book_insert ON public.progress_bills;
--> statement-breakpoint
CREATE TRIGGER progress_bills_open_book_insert BEFORE INSERT ON public.progress_bills FOR EACH ROW EXECUTE FUNCTION public.progress_bills_open_book();
--> statement-breakpoint
DROP TRIGGER IF EXISTS progress_bills_open_book_void ON public.progress_bills;
--> statement-breakpoint
CREATE TRIGGER progress_bills_open_book_void AFTER UPDATE OF status ON public.progress_bills FOR EACH ROW EXECUTE FUNCTION public.progress_bills_open_book();
--> statement-breakpoint

-- A draft bill from the ticked entries. Every figure is worked out here from the stored entries and the job's terms.
-- What is kept on the bill is only what the client is shown: no catalogue costs, margins or notes.
CREATE OR REPLACE FUNCTION public.create_open_book_bill(_project uuid, _labour uuid[], _materials uuid[], _period_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ct text; hb numeric; pn text; t public.open_book_terms; gst numeric; n int; bid uuid; nl int; nm int;
  lab jsonb; mat jsonb; lab_c bigint; mat_c bigint; mk_c bigint; gross bigint; hold bigint; net bigint; tax bigint; lines jsonb;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to prepare bills'; END IF;
  _labour := coalesce(_labour, '{}'); _materials := coalesce(_materials, '{}');
  IF cardinality(_labour) + cardinality(_materials) = 0 THEN RAISE EXCEPTION 'Tick the labour and material invoices to put on this bill.'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(_labour || _materials) x) <> cardinality(_labour) + cardinality(_materials) THEN RAISE EXCEPTION 'The same entry was picked twice.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('progress_bills' || _project::text));
  SELECT contract_type, holdback_pct, project_number INTO ct, hb, pn FROM public.projects WHERE id = _project;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF ct <> 'open_book' THEN RAISE EXCEPTION 'This is a fixed-price job. Bill it against its contract.'; END IF;
  SELECT * INTO t FROM public.open_book_terms WHERE project_id = _project;
  -- Lock the entries, and refuse any that are missing, on another job or already on a bill.
  SELECT count(*) INTO nl FROM (SELECT 1 FROM public.open_book_labour WHERE id = ANY(_labour) AND project_id = _project AND bill_id IS NULL FOR UPDATE) x;
  SELECT count(*) INTO nm FROM (SELECT 1 FROM public.open_book_materials WHERE id = ANY(_materials) AND project_id = _project AND bill_id IS NULL FOR UPDATE) x;
  IF nl <> cardinality(_labour) OR nm <> cardinality(_materials) THEN RAISE EXCEPTION 'One of these entries is already on a bill. Refresh and pick again.'; END IF;
  IF EXISTS (SELECT 1 FROM public.open_book_materials WHERE id = ANY(_materials) AND markup_pct IS NULL) AND t.materials_markup_pct IS NULL THEN
    RAISE EXCEPTION 'Set the materials markup for this job before billing materials.';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('description', description, 'dateFrom', work_date, 'dateTo', work_date_end, 'hours', hours, 'rateCents', rate_cents, 'amountCents', amount_cents) ORDER BY work_date, created_at), '[]'),
         coalesce(sum(amount_cents), 0)
    INTO lab, lab_c FROM public.open_book_labour WHERE id = ANY(_labour);
  SELECT coalesce(jsonb_agg(jsonb_build_object('supplier', m.supplier_name, 'invoiceNumber', m.invoice_number, 'invoiceDate', m.invoice_date, 'invoiceCents', m.amount_cents,
           'markupPct', m.pct, 'markupCents', m.mk, 'totalCents', m.amount_cents + m.mk, 'attachmentName', m.file_name) ORDER BY m.invoice_date, m.created_at), '[]'),
         coalesce(sum(m.amount_cents), 0), coalesce(sum(m.mk), 0)
    INTO mat, mat_c, mk_c
    FROM (SELECT i.*, coalesce(i.markup_pct, t.materials_markup_pct) AS pct, floor(i.amount_cents * coalesce(i.markup_pct, t.materials_markup_pct) / 100.0 + 0.5)::bigint AS mk,
                 (SELECT d.file_name FROM public.project_documents d WHERE d.id = i.document_id) AS file_name
            FROM public.open_book_materials i WHERE i.id = ANY(_materials)) m;
  gross := lab_c + mat_c + mk_c;
  IF NOT coalesce(t.holdback_applies, true) THEN hb := 0; END IF;
  SELECT gst_pct INTO gst FROM public.tax_settings WHERE id = 1;
  hold := round(gross * hb / 100.0);
  net := gross - hold;
  tax := round(net * coalesce(gst, 5) / 100.0);
  -- The roll-up a person types into QuickBooks: labour, materials at invoice, and the markup.
  SELECT jsonb_agg(jsonb_build_object('description', d, 'amountCents', c) ORDER BY o) INTO lines
    FROM (VALUES (1, 'Labour', lab_c), (2, 'Materials', mat_c), (3, 'Markup on materials', mk_c)) v(o, d, c) WHERE c > 0;
  SELECT coalesce(max(seq), 0) + 1 INTO n FROM public.progress_bills WHERE project_id = _project;
  INSERT INTO public.progress_bills (project_id, seq, number, kind, period_note, lines, gross_cents, holdback_pct, holdback_cents, net_cents, gst_cents, total_cents, open_book)
  VALUES (_project, n, coalesce(pn || '-', '') || 'B' || lpad(n::text, 2, '0'), 'progress', nullif(btrim(coalesce(_period_note, '')), ''), lines, gross, hb, hold, net, tax, net + tax,
          jsonb_build_object('labour', lab, 'materials', mat, 'labourCents', lab_c, 'materialsCents', mat_c, 'markupCents', mk_c))
  RETURNING id INTO bid;
  UPDATE public.open_book_labour SET bill_id = bid WHERE id = ANY(_labour);
  UPDATE public.open_book_materials SET bill_id = bid WHERE id = ANY(_materials);
  RETURN bid;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_open_book_bill(uuid, uuid[], uuid[], text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_open_book_bill(uuid, uuid[], uuid[], text) TO authenticated;
--> statement-breakpoint

-- Approved hours from the time clock, when there is one. The time clock is a separate piece of work: when it provides
--   public.approved_hours_for_job(_project uuid) RETURNS TABLE (id uuid, person_name text, work_date date, hours numeric, approved boolean)
-- (hours already rounded), this returns the approved rows not yet added to this job's labour. Until then it returns NULL
-- and the screen hides "Add from approved hours".
CREATE OR REPLACE FUNCTION public.open_book_approved_hours(_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE out jsonb;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF to_regprocedure('public.approved_hours_for_job(uuid)') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'person', h.person_name, 'date', h.work_date, 'hours', h.hours) ORDER BY h.work_date, h.person_name), '[]')
               FROM public.approved_hours_for_job($1) h
              WHERE h.approved AND h.hours > 0 AND NOT EXISTS (SELECT 1 FROM public.open_book_labour l WHERE l.source_ref = 'time:' || h.id::text)$q$ INTO out USING _project;
  RETURN out;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.open_book_approved_hours(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.open_book_approved_hours(uuid) TO authenticated;
--> statement-breakpoint

-- Billed to date for each open-book job (before holdback and GST), for the job lists. Pricing access only.
CREATE OR REPLACE FUNCTION public.open_book_jobs()
RETURNS TABLE (project_id uuid, billed_cents bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, CASE WHEN public.has_capability('view_pricing')
                    THEN coalesce((SELECT sum(b.gross_cents) FROM public.progress_bills b WHERE b.project_id = p.id AND b.kind = 'progress' AND b.status <> 'void'), 0)::bigint END
    FROM public.projects p
   WHERE p.contract_type = 'open_book' AND (public.has_capability('view_pipeline') OR public.is_project_member(p.id));
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.open_book_jobs() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.open_book_jobs() TO authenticated;
