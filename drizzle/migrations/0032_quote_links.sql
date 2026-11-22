-- Private client links to a sent quote. Only a hash of the link's secret is stored; the public pages reach these tables through the server only.
CREATE TABLE IF NOT EXISTS public.quote_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  choices jsonb NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_viewed_at timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.quote_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  link_id uuid REFERENCES public.quote_share_links(id) ON DELETE SET NULL,
  version_id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  choices jsonb NOT NULL DEFAULT '{}',
  value_cents bigint NOT NULL,
  total_cents bigint NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.quote_share_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.quote_acceptances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.quote_share_links, public.quote_acceptances FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT (id, quote_id, created_at, revoked_at, last_viewed_at) ON public.quote_share_links TO authenticated;
--> statement-breakpoint
GRANT SELECT ON public.quote_acceptances TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "quote_share_links read" ON public.quote_share_links;
--> statement-breakpoint
CREATE POLICY "quote_share_links read" ON public.quote_share_links FOR SELECT TO authenticated USING (public.has_capability('view_pricing'));
--> statement-breakpoint
DROP POLICY IF EXISTS "quote_acceptances read" ON public.quote_acceptances;
--> statement-breakpoint
CREATE POLICY "quote_acceptances read" ON public.quote_acceptances FOR SELECT TO authenticated USING (public.has_capability('view_pricing'));
--> statement-breakpoint

-- Staff create a link for a sent quote; the caller supplies only the hash of the secret it generated.
CREATE OR REPLACE FUNCTION public.create_quote_link(_quote uuid, _token_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lid uuid;
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to share quotes'; END IF;
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid link'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quotes WHERE id = _quote AND status = 'sent') THEN RAISE EXCEPTION 'Only a sent quote can be shared by link.'; END IF;
  UPDATE public.quote_share_links SET revoked_at = now() WHERE quote_id = _quote AND revoked_at IS NULL;
  INSERT INTO public.quote_share_links (quote_id, token_hash, created_by) VALUES (_quote, _token_hash, auth.uid()) RETURNING id INTO lid;
  RETURN lid;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.revoke_quote_link(_quote uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability('send_quotes') THEN RAISE EXCEPTION 'Not allowed to share quotes'; END IF;
  UPDATE public.quote_share_links SET revoked_at = now() WHERE quote_id = _quote AND revoked_at IS NULL;
END; $$;
--> statement-breakpoint

-- Records an acceptance made on the client link. Called by the server only, after it has checked the choices and the total against the stored quote.
CREATE OR REPLACE FUNCTION public.accept_quote_public(_link uuid, _version uuid, _name text, _email text, _choices jsonb, _value bigint, _total bigint, _revision int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.quote_share_links; q public.quotes; aid uuid;
BEGIN
  SELECT * INTO l FROM public.quote_share_links WHERE id = _link AND revoked_at IS NULL;
  IF l.id IS NULL THEN RAISE EXCEPTION 'RELOAD: this link is no longer active'; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = l.quote_id FOR UPDATE;
  IF q.status <> 'sent' OR q.revision <> _revision OR NOT (_version = ANY(q.version_ids)) THEN RAISE EXCEPTION 'RELOAD: this quotation has changed'; END IF;
  INSERT INTO public.quote_acceptances (quote_id, link_id, version_id, name, email, choices, value_cents, total_cents)
  VALUES (q.id, l.id, _version, btrim(_name), btrim(_email), coalesce(_choices, '{}'), _value, _total) RETURNING id INTO aid;
  UPDATE public.quote_share_links SET choices = coalesce(_choices, '{}') WHERE id = l.id;
  UPDATE public.quotes SET status = 'accepted', accepted_version_id = _version, accepted_at = now(), accepted_value_cents = _value,
         decision_note = 'Accepted online by ' || btrim(_name) || ' (' || btrim(_email) || ')'
   WHERE id = q.id;
  UPDATE public.estimate_versions SET locked = true, status = CASE WHEN id = _version THEN 'accepted' ELSE 'not_taken' END WHERE id = ANY(q.version_ids);
  IF q.kind = 'quote' THEN
    PERFORM set_config('bmd.stage_note', 'Quote ' || q.number || ' accepted online by ' || btrim(_name), true);
    UPDATE public.projects SET estimated_value_cents = _value,
           stage = CASE WHEN stage IN ('opportunity','estimating','quote_out') THEN 'won'::public.project_stage ELSE stage END
     WHERE id = q.project_id;
    PERFORM set_config('bmd.stage_note', '', true);
  END IF;
  RETURN aid;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_quote_link(uuid, text), public.revoke_quote_link(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_quote_link(uuid, text), public.revoke_quote_link(uuid) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.accept_quote_public(uuid, uuid, text, text, jsonb, bigint, bigint, int) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.accept_quote_public(uuid, uuid, text, text, jsonb, bigint, bigint, int) TO service_role;
