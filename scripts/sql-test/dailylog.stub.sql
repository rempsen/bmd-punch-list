-- Stand-ins for what the daily log migration (0084) reads: document access, the estimate tables and the photo bucket.
CREATE OR REPLACE FUNCTION public.can_project_documents(_project uuid, _write boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _project IS NOT NULL AND (
    public.has_capability(CASE WHEN _write THEN 'manage_documents' ELSE 'view_documents' END, _project)
    OR (public.has_capability('view_pipeline') AND public.has_capability(CASE WHEN _write THEN 'manage_documents' ELSE 'view_documents' END)));
$$;
-- The capabilities each level has on the live system that matter here.
INSERT INTO public.role_permissions (role, capability) VALUES
  ('bmd_manager','view_documents'), ('bmd_manager','add_photos'), ('bmd_manager','manage_settings'),
  ('bmd_field','view_documents'), ('bmd_field','add_photos'), ('trade','comment'), ('client','view_dashboard'), ('viewer','view_dashboard')
ON CONFLICT DO NOTHING;
-- A client on the Hyatt job.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000e1','client@hotel.test') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, email, full_name) VALUES ('00000000-0000-0000-0000-0000000000e1','client@hotel.test','Cleo Client') ON CONFLICT (id) DO UPDATE SET full_name = 'Cleo Client';
INSERT INTO public.user_access (user_id, level) VALUES ('00000000-0000-0000-0000-0000000000e1','client') ON CONFLICT (user_id) DO UPDATE SET level = 'client';
INSERT INTO public.project_members (project_id, user_id, role) VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','client') ON CONFLICT DO NOTHING;

CREATE TABLE public.suppliers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE public.catalogue_materials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, colour text, supplier_id uuid REFERENCES public.suppliers(id), unit_cost_cents bigint);
CREATE TABLE public.estimate_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id), name text NOT NULL DEFAULT 'Base', is_base boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'draft', sort_order integer NOT NULL DEFAULT 0);
CREATE TABLE public.estimate_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES public.estimate_versions(id), section text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '',
  driver_qty numeric, driver_uom text, selection text DEFAULT 'required', markup_pct numeric NOT NULL DEFAULT 30, sort_order integer NOT NULL DEFAULT 0);
CREATE TABLE public.estimate_line_components (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), line_id uuid NOT NULL REFERENCES public.estimate_lines(id), kind text NOT NULL, label text NOT NULL DEFAULT '',
  catalogue_material_id uuid REFERENCES public.catalogue_materials(id), labour_rate_id uuid, unit_cost_cents bigint, cost_uom text NOT NULL DEFAULT 'EA', purchase_uom text NOT NULL DEFAULT 'EA',
  coverage_per_purchase_unit numeric, qty_per_driver numeric NOT NULL DEFAULT 1, waste_pct numeric NOT NULL DEFAULT 0, round_up boolean NOT NULL DEFAULT false, not_applicable boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 1);
-- Estimate tables are closed to anyone without pricing access, as on the live system.
ALTER TABLE public.estimate_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_line_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogue_materials ENABLE ROW LEVEL SECURITY;

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner_id text DEFAULT (auth.uid())::text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage, auth, public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON public.estimate_versions, public.estimate_lines, public.estimate_line_components, public.catalogue_materials, public.projects TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
