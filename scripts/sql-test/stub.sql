-- Minimal Supabase stand-in for testing migrations that touch users and access. Not a full schema.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}', last_sign_in_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TYPE public.app_role AS ENUM ('bmd_admin','bmd_field','client','super_admin','bmd_manager','trade','viewer');
CREATE TYPE public.job_role AS ENUM ('estimator','project_lead','site_lead','other');

CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, full_name text, company text, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, role));
CREATE TABLE public.role_permissions (role public.app_role NOT NULL, capability text NOT NULL, allowed boolean NOT NULL DEFAULT true, PRIMARY KEY (role, capability));
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, client_name text, address text, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.project_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE, user_id uuid NOT NULL, role public.app_role NOT NULL, added_by uuid, created_at timestamptz NOT NULL DEFAULT now(), job_roles public.job_role[] NOT NULL DEFAULT '{}', UNIQUE (project_id, user_id));
CREATE TABLE public.user_invites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, full_name text, company text, role public.app_role NOT NULL, invited_by uuid, invite_token text NOT NULL DEFAULT md5(random()::text), created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days', project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE, sent_at timestamptz, last_error text, status text NOT NULL DEFAULT 'pending');
ALTER TABLE public.user_invites ADD CONSTRAINT user_invites_status_check CHECK (status IN ('pending','accepted','expired'));
ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.deficiencies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, status text DEFAULT 'open', created_by uuid, assigned_to uuid);
CREATE TABLE public.floors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid);
CREATE TABLE public.ms_connections (user_id uuid PRIMARY KEY);

-- Functions the migration replaces; the old bodies only need to exist.
CREATE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('super_admin','bmd_admin')) $$;
CREATE FUNCTION public.has_capability(_capability text, _project uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.has_capability(_capability text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_project_member(_project uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN new; END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.role_permissions (role, capability) VALUES
  ('bmd_manager','manage_users'), ('bmd_manager','manage_estimates'), ('bmd_manager','manage_projects'), ('bmd_manager','view_pipeline'),
  ('bmd_field','capture_items'), ('trade','add_photos'), ('viewer','export_pdf'), ('client','comment');
