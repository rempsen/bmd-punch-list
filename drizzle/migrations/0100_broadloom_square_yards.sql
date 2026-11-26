ALTER TABLE public.catalogue_materials ADD COLUMN IF NOT EXISTS unit_correction jsonb;
ALTER TABLE public.labour_rates ADD COLUMN IF NOT EXISTS unit_correction jsonb;
ALTER TABLE public.assembly_templates ADD COLUMN IF NOT EXISTS unit_correction jsonb;

CREATE OR REPLACE FUNCTION public.catalogue_unit_correction_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.unit_correction IS DISTINCT FROM OLD.unit_correction AND NEW.unit_correction IS NOT NULL THEN
    INSERT INTO public.sync_log(direction,system,kind,bmd_id,label,outcome,detail)
    VALUES ('in','catalogue',TG_ARGV[0],NEW.id::text,NEW.name,'applied',NEW.unit_correction);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.catalogue_unit_correction_audit() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='broadloom_material_correction_audit' AND tgrelid='public.catalogue_materials'::regclass) THEN
    CREATE TRIGGER broadloom_material_correction_audit AFTER UPDATE ON public.catalogue_materials FOR EACH ROW EXECUTE FUNCTION public.catalogue_unit_correction_audit('material');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='broadloom_labour_correction_audit' AND tgrelid='public.labour_rates'::regclass) THEN
    CREATE TRIGGER broadloom_labour_correction_audit AFTER UPDATE ON public.labour_rates FOR EACH ROW EXECUTE FUNCTION public.catalogue_unit_correction_audit('labour');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='broadloom_assembly_correction_audit' AND tgrelid='public.assembly_templates'::regclass) THEN
    CREATE TRIGGER broadloom_assembly_correction_audit AFTER UPDATE ON public.assembly_templates FOR EACH ROW EXECUTE FUNCTION public.catalogue_unit_correction_audit('assembly');
  END IF;
END $$;

-- Additive backfill: retain the exact old units/costs in each entry's new correction record.
UPDATE public.catalogue_materials SET
  unit_correction=jsonb_build_object('reason','Broadloom is measured in SY','at',now(),'cost_uom',jsonb_build_object('from',cost_uom,'to','SY'),'unit_cost_cents',jsonb_build_object('from',unit_cost_cents,'to',unit_cost_cents*9),'purchase_uom',jsonb_build_object('from',purchase_uom,'to',CASE WHEN purchase_uom='SF' THEN 'SY' ELSE purchase_uom END)),
  cost_uom='SY', unit_cost_cents=unit_cost_cents*9,
  purchase_uom=CASE WHEN purchase_uom='SF' THEN 'SY' ELSE purchase_uom END,
  coverage_per_purchase_unit=CASE WHEN coverage_uom='SF' THEN coverage_per_purchase_unit/9 ELSE coverage_per_purchase_unit END,
  coverage_uom=CASE WHEN coverage_uom='SF' THEN 'SY' ELSE coverage_uom END, updated_at=now()
WHERE category='carpet_broadloom' AND cost_uom='SF' AND unit_cost_cents IS NOT NULL AND unit_correction IS NULL;

UPDATE public.labour_rates l SET
  unit_correction=jsonb_build_object('reason','Broadloom labour is priced in SY','at',now(),'uom',jsonb_build_object('from',uom,'to','SY'),'unit_cost_cents',jsonb_build_object('from',unit_cost_cents,'to',unit_cost_cents*9)),
  uom='SY', unit_cost_cents=unit_cost_cents*9
WHERE l.uom='SF' AND l.unit_cost_cents IS NOT NULL AND l.unit_correction IS NULL
AND (l.name ILIKE '%broadloom%' OR EXISTS (SELECT 1 FROM public.assembly_template_components c JOIN public.assembly_templates t ON t.id=c.template_id WHERE c.labour_rate_id=l.id AND t.category='carpet_broadloom'));

UPDATE public.assembly_templates SET
  unit_correction=jsonb_build_object('reason','Broadloom is measured in SY','at',now(),'driver_uom',jsonb_build_object('from',driver_uom,'to','SY')),
  driver_uom='SY'
WHERE category='carpet_broadloom' AND driver_uom='SF' AND unit_correction IS NULL;

CREATE OR REPLACE FUNCTION public.broadloom_create_unit() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.category='carpet_broadloom' THEN
    IF TG_TABLE_NAME='catalogue_materials' THEN
      IF NEW.cost_uom='SF' THEN NEW.unit_cost_cents:=NEW.unit_cost_cents*9; END IF;
      IF NEW.purchase_uom IN ('SF','EA') THEN NEW.purchase_uom:='SY'; END IF;
      NEW.cost_uom:='SY';
    ELSE NEW.driver_uom:='SY'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.broadloom_create_unit() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='broadloom_create_unit' AND tgrelid='public.catalogue_materials'::regclass) THEN
    CREATE TRIGGER broadloom_create_unit BEFORE INSERT ON public.catalogue_materials FOR EACH ROW EXECUTE FUNCTION public.broadloom_create_unit();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='broadloom_create_unit' AND tgrelid='public.assembly_templates'::regclass) THEN
    CREATE TRIGGER broadloom_create_unit BEFORE INSERT ON public.assembly_templates FOR EACH ROW EXECUTE FUNCTION public.broadloom_create_unit();
  END IF;
END $$;

ALTER TABLE public.catalogue_materials DROP CONSTRAINT IF EXISTS catalogue_materials_cost_uom_check;
ALTER TABLE public.catalogue_materials ADD CONSTRAINT catalogue_materials_cost_uom_check CHECK (cost_uom IN ('SF','SY','LF','EA','carton','roll','bag','pail','hour','LS'));
ALTER TABLE public.catalogue_materials DROP CONSTRAINT IF EXISTS catalogue_materials_purchase_uom_check;
ALTER TABLE public.catalogue_materials ADD CONSTRAINT catalogue_materials_purchase_uom_check CHECK (purchase_uom IN ('SF','SY','LF','EA','carton','roll','bag','pail','hour','LS'));
ALTER TABLE public.labour_rates DROP CONSTRAINT IF EXISTS labour_rates_uom_check;
ALTER TABLE public.labour_rates ADD CONSTRAINT labour_rates_uom_check CHECK (uom IN ('SF','SY','LF','EA','carton','roll','bag','pail','hour','LS'));
ALTER TABLE public.assembly_templates DROP CONSTRAINT IF EXISTS assembly_templates_driver_uom_check;
ALTER TABLE public.assembly_templates ADD CONSTRAINT assembly_templates_driver_uom_check CHECK (driver_uom IN ('SF','SY','LF','EA','carton','roll','bag','pail','hour','LS'));
ALTER TABLE public.assembly_template_components DROP CONSTRAINT IF EXISTS assembly_template_components_cost_uom_check;
ALTER TABLE public.assembly_template_components ADD CONSTRAINT assembly_template_components_cost_uom_check CHECK (cost_uom IS NULL OR cost_uom IN ('SF','SY','LF','EA','carton','roll','bag','pail','hour','LS'));
ALTER TABLE public.estimate_lines DROP CONSTRAINT IF EXISTS estimate_lines_driver_uom_check;
ALTER TABLE public.estimate_lines ADD CONSTRAINT estimate_lines_driver_uom_check CHECK (driver_uom IN ('SF','SY','LF','EA','carton','roll','bag','pail','hour','LS'));