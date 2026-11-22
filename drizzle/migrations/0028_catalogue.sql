-- BMD Projects: catalogue (suppliers, materials, labour rates, supply-and-install assemblies), cost codes and tax rates.
-- Pricing data: readable only with view_pricing, changeable only with manage_catalogue. Idempotent.
-- A null unit cost means the price is not known yet. It is never treated as zero.

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  contact_name text, email text, phone text, account_number text, notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_key ON public.suppliers (lower(btrim(name)));
--> statement-breakpoint

-- Cost codes mirror the service items in BMD's QuickBooks (01 Flooring, 02 Window Coverings, 03 General Conditions, 04 Markup and Contingency).
CREATE TABLE IF NOT EXISTS public.cost_codes (
  code text PRIMARY KEY,
  name text NOT NULL,
  qbo_item_id text,
  sort_order int NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO public.cost_codes (code, name, qbo_item_id, sort_order) VALUES
  ('01-01','Carpet Tile','129',1),
  ('01-02','Carpet Broadloom','130',2),
  ('01-03','Carpet Base','131',3),
  ('01-04','LVT','132',4),
  ('01-05','LVP','133',5),
  ('01-06','PVC Rolls','134',6),
  ('01-07','Rubber Tile','135',7),
  ('01-08','Rubber Rolls','136',8),
  ('01-09','Wall Tile','137',9),
  ('01-10','Floor Tile','138',10),
  ('01-11','Tile Accessories','139',11),
  ('01-12','Moldings','140',12),
  ('01-13','Transitions','141',13),
  ('01-14','Rubber Base','142',14),
  ('01-15','Millwork Base','143',15),
  ('01-16','Vinyl Decking + Accessories','144',16),
  ('01-17','Adhesive','145',17),
  ('01-18','Prep','146',18),
  ('01-19','Patch','147',19),
  ('01-20','Removal','148',20),
  ('01-21','Disposal','149',21),
  ('01-22','Leveling','150',22),
  ('01-23','Nosings','151',23),
  ('01-24','Safety Floor','152',24),
  ('01-25','Tactile Warning Tile','153',25),
  ('01-26','Install Flooring','154',26),
  ('01-27','Install Tile','155',27),
  ('01-28','Install Decking','156',28),
  ('01-29','Welding','157',29),
  ('01-30','Coving','158',30),
  ('01-31','Motar','164',31),
  ('01-32','Grout','165',32),
  ('01-33','Sealer','166',33),
  ('01-34','Tactile Tabs','167',34),
  ('02-100','Roller Shades','101',35),
  ('02-200','Cellular Shades','102',36),
  ('02-300','Motorized Shades','104',37),
  ('02-400','Drapery','108',38),
  ('02-500','Uphostery','106',39),
  ('02-600','Install Window Coverings','103',40),
  ('02-700','Check Measure','105',41),
  ('02-800','Hardware','110',42),
  ('02-900','Fabric','107',43),
  ('02-1000','Work Room Cost','109',44),
  ('02-1100','Repair','159',45),
  ('02-1200','Sorting','160',46),
  ('02-1300','Faux Wood','161',47),
  ('02-1400','Banded Shades','162',48),
  ('02-1500','Window Covering Accessories','163',49),
  ('03-000','General','112',50),
  ('03-050','Delivery','113',51),
  ('03-100','Tipping','114',52),
  ('03-150','Supervisor Fee','115',53),
  ('03-200','Hotel','116',54),
  ('03-250','Per Diem','117',55),
  ('03-300','Travel','118',56),
  ('03-350','Abatement','119',57),
  ('03-400','Hoisting','121',58),
  ('03-450','Staging','120',59),
  ('03-500','Storage','122',60),
  ('03-550','Equipment','123',61),
  ('03-600','Design Cost','168',62),
  ('03-650','Consulting Cost','169',63),
  ('04-010','Contingency','125',64),
  ('04-020','Insurance','126',65),
  ('04-030','Bond','127',66),
  ('04-040','Profit','128',67)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.catalogue_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('carpet_broadloom','carpet_tile','lvp','lvt','sheet_vinyl','rubber','floor_tile','wall_tile','wall_base','transitions','adhesive','underlay','prep','window_coverings','other')),
  name text NOT NULL CHECK (btrim(name) <> ''),
  manufacturer text, product_line text, colour text, sku text,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  cost_uom text NOT NULL DEFAULT 'SF' CHECK (cost_uom IN ('SF','SY','LF','EA','carton','roll','pail','hour','LS')),
  unit_cost_cents bigint CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  purchase_uom text NOT NULL DEFAULT 'SF' CHECK (purchase_uom IN ('SF','SY','LF','EA','carton','roll','pail','hour','LS')),
  coverage_per_purchase_unit numeric CHECK (coverage_per_purchase_unit IS NULL OR coverage_per_purchase_unit > 0),
  pst_applies boolean NOT NULL DEFAULT true,
  default_waste_pct numeric NOT NULL DEFAULT 0 CHECK (default_waste_pct >= 0 AND default_waste_pct <= 100),
  cost_code text REFERENCES public.cost_codes(code),
  active boolean NOT NULL DEFAULT true,
  price_date date, price_source text, notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS catalogue_materials_category_idx ON public.catalogue_materials (category, name);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.labour_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  uom text NOT NULL DEFAULT 'SF' CHECK (uom IN ('SF','SY','LF','EA','carton','roll','pail','hour','LS')),
  unit_cost_cents bigint CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  cost_code text REFERENCES public.cost_codes(code),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS labour_rates_name_key ON public.labour_rates (lower(btrim(name)));
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.assembly_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('carpet_broadloom','carpet_tile','lvp','lvt','sheet_vinyl','rubber','floor_tile','wall_tile','wall_base','transitions','adhesive','underlay','prep','window_coverings','other')),
  driver_uom text NOT NULL DEFAULT 'SF' CHECK (driver_uom IN ('SF','SY','LF','EA','carton','roll','pail','hour','LS')),
  cost_code text REFERENCES public.cost_codes(code),
  default_waste_pct numeric NOT NULL DEFAULT 0 CHECK (default_waste_pct >= 0 AND default_waste_pct <= 100),
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS assembly_templates_name_key ON public.assembly_templates (lower(btrim(name)));
--> statement-breakpoint

