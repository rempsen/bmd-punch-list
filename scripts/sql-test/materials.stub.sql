-- Estimate, quote and catalogue tables the materials migrations read, with only the columns they use.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'opportunity';
CREATE TABLE public.suppliers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE public.catalogue_materials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, colour text, supplier_id uuid REFERENCES public.suppliers(id));
CREATE TABLE public.estimate_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id), kind text NOT NULL DEFAULT 'estimate', is_base boolean NOT NULL DEFAULT false);
CREATE TABLE public.estimate_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES public.estimate_versions(id), description text NOT NULL DEFAULT '', driver_qty numeric, driver_uom text, selection text DEFAULT 'required');
CREATE TABLE public.estimate_line_components (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), line_id uuid NOT NULL REFERENCES public.estimate_lines(id), kind text NOT NULL, label text NOT NULL DEFAULT '',
  catalogue_material_id uuid REFERENCES public.catalogue_materials(id), unit_cost_cents bigint, cost_uom text NOT NULL DEFAULT 'EA', purchase_uom text NOT NULL DEFAULT 'EA',
  coverage_per_purchase_unit numeric, qty_per_driver numeric NOT NULL DEFAULT 1, waste_pct numeric NOT NULL DEFAULT 0, round_up boolean NOT NULL DEFAULT false, not_applicable boolean NOT NULL DEFAULT false);
CREATE TABLE public.quotes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id), kind text NOT NULL DEFAULT 'quote', status text NOT NULL DEFAULT 'draft',
  accepted_at timestamptz, accepted_version_id uuid REFERENCES public.estimate_versions(id));
