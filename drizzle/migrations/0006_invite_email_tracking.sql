CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER TABLE public.user_invites
  ADD COLUMN IF NOT EXISTS invite_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days');
UPDATE public.user_invites SET status = 'accepted' WHERE accepted_at IS NOT NULL;
ALTER TABLE public.user_invites ADD CONSTRAINT user_invites_status_check CHECK (status IN ('pending','accepted','expired'));
CREATE UNIQUE INDEX IF NOT EXISTS user_invites_token_key ON public.user_invites (invite_token);

-- Mark overdue invites expired (called before listing / sending)
CREATE OR REPLACE FUNCTION public.expire_old_invites()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.user_invites SET status = 'expired'
  WHERE status = 'pending' AND accepted_at IS NULL AND expires_at < now();
$$;
GRANT EXECUTE ON FUNCTION public.expire_old_invites() TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.user_invites;
BEGIN
  SELECT * INTO inv FROM public.user_invites
   WHERE lower(email) = lower(new.email) AND accepted_at IS NULL AND status = 'pending' AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  INSERT INTO public.profiles (id, email, full_name, company)
  VALUES (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), inv.full_name, split_part(new.email,'@',1)), inv.company)
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role IN ('super_admin','bmd_admin')) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'super_admin') ON CONFLICT DO NOTHING;
  END IF;

  FOR inv IN SELECT * FROM public.user_invites
             WHERE lower(email) = lower(new.email) AND accepted_at IS NULL AND status = 'pending' AND expires_at > now() LOOP
    IF inv.role IN ('super_admin','bmd_admin') THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'super_admin') ON CONFLICT DO NOTHING;
    END IF;
    IF inv.project_id IS NOT NULL THEN
      INSERT INTO public.project_members (project_id, user_id, role, added_by)
      VALUES (inv.project_id, new.id, CASE WHEN inv.role = 'bmd_admin' THEN 'super_admin'::public.app_role ELSE inv.role END, inv.invited_by)
      ON CONFLICT (project_id, user_id) DO NOTHING;
    END IF;
    UPDATE public.user_invites SET accepted_at = now(), status = 'accepted' WHERE id = inv.id;
  END LOOP;
  RETURN new;
END; $$;