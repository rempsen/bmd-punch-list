CREATE OR REPLACE FUNCTION public.is_my_assignment(_assigned_to uuid, _trade text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _assigned_to = auth.uid()
    OR (nullif(trim(_trade), '') IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND nullif(trim(p.company), '') IS NOT NULL
        AND lower(trim(p.company)) = lower(trim(_trade))));
$$;
GRANT EXECUTE ON FUNCTION public.is_my_assignment(uuid, text) TO authenticated;

DROP POLICY IF EXISTS "def read" ON public.deficiencies;
CREATE POLICY "def read" ON public.deficiencies FOR SELECT TO authenticated
USING (
  public.is_project_member(project_id) AND (
    public.has_capability('view_acceptable_items', project_id)
    OR ((status = ANY (ARRAY['fix_required','in_progress','fixed']::deficiency_status[])) AND assessment <> 'acceptable')
    OR (status = 'verified' AND public.is_my_assignment(assigned_to, assigned_trade))
  )
);