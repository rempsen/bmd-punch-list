CREATE TABLE IF NOT EXISTS public.catalogue_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogue_item_id uuid REFERENCES public.catalogue_materials(id) ON DELETE CASCADE,
  assembly_id uuid REFERENCES public.assembly_templates(id) ON DELETE CASCADE,
  alias text NOT NULL CHECK (btrim(alias) <> ''),
  alias_norm text NOT NULL CHECK (alias_norm <> ''),
  source text NOT NULL DEFAULT 'import' CHECK (source IN ('import','manual')),
  uses int NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalogue_aliases_one_target CHECK ((catalogue_item_id IS NULL) <> (assembly_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS catalogue_aliases_unique ON public.catalogue_aliases (alias_norm, (coalesce(catalogue_item_id, assembly_id)));
CREATE INDEX IF NOT EXISTS catalogue_aliases_norm_idx ON public.catalogue_aliases (alias_norm);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalogue_aliases TO authenticated;
GRANT ALL ON public.catalogue_aliases TO service_role;
ALTER TABLE public.catalogue_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "catalogue_aliases read" ON public.catalogue_aliases;
CREATE POLICY "catalogue_aliases read" ON public.catalogue_aliases FOR SELECT TO authenticated USING (public.has_capability('view_pipeline'));
DROP POLICY IF EXISTS "catalogue_aliases insert" ON public.catalogue_aliases;
CREATE POLICY "catalogue_aliases insert" ON public.catalogue_aliases FOR INSERT TO authenticated WITH CHECK (public.has_capability('view_pricing') OR public.has_capability('manage_projects'));
DROP POLICY IF EXISTS "catalogue_aliases update" ON public.catalogue_aliases;
CREATE POLICY "catalogue_aliases update" ON public.catalogue_aliases FOR UPDATE TO authenticated USING (public.has_capability('view_pricing') OR public.has_capability('manage_projects')) WITH CHECK (public.has_capability('view_pricing') OR public.has_capability('manage_projects'));
DROP POLICY IF EXISTS "catalogue_aliases delete" ON public.catalogue_aliases;
CREATE POLICY "catalogue_aliases delete" ON public.catalogue_aliases FOR DELETE TO authenticated USING (public.has_capability('view_pricing') OR public.has_capability('manage_projects'));

-- Write or bump one alias; runs as the caller so the policies above apply.
CREATE OR REPLACE FUNCTION public.confirm_catalogue_alias(_alias text, _alias_norm text, _catalogue_item_id uuid, _assembly_id uuid, _source text DEFAULT 'import')
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  INSERT INTO public.catalogue_aliases (catalogue_item_id, assembly_id, alias, alias_norm, source)
  VALUES (_catalogue_item_id, _assembly_id, btrim(_alias), _alias_norm, coalesce(_source, 'import'))
  ON CONFLICT (alias_norm, (coalesce(catalogue_item_id, assembly_id)))
  DO UPDATE SET uses = public.catalogue_aliases.uses + 1, last_used_at = now()
  RETURNING id
$$;
GRANT EXECUTE ON FUNCTION public.confirm_catalogue_alias(text, text, uuid, uuid, text) TO authenticated;