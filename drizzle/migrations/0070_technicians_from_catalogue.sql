-- Technicians come from the catalogue: a visit can be assigned to an active Labour or Both vendor
-- (Catalogue → Suppliers & subcontractors) as well as to BMD staff. The visit links to the vendor row;
-- assigned_name still carries the vendor's name because that is what travels to ArrivePing as the crew name,
-- so the existing assignment queue fires unchanged.
ALTER TABLE public.install_visits ADD COLUMN IF NOT EXISTS technician_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS install_visits_technician_supplier_idx ON public.install_visits (technician_supplier_id) WHERE technician_supplier_id IS NOT NULL;
--> statement-breakpoint
GRANT UPDATE (technician_supplier_id) ON public.install_visits TO authenticated;
--> statement-breakpoint
-- A name typed before this change that exactly matches an active Labour or Both vendor is linked to it.
UPDATE public.install_visits v SET technician_supplier_id = s.id
  FROM public.suppliers s
 WHERE v.technician_supplier_id IS NULL AND v.assigned_user_id IS NULL AND v.assigned_name IS NOT NULL
   AND lower(btrim(s.name)) = lower(btrim(v.assigned_name)) AND s.active AND s.supplies IN ('labour', 'both');
--> statement-breakpoint
-- The vendors that can be scheduled. Only what the picker needs: the suppliers table itself is for people who see pricing.
CREATE OR REPLACE FUNCTION public.bmd_subcontractors()
RETURNS TABLE(id uuid, name text, contact_name text, phone text, supplies text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('view_pipeline') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  SELECT s.id, s.name, s.contact_name, s.phone, s.supplies FROM public.suppliers s
   WHERE s.active AND s.supplies IN ('labour', 'both') ORDER BY lower(s.name);
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bmd_subcontractors() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.bmd_subcontractors() TO authenticated;
--> statement-breakpoint
-- Add a crew from the Schedule a visit picker. A vendor of that name is reused: a materials-only one becomes Both,
-- an inactive one is made active again. Returns the vendor's id.
CREATE OR REPLACE FUNCTION public.add_subcontractor(_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm text := btrim(regexp_replace(coalesce(_name, ''), '\s+', ' ', 'g')); sid uuid;
BEGIN
  IF NOT (public.has_capability('manage_projects') OR public.has_capability('manage_catalogue')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF length(nm) < 2 OR length(nm) > 120 THEN RAISE EXCEPTION 'Type the subcontractor''s name (2 to 120 characters).'; END IF;
  SELECT s.id INTO sid FROM public.suppliers s WHERE lower(btrim(s.name)) = lower(nm);
  IF sid IS NOT NULL THEN
    UPDATE public.suppliers SET active = true, supplies = CASE WHEN supplies = 'materials' THEN 'both' ELSE supplies END WHERE id = sid;
  ELSE
    INSERT INTO public.suppliers (name, supplies, active) VALUES (nm, 'labour', true) RETURNING id INTO sid;
  END IF;
  RETURN sid;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.add_subcontractor(text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.add_subcontractor(text) TO authenticated;
