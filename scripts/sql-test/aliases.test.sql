-- Two confirmations of the same wording for one item bump uses; they never make a second row.
DO $$
DECLARE m uuid; a uuid; a1 uuid; a2 uuid; n int; u int;
BEGIN
  INSERT INTO public.catalogue_materials (name) VALUES ('LVT 1') RETURNING id INTO m;
  INSERT INTO public.assembly_templates (name) VALUES ('LVT supply & install') RETURNING id INTO a;
  a1 := public.confirm_catalogue_alias('LVT.', 'lvt', m, NULL, 'import');
  a2 := public.confirm_catalogue_alias('lvt', 'lvt', m, NULL, 'import');
  SELECT count(*), max(uses) INTO n, u FROM public.catalogue_aliases WHERE alias_norm = 'lvt';
  IF a1 <> a2 OR n <> 1 OR u <> 2 THEN RAISE EXCEPTION 'alias duplicated: rows %, uses %', n, u; END IF;
  -- The same wording may point to a different item (the assembly) as its own row.
  PERFORM public.confirm_catalogue_alias('LVT', 'lvt', NULL, a, 'manual');
  SELECT count(*) INTO n FROM public.catalogue_aliases WHERE alias_norm = 'lvt';
  IF n <> 2 THEN RAISE EXCEPTION 'expected 2 rows, got %', n; END IF;
  -- Exactly one target.
  BEGIN
    PERFORM public.confirm_catalogue_alias('x', 'x', m, a, 'manual');
    RAISE EXCEPTION 'both targets accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'aliases: ok';
END $$;