-- source: finish_material = the material chosen for the job's finish tag; catalogue = one fixed catalogue item;
-- labour_rate = a labour rate; fixed = a typed amount per unit.
CREATE TABLE IF NOT EXISTS public.assembly_template_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.assembly_templates(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('material','labour','fixed')),
  label text NOT NULL,
  source text NOT NULL CHECK (source IN ('finish_material','catalogue','labour_rate','fixed')),
  catalogue_material_id uuid REFERENCES public.catalogue_materials(id) ON DELETE SET NULL,
  labour_rate_id uuid REFERENCES public.labour_rates(id) ON DELETE SET NULL,
  unit_cost_cents bigint CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  cost_uom text CHECK (cost_uom IS NULL OR cost_uom IN ('SF','SY','LF','EA','carton','roll','pail','hour','LS')),
  qty_per_driver numeric NOT NULL DEFAULT 1 CHECK (qty_per_driver >= 0),
  waste_pct numeric CHECK (waste_pct IS NULL OR (waste_pct >= 0 AND waste_pct <= 100)),
  round_up boolean NOT NULL DEFAULT true,
  pst_applies boolean NOT NULL DEFAULT false,
  on_gross boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assembly_template_components_template_idx ON public.assembly_template_components (template_id, sort_order);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.tax_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pst_pct numeric NOT NULL DEFAULT 7 CHECK (pst_pct >= 0 AND pst_pct <= 100),
  gst_pct numeric NOT NULL DEFAULT 5 CHECK (gst_pct >= 0 AND gst_pct <= 100),
  hst_pct numeric NOT NULL DEFAULT 13 CHECK (hst_pct >= 0 AND hst_pct <= 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO public.tax_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['suppliers','cost_codes','catalogue_materials','labour_rates','assembly_templates','assembly_template_components','tax_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_capability(''view_pricing''))', t || ' read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_capability(''manage_catalogue''))', t || ' insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_capability(''manage_catalogue'')) WITH CHECK (public.has_capability(''manage_catalogue''))', t || ' update', t);
  END LOOP;
  -- Editing an assembly removes and re-adds its component rows.
  GRANT DELETE ON public.assembly_template_components TO authenticated;
  DROP POLICY IF EXISTS "assembly_template_components delete" ON public.assembly_template_components;
  CREATE POLICY "assembly_template_components delete" ON public.assembly_template_components FOR DELETE TO authenticated
    USING (public.has_capability('manage_catalogue'));
END $$;
--> statement-breakpoint

-- Starting labour rates. Costs are left unknown for BMD to fill in.
INSERT INTO public.labour_rates (name, uom, cost_code)
SELECT v.name, v.uom, v.cost_code FROM (VALUES
  ('Install carpet (broadloom)','SY','01-26'),
  ('Install carpet tile','SF','01-26'),
  ('Install LVP','SF','01-26'),
  ('Install LVT','SF','01-26'),
  ('Install sheet vinyl','SY','01-26'),
  ('Install rubber flooring','SF','01-26'),
  ('Install floor tile','SF','01-27'),
  ('Install wall tile','SF','01-27'),
  ('Install wall base','LF','01-26'),
  ('Install window covering','EA','02-600'),
  ('Floor prep','SF','01-18')
) AS v(name, uom, cost_code)
WHERE NOT EXISTS (SELECT 1 FROM public.labour_rates r WHERE lower(btrim(r.name)) = lower(v.name));
--> statement-breakpoint

-- Starting supply-and-install assemblies.
INSERT INTO public.assembly_templates (name, category, driver_uom, cost_code, default_waste_pct, sort_order)
SELECT v.name, v.category, v.driver_uom, v.cost_code, v.waste, v.sort_order FROM (VALUES
  ('Carpet (broadloom)','carpet_broadloom','SF','01-02',8,1),
  ('Carpet tile','carpet_tile','SF','01-01',5,2),
  ('LVP','lvp','SF','01-05',5,3),
  ('LVT','lvt','SF','01-04',5,4),
  ('Sheet vinyl','sheet_vinyl','SF','01-06',8,5),
  ('Rubber flooring','rubber','SF','01-08',5,6),
  ('Floor tile','floor_tile','SF','01-10',10,7),
  ('Wall tile','wall_tile','SF','01-09',10,8),
  ('Wall base','wall_base','LF','01-14',5,9),
  ('Window coverings','window_coverings','EA','02-100',0,10)
) AS v(name, category, driver_uom, cost_code, waste, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.assembly_templates t WHERE lower(btrim(t.name)) = lower(v.name));
--> statement-breakpoint

INSERT INTO public.assembly_template_components (template_id, kind, label, source, labour_rate_id, sort_order)
SELECT t.id, v.kind, v.label, v.source, r.id, v.sort_order
FROM (VALUES
  ('Carpet (broadloom)','material','Material','finish_material',NULL,1),
  ('Carpet (broadloom)','material','Adhesive','catalogue',NULL,2),
  ('Carpet (broadloom)','labour','Install carpet (broadloom)','labour_rate','Install carpet (broadloom)',3),
  ('Carpet tile','material','Material','finish_material',NULL,1),
  ('Carpet tile','material','Adhesive','catalogue',NULL,2),
  ('Carpet tile','labour','Install carpet tile','labour_rate','Install carpet tile',3),
  ('LVP','material','Material','finish_material',NULL,1),
  ('LVP','material','Adhesive','catalogue',NULL,2),
  ('LVP','labour','Install LVP','labour_rate','Install LVP',3),
  ('LVT','material','Material','finish_material',NULL,1),
  ('LVT','material','Adhesive','catalogue',NULL,2),
  ('LVT','labour','Install LVT','labour_rate','Install LVT',3),
  ('Sheet vinyl','material','Material','finish_material',NULL,1),
  ('Sheet vinyl','material','Adhesive','catalogue',NULL,2),
  ('Sheet vinyl','labour','Install sheet vinyl','labour_rate','Install sheet vinyl',3),
  ('Rubber flooring','material','Material','finish_material',NULL,1),
  ('Rubber flooring','material','Adhesive','catalogue',NULL,2),
  ('Rubber flooring','labour','Install rubber flooring','labour_rate','Install rubber flooring',3),
  ('Floor tile','material','Material','finish_material',NULL,1),
  ('Floor tile','material','Mortar and grout','catalogue',NULL,2),
  ('Floor tile','labour','Install floor tile','labour_rate','Install floor tile',3),
  ('Wall tile','material','Material','finish_material',NULL,1),
  ('Wall tile','material','Mortar and grout','catalogue',NULL,2),
  ('Wall tile','labour','Install wall tile','labour_rate','Install wall tile',3),
  ('Wall base','material','Material','finish_material',NULL,1),
  ('Wall base','material','Adhesive','catalogue',NULL,2),
  ('Wall base','labour','Install wall base','labour_rate','Install wall base',3),
  ('Window coverings','material','Material','finish_material',NULL,1),
  ('Window coverings','labour','Install window covering','labour_rate','Install window covering',3),
  ('Window coverings','fixed','Delivery and staging','fixed',NULL,4)
) AS v(template, kind, label, source, labour, sort_order)
JOIN public.assembly_templates t ON t.name = v.template
LEFT JOIN public.labour_rates r ON r.name = v.labour
WHERE NOT EXISTS (SELECT 1 FROM public.assembly_template_components c WHERE c.template_id = t.id AND c.sort_order = v.sort_order);
