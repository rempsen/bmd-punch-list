CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.catalogue_materials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, category text, cost_uom text, unit_cost_cents integer, purchase_uom text, coverage_per_purchase_unit numeric, coverage_uom text, updated_at timestamptz);
CREATE TABLE public.labour_rates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, uom text, unit_cost_cents integer);
CREATE TABLE public.assembly_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, category text, driver_uom text);
CREATE TABLE public.assembly_template_components(template_id uuid, labour_rate_id uuid, cost_uom text);
CREATE TABLE public.estimate_lines(driver_uom text);
CREATE TABLE public.sync_log(direction text, system text, kind text, bmd_id text, label text, outcome text, detail jsonb);
INSERT INTO public.catalogue_materials(name,category,cost_uom,unit_cost_cents,purchase_uom) VALUES
('Broadloom priced','carpet_broadloom','SF',390,'SF'),
('Broadloom unknown','carpet_broadloom','SF',NULL,'SF'),
('Broadloom already SY','carpet_broadloom','SY',3510,'SY'),
('Carpet tile','carpet_tile','SF',400,'SF');
INSERT INTO public.labour_rates(name,uom,unit_cost_cents) VALUES ('Broadloom install','SF',100);
INSERT INTO public.assembly_templates(name,category,driver_uom) VALUES ('Broadloom assembly','carpet_broadloom','SF');