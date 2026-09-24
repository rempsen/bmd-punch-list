-- Multi-project: membership, per-project roles, per-project pick lists and invites
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE TABLE public.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  added_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
GRANT SELECT ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

INSERT INTO public.project_members (project_id, user_id, role, added_by)
SELECT p.id, ur.user_id,
       CASE WHEN ur.role = 'bmd_admin' THEN 'super_admin'::public.app_role ELSE ur.role END, NULL
FROM public.user_roles ur CROSS JOIN public.projects p
ON CONFLICT (project_id, user_id) DO NOTHING;
COMMENT ON TABLE public.user_roles IS 'Only super_admin rows are meaningful (global flag). Per-project roles live in project_members.';

ALTER TABLE public.pick_lists ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;
UPDATE public.pick_lists SET project_id = (SELECT id FROM public.projects ORDER BY created_at LIMIT 1) WHERE project_id IS NULL;
CREATE INDEX IF NOT EXISTS pick_lists_project_idx ON public.pick_lists (project_id, kind);

ALTER TABLE public.user_invites ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;
UPDATE public.user_invites SET project_id = (SELECT id FROM public.projects ORDER BY created_at LIMIT 1) WHERE project_id IS NULL;
DROP INDEX IF EXISTS public.user_invites_email_open;
CREATE UNIQUE INDEX user_invites_email_project_open ON public.user_invites (lower(email), project_id) WHERE accepted_at IS NULL;

