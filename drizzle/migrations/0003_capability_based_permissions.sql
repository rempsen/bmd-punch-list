-- 1. Migrate legacy admin role
UPDATE public.user_roles SET role = 'super_admin' WHERE role = 'bmd_admin';
COMMENT ON TYPE public.app_role IS 'bmd_admin is DEPRECATED: replaced by super_admin';

-- 2. Profiles: company
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company text;

-- 3. Permission grid
CREATE TABLE public.role_permissions (
  role public.app_role NOT NULL,
  capability text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, capability)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- Invites
CREATE TABLE public.user_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text,
  role public.app_role NOT NULL,
  company text,
  invited_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);
CREATE UNIQUE INDEX user_invites_email_open ON public.user_invites (lower(email)) WHERE accepted_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_invites TO authenticated;
GRANT ALL ON public.user_invites TO service_role;
ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;

-- 4. Helper functions
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('super_admin','bmd_admin'));
$$;

CREATE OR REPLACE FUNCTION public.has_capability(_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (ur.role IN ('super_admin','bmd_admin')
           OR EXISTS (SELECT 1 FROM public.role_permissions rp
                      WHERE rp.role = ur.role AND rp.capability = _capability AND rp.allowed))
  );
$$;

CREATE OR REPLACE FUNCTION public.reset_role_permissions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a super admin can reset permissions';
  END IF;
  DELETE FROM public.role_permissions WHERE role IS NOT NULL;
  INSERT INTO public.role_permissions (role, capability, allowed)
  SELECT r.role::public.app_role, d.cap, r.role = ANY(d.roles)
  FROM (VALUES
    ('capture_items',        ARRAY['super_admin','bmd_manager','bmd_field']),
    ('edit_any_item',        ARRAY['super_admin','bmd_manager']),
    ('edit_own_item',        ARRAY['super_admin','bmd_manager','bmd_field']),
    ('delete_item',          ARRAY['super_admin']),
    ('change_assessment',    ARRAY['super_admin','bmd_manager','bmd_field']),
    ('decide_client_items',  ARRAY['super_admin','bmd_manager','client']),
    ('verify_items',         ARRAY['super_admin','bmd_manager','client']),
    ('assign_items',         ARRAY['super_admin','bmd_manager']),
    ('add_photos',           ARRAY['super_admin','bmd_manager','bmd_field','trade']),
    ('comment',              ARRAY['super_admin','bmd_manager','bmd_field','trade','client']),
    ('view_dashboard',       ARRAY['super_admin','bmd_manager','bmd_field','client','viewer']),
    ('view_acceptable_items',ARRAY['super_admin','bmd_manager','bmd_field','client','viewer']),
    ('view_client_notes',    ARRAY['super_admin','bmd_manager','bmd_field','client','viewer']),
    ('export_pdf',           ARRAY['super_admin','bmd_manager','bmd_field','client','viewer']),
    ('export_excel',         ARRAY['super_admin','bmd_manager','bmd_field']),
    ('manage_users',         ARRAY['super_admin','bmd_manager']),
    ('manage_settings',      ARRAY['super_admin','bmd_manager'])
  ) AS d(cap, roles)
  CROSS JOIN (VALUES ('super_admin'),('bmd_manager'),('bmd_field'),('trade'),('client'),('viewer')) AS r(role);
END; $$;

SELECT public.reset_role_permissions();

CREATE OR REPLACE FUNCTION public.role_perm_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.role IN ('super_admin','bmd_admin') THEN NEW.allowed := true; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
CREATE TRIGGER role_perm_lock BEFORE INSERT OR UPDATE ON public.role_permissions
FOR EACH ROW EXECUTE FUNCTION public.role_perm_lock();

-- Client decision note: hidden from roles without view_client_notes
CREATE OR REPLACE FUNCTION public.decision_note(d public.deficiencies)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.has_capability('view_client_notes') THEN d.client_decision_note END;
$$;
GRANT EXECUTE ON FUNCTION public.decision_note(public.deficiencies) TO authenticated;
REVOKE SELECT ON public.deficiencies FROM authenticated;
GRANT SELECT (id, project_id, item_number, location_id, area, material, issue_type, description,
  assessment, status, assigned_to, due_date, is_sample, created_by, created_at, updated_at, closed_at)
  ON public.deficiencies TO authenticated;

