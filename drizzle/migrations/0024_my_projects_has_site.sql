-- The job chooser lists only projects whose site (floors and rooms) is set up.
-- Pipeline projects still count for role lookups, so the function reports has_site instead of hiding them.
DROP FUNCTION IF EXISTS public.my_projects();
--> statement-breakpoint
CREATE FUNCTION public.my_projects()
RETURNS TABLE (id uuid, name text, client_name text, address text, archived_at timestamptz, role public.app_role, open_count bigint, has_site boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.client_name, p.address, p.archived_at,
    CASE WHEN public.is_super_admin(auth.uid()) THEN 'super_admin'::public.app_role
         ELSE (SELECT m.role FROM public.project_members m WHERE m.project_id = p.id AND m.user_id = auth.uid()) END,
    (SELECT count(*) FROM public.deficiencies d WHERE d.project_id = p.id AND d.status NOT IN ('verified','accepted_as_is')),
    EXISTS (SELECT 1 FROM public.floors f WHERE f.project_id = p.id)
  FROM public.projects p
  WHERE public.is_project_member(p.id)
  ORDER BY p.archived_at NULLS FIRST, p.created_at;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.my_projects() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.my_projects() TO authenticated;
