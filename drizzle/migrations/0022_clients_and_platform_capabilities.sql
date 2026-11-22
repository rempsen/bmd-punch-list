-- BMD Projects phase 1, task 1: company-wide clients and the platform capabilities.
-- Additive and safe to run more than once.

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  billing_address text,
  phone text,
  email text,
  notes text,
  qbo_customer_id text,
  onedrive_folder_id text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS clients_name_key ON public.clients (lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS clients_qbo_customer_id_key ON public.clients (qbo_customer_id) WHERE qbo_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text,
  title text,
  email text,
  phone_mobile text,
  phone_office text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_contacts_client_id_idx ON public.client_contacts (client_id);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_contacts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.clients, public.client_contacts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients, public.client_contacts TO authenticated;

DROP POLICY IF EXISTS "clients read" ON public.clients;
CREATE POLICY "clients read" ON public.clients FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline'));
DROP POLICY IF EXISTS "clients insert" ON public.clients;
CREATE POLICY "clients insert" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (public.has_capability('manage_projects'));
DROP POLICY IF EXISTS "clients update" ON public.clients;
CREATE POLICY "clients update" ON public.clients FOR UPDATE TO authenticated
  USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));
DROP POLICY IF EXISTS "clients delete" ON public.clients;
CREATE POLICY "clients delete" ON public.clients FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "client contacts read" ON public.client_contacts;
CREATE POLICY "client contacts read" ON public.client_contacts FOR SELECT TO authenticated
  USING (public.has_capability('view_pipeline'));
DROP POLICY IF EXISTS "client contacts write" ON public.client_contacts;
CREATE POLICY "client contacts write" ON public.client_contacts FOR ALL TO authenticated
  USING (public.has_capability('manage_projects')) WITH CHECK (public.has_capability('manage_projects'));

-- Nine platform capabilities. Defaults: super admin all; BMD manager all but integrations;
-- BMD field documents only; trade, client and viewer none.
INSERT INTO public.role_permissions (role, capability, allowed)
SELECT r.role::public.app_role, c.capability,
       CASE
         WHEN r.role = 'super_admin' THEN true
         WHEN r.role = 'bmd_manager' THEN c.capability <> 'manage_integrations'
         WHEN r.role = 'bmd_field' THEN c.capability = 'view_documents'
         ELSE false
       END
FROM (VALUES ('super_admin'), ('bmd_manager'), ('bmd_field'), ('trade'), ('client'), ('viewer')) AS r(role)
CROSS JOIN (VALUES ('view_pipeline'), ('manage_projects'), ('view_documents'), ('manage_documents'), ('view_pricing'),
                   ('manage_estimates'), ('send_quotes'), ('manage_catalogue'), ('manage_integrations')) AS c(capability)
ON CONFLICT (role, capability) DO NOTHING;