-- Users list with last sign-in
CREATE OR REPLACE FUNCTION public.list_users()
RETURNS TABLE(id uuid, email text, full_name text, company text, role public.app_role, last_sign_in_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('manage_users') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
  SELECT p.id, p.email, p.full_name, p.company,
    (SELECT ur.role FROM public.user_roles ur WHERE ur.user_id = p.id ORDER BY ur.created_at LIMIT 1),
    u.last_sign_in_at
  FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id
  ORDER BY p.created_at;
END; $$;

CREATE OR REPLACE FUNCTION public.set_user_role(_user_id uuid, _role public.app_role, _company text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller_super boolean := public.is_super_admin(auth.uid());
BEGIN
  IF NOT public.has_capability('manage_users') THEN RAISE EXCEPTION 'Not allowed to manage users'; END IF;
  IF _role IN ('super_admin','bmd_admin') AND NOT caller_super THEN
    RAISE EXCEPTION 'Only a super admin can grant super admin';
  END IF;
  IF public.is_super_admin(_user_id) AND NOT caller_super THEN
    RAISE EXCEPTION 'Only a super admin can change a super admin';
  END IF;
  IF _user_id = auth.uid() AND caller_super AND _role <> 'super_admin'
     AND (SELECT count(*) FROM public.user_roles WHERE role IN ('super_admin','bmd_admin')) <= 1 THEN
    RAISE EXCEPTION 'You are the last super admin';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
  IF _company IS NOT NULL THEN
    UPDATE public.profiles SET company = nullif(_company,'') WHERE id = _user_id;
  END IF;
END; $$;

-- New users: first = super_admin, invited = invite role, else bmd_field
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _role public.app_role; inv public.user_invites;
BEGIN
  SELECT * INTO inv FROM public.user_invites
   WHERE lower(email) = lower(new.email) AND accepted_at IS NULL
   ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.profiles (id, email, full_name, company)
  VALUES (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), inv.full_name, split_part(new.email,'@',1)),
          inv.company)
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
    _role := 'super_admin';
  ELSIF inv.id IS NOT NULL THEN
    _role := inv.role;
    UPDATE public.user_invites SET accepted_at = now() WHERE id = inv.id;
  ELSE
    _role := 'bmd_field';
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (new.id, _role) ON CONFLICT DO NOTHING;
  RETURN new;
END; $$;

-- Workflow trigger: keep transitions, add capability checks
CREATE OR REPLACE FUNCTION public.def_before_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  allowed public.deficiency_status[];
  uid uuid := auth.uid();
  can_any boolean; can_own boolean; decided boolean;
