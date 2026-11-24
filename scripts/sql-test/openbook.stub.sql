-- Stand-ins the billing migrations read: job number and holdback, GST, suppliers, quotes and documents.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS project_number text;
CREATE TABLE public.tax_settings (id int PRIMARY KEY DEFAULT 1, gst_pct numeric NOT NULL DEFAULT 5);
INSERT INTO public.tax_settings (id) VALUES (1);
CREATE TABLE public.suppliers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE public.quotes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id), kind text NOT NULL DEFAULT 'quote', status text NOT NULL DEFAULT 'draft',
  accepted_value_cents bigint, accepted_version_id uuid, snapshot jsonb);
CREATE TABLE public.project_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, file_name text);
GRANT USAGE ON SCHEMA public TO authenticated;
