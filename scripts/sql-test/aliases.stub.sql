-- Minimal stand-ins for the alias migration: the two catalogue tables, auth.uid and has_capability.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION public.has_capability(_capability text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.catalogue_materials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE public.assembly_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