BEGIN
  new.updated_at := now();

  IF uid IS NOT NULL THEN
    can_any := public.has_capability('edit_any_item');
    can_own := public.has_capability('edit_own_item') AND old.created_by = uid;

    IF (new.area, new.material, new.issue_type, coalesce(new.description,''), new.location_id,
        coalesce(new.due_date::text,''), new.is_sample, new.project_id, new.item_number, coalesce(new.created_by::text,''))
       IS DISTINCT FROM
       (old.area, old.material, old.issue_type, coalesce(old.description,''), old.location_id,
        coalesce(old.due_date::text,''), old.is_sample, old.project_id, old.item_number, coalesce(old.created_by::text,''))
       AND NOT (can_any OR can_own) THEN
      RAISE EXCEPTION 'You do not have permission to edit this item';
    END IF;

    IF coalesce(new.assigned_to::text,'') <> coalesce(old.assigned_to::text,'')
       AND NOT public.has_capability('assign_items') THEN
      RAISE EXCEPTION 'You do not have permission to assign items';
    END IF;

    IF new.assessment <> old.assessment THEN
      IF NOT public.has_capability('change_assessment') OR NOT (can_any OR can_own) THEN
        RAISE EXCEPTION 'You do not have permission to change the assessment';
      END IF;
      IF NOT can_any THEN
        decided := old.status IN ('accepted_as_is','fix_required') OR EXISTS (
          SELECT 1 FROM public.deficiency_events e
          WHERE e.deficiency_id = old.id AND e.event_type = 'status_change' AND e.from_value = 'awaiting_client');
        IF decided THEN
          RAISE EXCEPTION 'The assessment cannot be changed after a client decision';
        END IF;
      END IF;
    END IF;

    IF coalesce(new.client_decision_note,'') <> coalesce(old.client_decision_note,'')
       AND NOT (public.has_capability('decide_client_items') OR can_any) THEN
      RAISE EXCEPTION 'You do not have permission to record client decisions';
    END IF;
  END IF;

  IF new.status <> old.status THEN
    allowed := CASE old.status
      WHEN 'open' THEN ARRAY['awaiting_client','fix_required','in_progress','verified','accepted_as_is']::public.deficiency_status[]
      WHEN 'awaiting_client' THEN ARRAY['accepted_as_is','fix_required','open']::public.deficiency_status[]
      WHEN 'fix_required' THEN ARRAY['in_progress','fixed','open']::public.deficiency_status[]
      WHEN 'in_progress' THEN ARRAY['fixed','fix_required']::public.deficiency_status[]
      WHEN 'fixed' THEN ARRAY['verified','fix_required']::public.deficiency_status[]
      WHEN 'verified' THEN ARRAY['fix_required','open']::public.deficiency_status[]
      WHEN 'accepted_as_is' THEN ARRAY['fix_required','open']::public.deficiency_status[]
    END;
    IF NOT (new.status = ANY(allowed)) THEN
      RAISE EXCEPTION 'Invalid status change: % -> %', old.status, new.status;
    END IF;
    IF new.status = 'fixed' AND NOT EXISTS (
      SELECT 1 FROM public.deficiency_photos p WHERE p.deficiency_id = new.id AND p.kind = 'after'
    ) THEN
      RAISE EXCEPTION 'An "after" photo is required before marking an item fixed';
    END IF;

    IF uid IS NOT NULL THEN
      IF new.status = 'verified' AND NOT public.has_capability('verify_items') THEN
        RAISE EXCEPTION 'You do not have permission to verify items';
      ELSIF old.status = 'awaiting_client' AND new.status IN ('accepted_as_is','fix_required')
            AND NOT public.has_capability('decide_client_items') THEN
        RAISE EXCEPTION 'Only the client (or a manager on their behalf) can decide this item';
      ELSIF new.status IN ('in_progress','fixed')
            AND NOT (public.has_capability('add_photos') OR can_any OR can_own) THEN
        RAISE EXCEPTION 'You do not have permission to update work progress';
      ELSIF new.status = 'accepted_as_is' AND old.status <> 'awaiting_client'
            AND NOT (can_any OR public.has_capability('decide_client_items')) THEN
        RAISE EXCEPTION 'You do not have permission to accept items';
      ELSIF new.status = 'fix_required' AND old.status IN ('fixed','verified','accepted_as_is','in_progress')
            AND NOT (can_any OR public.has_capability('verify_items') OR public.has_capability('decide_client_items')) THEN
        RAISE EXCEPTION 'You do not have permission to reopen items';
      ELSIF new.status IN ('open','awaiting_client') AND NOT (can_any OR can_own) THEN
        RAISE EXCEPTION 'You do not have permission to reopen items';
      END IF;
    END IF;

    IF new.status IN ('verified','accepted_as_is') THEN
      new.closed_at := coalesce(new.closed_at, now());
    ELSE
      new.closed_at := NULL;
    END IF;
  END IF;
  RETURN new;
END; $$;

-- 5. Policies
DROP POLICY IF EXISTS "def read" ON public.deficiencies;
DROP POLICY IF EXISTS "def bmd insert" ON public.deficiencies;
DROP POLICY IF EXISTS "def update" ON public.deficiencies;
DROP POLICY IF EXISTS "def admin delete" ON public.deficiencies;
CREATE POLICY "def read" ON public.deficiencies FOR SELECT TO authenticated
  USING (public.has_capability('view_acceptable_items')
         OR (status IN ('fix_required','in_progress','fixed') AND assessment <> 'acceptable'));
CREATE POLICY "def insert" ON public.deficiencies FOR INSERT TO authenticated
  WITH CHECK (public.has_capability('capture_items'));
