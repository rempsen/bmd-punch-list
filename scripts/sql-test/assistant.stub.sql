-- Stand-ins the assistant migrations (0068 on) read: storage, company details, documents and the catalogue's columns.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public, storage TO authenticated;
CREATE TABLE public.quote_settings (id int PRIMARY KEY DEFAULT 1, company_name text NOT NULL DEFAULT 'BMD Materials', office_address text NOT NULL DEFAULT '', mailing_address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '', gst_number text NOT NULL DEFAULT '');
INSERT INTO public.quote_settings (id, gst_number) VALUES (1, '81234 5678 RT0001');
CREATE TYPE public.document_section AS ENUM ('plans','specifications','vendor','quotes_sent','contract','photos','other');
CREATE TABLE public.project_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, file_name text, section public.document_section, version int DEFAULT 1);
CREATE TABLE public.document_pages (document_id uuid, page int, text text, tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED);
ALTER TABLE public.document_pages ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.can_project_documents(uuid, boolean) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
ALTER TABLE public.catalogue_materials ADD COLUMN category text, ADD COLUMN manufacturer text, ADD COLUMN product_line text, ADD COLUMN sku text, ADD COLUMN cost_code text,
  ADD COLUMN purchase_uom text, ADD COLUMN cost_uom text, ADD COLUMN coverage_per_purchase_unit numeric, ADD COLUMN coverage_uom text, ADD COLUMN pst_applies boolean DEFAULT false, ADD COLUMN active boolean DEFAULT true;
CREATE TABLE public.labour_rates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, cost_code text, uom text, active boolean DEFAULT true);
-- People for these tests: a manager, a BMD field person and a tradesperson, each with all their jobs.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000a1','mgr@bmd.test'), ('00000000-0000-0000-0000-0000000000f1','field@bmd.test'), ('00000000-0000-0000-0000-0000000000c1','chuck@trade.test') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, email) VALUES ('00000000-0000-0000-0000-0000000000a1','mgr@bmd.test'), ('00000000-0000-0000-0000-0000000000f1','field@bmd.test'), ('00000000-0000-0000-0000-0000000000c1','chuck@trade.test') ON CONFLICT DO NOTHING;
INSERT INTO public.user_access (user_id, level, all_jobs) VALUES
  ('00000000-0000-0000-0000-0000000000a1','bmd_manager',true), ('00000000-0000-0000-0000-0000000000f1','bmd_field',true), ('00000000-0000-0000-0000-0000000000c1','trade',true)
ON CONFLICT (user_id) DO UPDATE SET level = EXCLUDED.level, all_jobs = EXCLUDED.all_jobs, status = 'active';
INSERT INTO public.role_permissions (role, capability, allowed) VALUES ('bmd_manager','view_pricing',true), ('bmd_manager','view_pipeline',true), ('bmd_manager','manage_settings',true),
  ('bmd_field','view_pricing',false), ('bmd_field','view_pipeline',false), ('trade','view_pipeline',false)
ON CONFLICT (role, capability) DO UPDATE SET allowed = EXCLUDED.allowed;
