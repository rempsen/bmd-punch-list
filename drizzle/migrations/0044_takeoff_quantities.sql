-- The link from the takeoff to the estimate: which finish each takeoff condition is, and the measured quantities
-- (no waste) per condition and section, rewritten on every takeoff save.
CREATE TABLE IF NOT EXISTS public.takeoff_finish_links (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  condition_key text NOT NULL CHECK (btrim(condition_key) <> '' AND char_length(condition_key) <= 100),
  finish_id uuid NOT NULL REFERENCES public.project_finishes(id) ON DELETE CASCADE,
  variant boolean NOT NULL DEFAULT false,
  colour text,
  PRIMARY KEY (project_id, condition_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS takeoff_finish_links_finish_idx ON public.takeoff_finish_links (finish_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.takeoff_quantities (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  condition_key text NOT NULL,
  section text NOT NULL DEFAULT '',
  finish_id uuid NOT NULL REFERENCES public.project_finishes(id) ON DELETE CASCADE,
  floor_sf numeric NOT NULL DEFAULT 0,
  wall_sf numeric NOT NULL DEFAULT 0,
  border_sf numeric NOT NULL DEFAULT 0,
  lf numeric NOT NULL DEFAULT 0,
  ea numeric NOT NULL DEFAULT 0,
  takeoff_version int NOT NULL,
  PRIMARY KEY (project_id, condition_key, section)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS takeoff_quantities_finish_idx ON public.takeoff_quantities (finish_id);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['takeoff_finish_links','takeoff_quantities'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_project_documents(project_id, false) OR public.has_capability(''manage_estimates''))', t || ' read', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Saves the takeoff and, in the same step, brings the job's finishes and the measured quantities into line with it.
-- A condition with no finish makes one (tag only: no material, no price). Renaming a condition renames its finish.
-- Removing a condition never removes a finish.
CREATE OR REPLACE FUNCTION public.save_project_takeoff(_project uuid, _doc jsonb, _expected_version int, _quantities jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int; c jsonb; r jsonb; k text; t text; fid uuid; is_variant boolean; keys text[] := '{}';
BEGIN
  v := public.save_project_takeoff(_project, _doc, _expected_version);   -- checks access and the version
  IF _quantities IS NULL OR jsonb_typeof(_quantities) <> 'object' THEN RETURN v; END IF;
  IF jsonb_array_length(coalesce(_quantities->'conditions', '[]'::jsonb)) > 2000 OR jsonb_array_length(coalesce(_quantities->'rows', '[]'::jsonb)) > 20000 THEN
    RAISE EXCEPTION 'Too many finishes in one takeoff';
  END IF;

  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(_quantities->'conditions', '[]'::jsonb)) LOOP
    k := btrim(coalesce(c->>'key', ''));
    t := left(btrim(coalesce(c->>'tag', '')), 120);
    is_variant := coalesce((c->>'variant')::boolean, false);
    CONTINUE WHEN k = '' OR t = '' OR k = ANY(keys);
    keys := keys || k;
    SELECT l.finish_id INTO fid FROM public.takeoff_finish_links l WHERE l.project_id = _project AND l.condition_key = k;
    IF fid IS NOT NULL THEN
      -- Renamed in the takeoff: rename the finish, unless this is an area variant or the new tag is another finish.
      IF NOT is_variant AND NOT EXISTS (SELECT 1 FROM public.project_finishes f WHERE f.project_id = _project AND lower(btrim(f.tag)) = lower(t)) THEN
        UPDATE public.project_finishes SET tag = t WHERE id = fid;
      ELSIF NOT EXISTS (SELECT 1 FROM public.project_finishes f WHERE f.id = fid AND lower(btrim(f.tag)) = lower(t)) THEN
        fid := NULL;   -- now carries another finish's tag: link it to that finish below
      END IF;
    END IF;
    IF fid IS NULL THEN
      SELECT f.id INTO fid FROM public.project_finishes f WHERE f.project_id = _project AND lower(btrim(f.tag)) = lower(t);
      IF fid IS NULL THEN
        INSERT INTO public.project_finishes (project_id, tag, sort_order)
        VALUES (_project, t, (SELECT coalesce(max(sort_order), 0) + 1 FROM public.project_finishes WHERE project_id = _project))
        RETURNING id INTO fid;
      END IF;
    END IF;
    INSERT INTO public.takeoff_finish_links (project_id, condition_key, finish_id, variant, colour)
    VALUES (_project, k, fid, is_variant, nullif(left(c->>'colour', 20), ''))
    ON CONFLICT (project_id, condition_key) DO UPDATE SET finish_id = EXCLUDED.finish_id, variant = EXCLUDED.variant, colour = EXCLUDED.colour;
  END LOOP;

  DELETE FROM public.takeoff_finish_links WHERE project_id = _project AND NOT (condition_key = ANY(keys));
  DELETE FROM public.takeoff_quantities WHERE project_id = _project;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(_quantities->'rows', '[]'::jsonb)) LOOP
    SELECT l.finish_id INTO fid FROM public.takeoff_finish_links l WHERE l.project_id = _project AND l.condition_key = btrim(coalesce(r->>'key', ''));
    CONTINUE WHEN fid IS NULL;
    INSERT INTO public.takeoff_quantities (project_id, condition_key, section, finish_id, floor_sf, wall_sf, border_sf, lf, ea, takeoff_version)
    VALUES (_project, btrim(r->>'key'), left(btrim(coalesce(r->>'section', '')), 120), fid,
      coalesce((r->>'floor_sf')::numeric, 0), coalesce((r->>'wall_sf')::numeric, 0), coalesce((r->>'border_sf')::numeric, 0), coalesce((r->>'lf')::numeric, 0), coalesce((r->>'ea')::numeric, 0), v)
    ON CONFLICT (project_id, condition_key, section) DO UPDATE SET floor_sf = public.takeoff_quantities.floor_sf + EXCLUDED.floor_sf, wall_sf = public.takeoff_quantities.wall_sf + EXCLUDED.wall_sf,
      border_sf = public.takeoff_quantities.border_sf + EXCLUDED.border_sf, lf = public.takeoff_quantities.lf + EXCLUDED.lf, ea = public.takeoff_quantities.ea + EXCLUDED.ea;
  END LOOP;
  RETURN v;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.save_project_takeoff(uuid, jsonb, int, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.save_project_takeoff(uuid, jsonb, int, jsonb) TO authenticated;