CREATE POLICY "def update" ON public.deficiencies FOR UPDATE TO authenticated
  USING (public.has_capability('edit_any_item') OR public.has_capability('edit_own_item')
         OR public.has_capability('add_photos') OR public.has_capability('decide_client_items')
         OR public.has_capability('verify_items') OR public.has_capability('assign_items'));
CREATE POLICY "def delete" ON public.deficiencies FOR DELETE TO authenticated
  USING (public.has_capability('delete_item'));

DROP POLICY IF EXISTS "events read" ON public.deficiency_events;
DROP POLICY IF EXISTS "events insert" ON public.deficiency_events;
CREATE POLICY "events read" ON public.deficiency_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.deficiencies d WHERE d.id = deficiency_id)
         AND (public.has_capability('view_client_notes')
              OR NOT (event_type = 'status_change' AND note IS NOT NULL)));
CREATE POLICY "events insert" ON public.deficiency_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND event_type = 'comment' AND public.has_capability('comment')
              AND EXISTS (SELECT 1 FROM public.deficiencies d WHERE d.id = deficiency_id));

DROP POLICY IF EXISTS "photos read" ON public.deficiency_photos;
DROP POLICY IF EXISTS "photos bmd write" ON public.deficiency_photos;
CREATE POLICY "photos read" ON public.deficiency_photos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.deficiencies d WHERE d.id = deficiency_id));
CREATE POLICY "photos insert" ON public.deficiency_photos FOR INSERT TO authenticated
  WITH CHECK (public.has_capability('add_photos'));
CREATE POLICY "photos update" ON public.deficiency_photos FOR UPDATE TO authenticated
  USING (public.has_capability('edit_any_item') OR uploaded_by = auth.uid());
CREATE POLICY "photos delete" ON public.deficiency_photos FOR DELETE TO authenticated
  USING (public.has_capability('delete_item') OR public.has_capability('edit_any_item'));

DROP POLICY IF EXISTS "floors admin write" ON public.floors;
CREATE POLICY "floors settings write" ON public.floors FOR ALL TO authenticated
  USING (public.has_capability('manage_settings')) WITH CHECK (public.has_capability('manage_settings'));
DROP POLICY IF EXISTS "projects admin write" ON public.projects;
CREATE POLICY "projects settings write" ON public.projects FOR ALL TO authenticated
  USING (public.has_capability('manage_settings')) WITH CHECK (public.has_capability('manage_settings'));
DROP POLICY IF EXISTS "picklists admin write" ON public.pick_lists;
CREATE POLICY "picklists settings write" ON public.pick_lists FOR ALL TO authenticated
  USING (public.has_capability('manage_settings')) WITH CHECK (public.has_capability('manage_settings'));
DROP POLICY IF EXISTS "locations bmd write" ON public.locations;
CREATE POLICY "locations write" ON public.locations FOR ALL TO authenticated
  USING (public.has_capability('manage_settings') OR public.has_capability('capture_items'))
  WITH CHECK (public.has_capability('manage_settings') OR public.has_capability('capture_items'));

DROP POLICY IF EXISTS "admins manage roles" ON public.user_roles;
CREATE POLICY "manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_capability('manage_users')
         AND (public.is_super_admin(auth.uid()) OR role NOT IN ('super_admin','bmd_admin')))
  WITH CHECK (public.has_capability('manage_users')
         AND (public.is_super_admin(auth.uid()) OR role NOT IN ('super_admin','bmd_admin')));

CREATE POLICY "managers update profiles" ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_capability('manage_users'));

CREATE POLICY "perms read" ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "perms super write" ON public.role_permissions FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "invites manage" ON public.user_invites FOR ALL TO authenticated
  USING (public.has_capability('manage_users'))
  WITH CHECK (public.has_capability('manage_users')
         AND (public.is_super_admin(auth.uid()) OR role NOT IN ('super_admin','bmd_admin')));

-- Storage
DROP POLICY IF EXISTS "photos uploadable by bmd" ON storage.objects;
DROP POLICY IF EXISTS "photos deletable by admin" ON storage.objects;
CREATE POLICY "photos uploadable by capability" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deficiency-photos' AND public.has_capability('add_photos'));
CREATE POLICY "photos deletable by capability" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'deficiency-photos' AND (public.has_capability('delete_item') OR public.has_capability('edit_any_item')));