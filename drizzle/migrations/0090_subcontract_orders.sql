-- Subcontractor purchase orders: the labour a work order covers (its lines) becomes a purchase order to the
-- subcontractor, sent to QuickBooks; the bill QuickBooks raises against it, and its payment, are read back.
-- install_visit_lines is created by the work-order-lines change too (same columns); whichever lands first wins.

CREATE TABLE IF NOT EXISTS public.install_visit_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.install_visits(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  estimate_line_id uuid REFERENCES public.estimate_lines(id) ON DELETE SET NULL,
  finish_id uuid REFERENCES public.project_finishes(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  uom text NOT NULL DEFAULT 'SF',
  cost_code text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS install_visit_lines_visit_idx ON public.install_visit_lines (visit_id, sort_order);
--> statement-breakpoint
ALTER TABLE public.install_visit_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'install_visit_lines' AND policyname = 'visit lines read') THEN
    CREATE POLICY "visit lines read" ON public.install_visit_lines FOR SELECT TO authenticated USING (public.has_capability('view_pipeline'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'install_visit_lines' AND policyname = 'visit lines write') THEN
    CREATE POLICY "visit lines write" ON public.install_visit_lines FOR ALL TO authenticated
      USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.subcontract_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  visit_id uuid REFERENCES public.install_visits(id) ON DELETE SET NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  po_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','billed','paid','cancelled')),
  subtotal_cents bigint NOT NULL DEFAULT 0,
  notes text,
  qbo_po_id text,
  qbo_po_sent_at timestamptz,
  qbo_bill_id text,
  qbo_bill_total_cents bigint,
  billed_at timestamptz,
  paid_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subcontract_orders_project_idx ON public.subcontract_orders (project_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS subcontract_orders_po_number_key ON public.subcontract_orders (po_number);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.subcontract_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.subcontract_orders(id) ON DELETE CASCADE,
  visit_line_id uuid REFERENCES public.install_visit_lines(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  uom text NOT NULL DEFAULT 'SF',
  unit_cost_cents bigint CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  cost_code text,
  sort_order int NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subcontract_order_lines_order_idx ON public.subcontract_order_lines (order_id, sort_order);
--> statement-breakpoint
ALTER TABLE public.subcontract_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.subcontract_order_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "subcontract orders read" ON public.subcontract_orders FOR SELECT TO authenticated USING (public.has_capability('view_pipeline'));
--> statement-breakpoint
CREATE POLICY "subcontract orders write" ON public.subcontract_orders FOR ALL TO authenticated
  USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
--> statement-breakpoint
-- Lines carry unit costs: pricing staff only, like estimate costs. Everyone else sees the order's status on the work order.
CREATE POLICY "subcontract order lines read" ON public.subcontract_order_lines FOR SELECT TO authenticated USING (public.has_capability('view_pricing'));
--> statement-breakpoint
CREATE POLICY "subcontract order lines write" ON public.subcontract_order_lines FOR ALL TO authenticated
  USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.subcontract_orders_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS subcontract_orders_touch ON public.subcontract_orders;
--> statement-breakpoint
CREATE TRIGGER subcontract_orders_touch BEFORE UPDATE ON public.subcontract_orders FOR EACH ROW EXECUTE FUNCTION public.subcontract_orders_touch();