CREATE OR REPLACE FUNCTION public.is_project_member(_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(auth.uid())
      OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = _project AND m.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_capability(_capability text, _project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.project_members m
    JOIN public.role_permissions rp ON rp.role = m.role AND rp.capability = _capability AND rp.allowed
    WHERE m.project_id = _project AND m.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_capability(_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.project_members m
    JOIN public.role_permissions rp ON rp.role = m.role AND rp.capability = _capability AND rp.allowed
    WHERE m.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.location_project(_loc uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.project_id FROM public.locations l JOIN public.floors f ON f.id = l.floor_id WHERE l.id = _loc;
$$;
CREATE OR REPLACE FUNCTION public.floor_project(_floor uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT project_id FROM public.floors WHERE id = _floor;
$$;
CREATE OR REPLACE FUNCTION public.deficiency_project(_def uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT project_id FROM public.deficiencies WHERE id = _def;
$$;
CREATE OR REPLACE FUNCTION public.photo_path_project(_name text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE seg text := split_part(_name, '/', 1);
BEGIN
  IF seg !~ '^[0-9a-f-]{36}$' THEN RETURN NULL; END IF;
  RETURN (SELECT project_id FROM public.deficiencies WHERE id = seg::uuid);
END; $$;

CREATE OR REPLACE FUNCTION public.seed_project_pick_lists()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.pick_lists (project_id, kind, value, sort_order)
  SELECT new.id, v.kind::public.pick_kind, v.value, v.ord
  FROM (VALUES
    ('area','Entry / vestibule',1),('area','Main room',2),('area','Closet',3),
    ('area','Bathroom – shower walls',4),('area','Bathroom – vanity wall',5),
    ('area','Bathroom – general wall tile',6),('area','Bathroom – floor',7),('area','Corridor',8),('area','Other',9),
    ('material','Vinyl plank',1),('material','Floor tile',2),('material','Wall tile',3),('material','Carpet',4),
    ('material','Wall base',5),('material','Transition / trim',6),('material','Grout & caulk',7),
    ('issue_type','Lippage',1),('issue_type','Chipped / cracked',2),('issue_type','Hollow tile',3),
    ('issue_type','Grout inconsistent / missing',4),('issue_type','Caulking missing or poor',5),
    ('issue_type','Exposed cut edge',6),('issue_type','Gap / open joint',7),('issue_type','Scratched / gouged',8),
    ('issue_type','Lifting / peaking',9),('issue_type','Stain / discoloration',10),
    ('issue_type','Layout / pattern misaligned',11),('issue_type','Missing piece',12),('issue_type','Visible seam',13),
    ('issue_type','Loose base',14),('issue_type','Other',15)
  ) AS v(kind, value, ord);
  RETURN new;
END; $$;
CREATE TRIGGER projects_seed_pick_lists AFTER INSERT ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.seed_project_pick_lists();

CREATE OR REPLACE FUNCTION public.create_project(_name text, _client text, _address text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; my_role public.app_role;
BEGIN
  IF NOT public.has_capability('manage_settings') THEN RAISE EXCEPTION 'Not allowed to create jobs'; END IF;
  IF coalesce(trim(_name),'') = '' THEN RAISE EXCEPTION 'Job name is required'; END IF;
  INSERT INTO public.projects (name, client_name, address)
  VALUES (trim(_name), nullif(trim(_client),''), nullif(trim(_address),'')) RETURNING id INTO pid;
  IF NOT public.is_super_admin(auth.uid()) THEN
    SELECT m.role INTO my_role FROM public.project_members m
      JOIN public.role_permissions rp ON rp.role = m.role AND rp.capability = 'manage_settings' AND rp.allowed
      WHERE m.user_id = auth.uid() LIMIT 1;
    INSERT INTO public.project_members (project_id, user_id, role, added_by) VALUES (pid, auth.uid(), my_role, auth.uid());
  END IF;
  RETURN pid;
END; $$;

CREATE OR REPLACE FUNCTION public.my_projects()
RETURNS TABLE(id uuid, name text, client_name text, address text, archived_at timestamptz, role public.app_role, open_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.client_name, p.address, p.archived_at,
    CASE WHEN public.is_super_admin(auth.uid()) THEN 'super_admin'::public.app_role
         ELSE (SELECT m.role FROM public.project_members m WHERE m.project_id = p.id AND m.user_id = auth.uid()) END,
    (SELECT count(*) FROM public.deficiencies d WHERE d.project_id = p.id AND d.status NOT IN ('verified','accepted_as_is'))
  FROM public.projects p
  WHERE public.is_project_member(p.id)
  ORDER BY p.archived_at NULLS FIRST, p.created_at;
$$;

DROP FUNCTION IF EXISTS public.list_users();
CREATE OR REPLACE FUNCTION public.list_users(_project uuid)
RETURNS TABLE(id uuid, email text, full_name text, company text, role public.app_role, is_super boolean, last_sign_in_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _project IS NULL THEN
    IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  ELSIF NOT public.has_capability('manage_users', _project) THEN RAISE EXCEPTION 'Not allowed';
  END IF;
  RETURN QUERY
  SELECT p.id, p.email, p.full_name, p.company,
    CASE WHEN _project IS NULL THEN NULL ELSE m.role END,
    public.is_super_admin(p.id), u.last_sign_in_at
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.project_members m ON m.user_id = p.id AND m.project_id = _project
  WHERE _project IS NULL OR m.id IS NOT NULL
  ORDER BY p.created_at;
END; $$;

CREATE OR REPLACE FUNCTION public.set_member_role(_project uuid, _user_id uuid, _role public.app_role, _company text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller_super boolean := public.is_super_admin(auth.uid());
BEGIN
  IF NOT public.has_capability('manage_users', _project) THEN RAISE EXCEPTION 'Not allowed to manage users'; END IF;
  IF _role IN ('super_admin','bmd_admin') AND NOT caller_super THEN RAISE EXCEPTION 'Only a super admin can grant super admin'; END IF;
  IF public.is_super_admin(_user_id) AND NOT caller_super THEN RAISE EXCEPTION 'Only a super admin can change a super admin'; END IF;
  IF _role = 'bmd_admin' THEN _role := 'super_admin'; END IF;

  IF _role = 'super_admin' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'super_admin') ON CONFLICT DO NOTHING;
  ELSIF public.is_super_admin(_user_id) THEN
    IF _user_id = auth.uid() AND (SELECT count(DISTINCT user_id) FROM public.user_roles WHERE role IN ('super_admin','bmd_admin')) <= 1 THEN
      RAISE EXCEPTION 'You are the last super admin';
    END IF;
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role IN ('super_admin','bmd_admin');
  END IF;

  INSERT INTO public.project_members (project_id, user_id, role, added_by)
  VALUES (_project, _user_id, _role, auth.uid())
  ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role;
  IF _company IS NOT NULL THEN UPDATE public.profiles SET company = nullif(_company,'') WHERE id = _user_id; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.add_member_by_email(_project uuid, _email text, _role public.app_role)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  IF NOT public.has_capability('manage_users', _project) THEN RAISE EXCEPTION 'Not allowed to manage users'; END IF;
  SELECT id INTO uid FROM public.profiles WHERE lower(email) = lower(trim(_email)) LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'No account with that email yet — send an invite instead'; END IF;
  PERFORM public.set_member_role(_project, uid, _role, NULL);
  RETURN uid;
END; $$;

CREATE OR REPLACE FUNCTION public.remove_member(_project uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('manage_users', _project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF public.is_super_admin(_user_id) AND NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Only a super admin can remove a super admin'; END IF;
  DELETE FROM public.project_members WHERE project_id = _project AND user_id = _user_id;
END; $$;

CREATE OR REPLACE FUNCTION public.set_user_role(_user_id uuid, _role public.app_role, _company text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Only a super admin can change global roles'; END IF;
  IF _role IN ('super_admin','bmd_admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'super_admin') ON CONFLICT DO NOTHING;
  ELSE
    IF _user_id = auth.uid() AND (SELECT count(DISTINCT user_id) FROM public.user_roles WHERE role IN ('super_admin','bmd_admin')) <= 1 THEN
      RAISE EXCEPTION 'You are the last super admin';
    END IF;
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role IN ('super_admin','bmd_admin');
  END IF;
  IF _company IS NOT NULL THEN UPDATE public.profiles SET company = nullif(_company,'') WHERE id = _user_id; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.user_invites;
BEGIN
  SELECT * INTO inv FROM public.user_invites
   WHERE lower(email) = lower(new.email) AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 1;
  INSERT INTO public.profiles (id, email, full_name, company)
  VALUES (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), inv.full_name, split_part(new.email,'@',1)), inv.company)
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role IN ('super_admin','bmd_admin')) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'super_admin') ON CONFLICT DO NOTHING;
  END IF;

  FOR inv IN SELECT * FROM public.user_invites WHERE lower(email) = lower(new.email) AND accepted_at IS NULL LOOP
    IF inv.role IN ('super_admin','bmd_admin') THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'super_admin') ON CONFLICT DO NOTHING;
    END IF;
    IF inv.project_id IS NOT NULL THEN
      INSERT INTO public.project_members (project_id, user_id, role, added_by)
      VALUES (inv.project_id, new.id, CASE WHEN inv.role = 'bmd_admin' THEN 'super_admin'::public.app_role ELSE inv.role END, inv.invited_by)
      ON CONFLICT (project_id, user_id) DO NOTHING;
    END IF;
    UPDATE public.user_invites SET accepted_at = now() WHERE id = inv.id;
  END LOOP;
  RETURN new;
END; $$;

CREATE OR REPLACE FUNCTION public.decision_notes(_ids uuid[])
RETURNS TABLE(id uuid, note text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.client_decision_note FROM public.deficiencies d
  WHERE d.id = ANY(_ids) AND d.client_decision_note IS NOT NULL
    AND public.has_capability('view_client_notes', d.project_id);
$$;
CREATE OR REPLACE FUNCTION public.decision_note(d public.deficiencies)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.has_capability('view_client_notes', d.project_id) THEN d.client_decision_note END;
$$;

CREATE OR REPLACE FUNCTION public.def_before_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  allowed public.deficiency_status[];
  uid uuid := auth.uid();
  can_any boolean; can_own boolean; decided boolean;
BEGIN
  new.updated_at := now();

  IF uid IS NOT NULL THEN
    can_any := public.has_capability('edit_any_item', old.project_id);
    can_own := public.has_capability('edit_own_item', old.project_id) AND old.created_by = uid;

    IF (new.area, new.material, new.issue_type, coalesce(new.description,''), new.location_id,
        coalesce(new.due_date::text,''), new.is_sample, new.project_id, new.item_number, coalesce(new.created_by::text,''))
       IS DISTINCT FROM
       (old.area, old.material, old.issue_type, coalesce(old.description,''), old.location_id,
        coalesce(old.due_date::text,''), old.is_sample, old.project_id, old.item_number, coalesce(old.created_by::text,''))
       AND NOT (can_any OR can_own) THEN
      RAISE EXCEPTION 'You do not have permission to edit this item';
    END IF;

    IF new.project_id <> old.project_id THEN
      RAISE EXCEPTION 'Items cannot be moved to another job';
    END IF;

    IF coalesce(new.assigned_to::text,'') <> coalesce(old.assigned_to::text,'')
       AND NOT public.has_capability('assign_items', old.project_id) THEN
      RAISE EXCEPTION 'You do not have permission to assign items';
    END IF;

    IF new.assessment <> old.assessment THEN
      IF NOT public.has_capability('change_assessment', old.project_id) OR NOT (can_any OR can_own) THEN
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
       AND NOT (public.has_capability('decide_client_items', old.project_id) OR can_any) THEN
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
      IF new.status = 'verified' AND NOT public.has_capability('verify_items', old.project_id) THEN
        RAISE EXCEPTION 'You do not have permission to verify items';
      ELSIF old.status = 'awaiting_client' AND new.status IN ('accepted_as_is','fix_required')
            AND NOT public.has_capability('decide_client_items', old.project_id) THEN
        RAISE EXCEPTION 'Only the client (or a manager on their behalf) can decide this item';
      ELSIF new.status IN ('in_progress','fixed')
            AND NOT (public.has_capability('add_photos', old.project_id) OR can_any OR can_own) THEN
        RAISE EXCEPTION 'You do not have permission to update work progress';
      ELSIF new.status = 'accepted_as_is' AND old.status <> 'awaiting_client'
            AND NOT (can_any OR public.has_capability('decide_client_items', old.project_id)) THEN
        RAISE EXCEPTION 'You do not have permission to accept items';
      ELSIF new.status = 'fix_required' AND old.status IN ('fixed','verified','accepted_as_is','in_progress')
            AND NOT (can_any OR public.has_capability('verify_items', old.project_id) OR public.has_capability('decide_client_items', old.project_id)) THEN
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

CREATE POLICY "members read" ON public.project_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_project_member(project_id));

DROP POLICY IF EXISTS "projects read" ON public.projects;
DROP POLICY IF EXISTS "projects settings write" ON public.projects;
CREATE POLICY "projects read" ON public.projects FOR SELECT TO authenticated USING (public.is_project_member(id));
CREATE POLICY "projects update" ON public.projects FOR UPDATE TO authenticated
  USING (public.has_capability('manage_settings', id)) WITH CHECK (public.has_capability('manage_settings', id));
CREATE POLICY "projects delete" ON public.projects FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "floors read" ON public.floors;
DROP POLICY IF EXISTS "floors settings write" ON public.floors;
CREATE POLICY "floors read" ON public.floors FOR SELECT TO authenticated USING (public.is_project_member(project_id));
CREATE POLICY "floors write" ON public.floors FOR ALL TO authenticated
  USING (public.has_capability('manage_settings', project_id)) WITH CHECK (public.has_capability('manage_settings', project_id));

DROP POLICY IF EXISTS "locations read" ON public.locations;
DROP POLICY IF EXISTS "locations write" ON public.locations;
CREATE POLICY "locations read" ON public.locations FOR SELECT TO authenticated
  USING (public.is_project_member(public.floor_project(floor_id)));
CREATE POLICY "locations write" ON public.locations FOR ALL TO authenticated
  USING (public.has_capability('manage_settings', public.floor_project(floor_id)) OR public.has_capability('capture_items', public.floor_project(floor_id)))
  WITH CHECK (public.has_capability('manage_settings', public.floor_project(floor_id)) OR public.has_capability('capture_items', public.floor_project(floor_id)));

DROP POLICY IF EXISTS "picklists read" ON public.pick_lists;
DROP POLICY IF EXISTS "picklists settings write" ON public.pick_lists;
CREATE POLICY "picklists read" ON public.pick_lists FOR SELECT TO authenticated USING (public.is_project_member(project_id));
CREATE POLICY "picklists write" ON public.pick_lists FOR ALL TO authenticated
  USING (public.has_capability('manage_settings', project_id)) WITH CHECK (public.has_capability('manage_settings', project_id));

DROP POLICY IF EXISTS "def read" ON public.deficiencies;
DROP POLICY IF EXISTS "def insert" ON public.deficiencies;
DROP POLICY IF EXISTS "def update" ON public.deficiencies;
DROP POLICY IF EXISTS "def delete" ON public.deficiencies;
CREATE POLICY "def read" ON public.deficiencies FOR SELECT TO authenticated
  USING (public.is_project_member(project_id) AND (public.has_capability('view_acceptable_items', project_id)
         OR (status IN ('fix_required','in_progress','fixed') AND assessment <> 'acceptable')));
CREATE POLICY "def insert" ON public.deficiencies FOR INSERT TO authenticated
  WITH CHECK (public.has_capability('capture_items', project_id) AND public.location_project(location_id) = project_id);
CREATE POLICY "def update" ON public.deficiencies FOR UPDATE TO authenticated
  USING (public.has_capability('edit_any_item', project_id) OR public.has_capability('edit_own_item', project_id)
         OR public.has_capability('add_photos', project_id) OR public.has_capability('decide_client_items', project_id)
         OR public.has_capability('verify_items', project_id) OR public.has_capability('assign_items', project_id))
  WITH CHECK (public.location_project(location_id) = project_id);
CREATE POLICY "def delete" ON public.deficiencies FOR DELETE TO authenticated
  USING (public.has_capability('delete_item', project_id));

DROP POLICY IF EXISTS "events read" ON public.deficiency_events;
DROP POLICY IF EXISTS "events insert" ON public.deficiency_events;
CREATE POLICY "events read" ON public.deficiency_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.deficiencies d WHERE d.id = deficiency_id)
         AND (public.has_capability('view_client_notes', public.deficiency_project(deficiency_id))
              OR NOT (event_type = 'status_change' AND note IS NOT NULL)));
CREATE POLICY "events insert" ON public.deficiency_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND event_type = 'comment'
              AND public.has_capability('comment', public.deficiency_project(deficiency_id))
              AND EXISTS (SELECT 1 FROM public.deficiencies d WHERE d.id = deficiency_id));

DROP POLICY IF EXISTS "photos read" ON public.deficiency_photos;
DROP POLICY IF EXISTS "photos insert" ON public.deficiency_photos;
DROP POLICY IF EXISTS "photos update" ON public.deficiency_photos;
DROP POLICY IF EXISTS "photos delete" ON public.deficiency_photos;
CREATE POLICY "photos read" ON public.deficiency_photos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.deficiencies d WHERE d.id = deficiency_id));
CREATE POLICY "photos insert" ON public.deficiency_photos FOR INSERT TO authenticated
  WITH CHECK (public.has_capability('add_photos', public.deficiency_project(deficiency_id)));
CREATE POLICY "photos update" ON public.deficiency_photos FOR UPDATE TO authenticated
  USING (public.has_capability('edit_any_item', public.deficiency_project(deficiency_id))
         OR (uploaded_by = auth.uid() AND public.is_project_member(public.deficiency_project(deficiency_id))));
CREATE POLICY "photos delete" ON public.deficiency_photos FOR DELETE TO authenticated
  USING (public.has_capability('delete_item', public.deficiency_project(deficiency_id))
         OR public.has_capability('edit_any_item', public.deficiency_project(deficiency_id)));

DROP POLICY IF EXISTS "invites manage" ON public.user_invites;
CREATE POLICY "invites manage" ON public.user_invites FOR ALL TO authenticated
  USING (public.has_capability('manage_users', project_id))
  WITH CHECK (project_id IS NOT NULL AND public.has_capability('manage_users', project_id)
         AND (public.is_super_admin(auth.uid()) OR role NOT IN ('super_admin','bmd_admin')));

DROP POLICY IF EXISTS "manage roles" ON public.user_roles;
CREATE POLICY "super manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "photos readable by authenticated" ON storage.objects;
DROP POLICY IF EXISTS "photos uploadable by capability" ON storage.objects;
DROP POLICY IF EXISTS "photos deletable by capability" ON storage.objects;
CREATE POLICY "photos readable by job members" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'deficiency-photos' AND public.is_project_member(public.photo_path_project(name)));
CREATE POLICY "photos uploadable by capability" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deficiency-photos' AND public.has_capability('add_photos', public.photo_path_project(name)));
CREATE POLICY "photos deletable by capability" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'deficiency-photos' AND (public.has_capability('delete_item', public.photo_path_project(name))
         OR public.has_capability('edit_any_item', public.photo_path_project(name))));