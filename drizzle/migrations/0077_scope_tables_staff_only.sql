DROP POLICY IF EXISTS "scope keywords read" ON public.scope_keywords;
CREATE POLICY "scope keywords read" ON public.scope_keywords FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline') OR public.has_capability('use_assistant') OR public.has_capability('manage_settings') OR public.has_capability('manage_estimates'));
DROP POLICY IF EXISTS "scope scan state read" ON public.scope_scan_state;
CREATE POLICY "scope scan state read" ON public.scope_scan_state FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline') OR public.has_capability('manage_settings'));