DO $$
DECLARE n int; cost int; u text; old_cost int;
BEGIN
 SELECT cost_uom,unit_cost_cents,(unit_correction->'unit_cost_cents'->>'from')::int INTO u,cost,old_cost FROM public.catalogue_materials WHERE name='Broadloom priced';
 IF u<>'SY' OR cost<>3510 OR old_cost<>390 THEN RAISE EXCEPTION 'Expected 390/SF → 3510/SY with old cost retained'; END IF;
 SELECT uom,unit_cost_cents INTO u,cost FROM public.labour_rates WHERE name='Broadloom install';
 IF u<>'SY' OR cost<>900 THEN RAISE EXCEPTION 'Labour must convert 100/SF → 900/SY'; END IF;
 SELECT count(*) INTO n FROM public.sync_log;
 IF n<>3 THEN RAISE EXCEPTION 'Repeated migration must log exactly 3 corrections, got %',n; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.catalogue_materials WHERE name='Broadloom unknown' AND cost_uom='SF' AND unit_cost_cents IS NULL AND unit_correction IS NULL) THEN RAISE EXCEPTION 'Unknown costs must be skipped'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.catalogue_materials WHERE name='Broadloom already SY' AND unit_cost_cents=3510 AND unit_correction IS NULL) THEN RAISE EXCEPTION 'Existing SY must be skipped'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.catalogue_materials WHERE name='Carpet tile' AND cost_uom='SF' AND unit_cost_cents=400) THEN RAISE EXCEPTION 'Carpet tile must not change'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.assembly_templates WHERE name='Broadloom assembly' AND driver_uom='SY') THEN RAISE EXCEPTION 'Assembly driver must be SY'; END IF;
 -- QuickBooks imports have EA placeholders because QuickBooks has no unit; broadloom still defaults to SY.
 INSERT INTO public.catalogue_materials(name,category,cost_uom,purchase_uom,unit_cost_cents) VALUES ('QuickBooks broadloom','carpet_broadloom','EA','EA',3500);
 IF NOT EXISTS(SELECT 1 FROM public.catalogue_materials WHERE name='QuickBooks broadloom' AND cost_uom='SY' AND purchase_uom='SY' AND unit_cost_cents=3500) THEN RAISE EXCEPTION 'QuickBooks default unit must be SY without changing its unitless cost'; END IF;
 INSERT INTO public.estimate_lines(driver_uom) VALUES ('bag');
 RAISE NOTICE 'Broadloom correction, audit, idempotency and QuickBooks default: ok';
END $$;