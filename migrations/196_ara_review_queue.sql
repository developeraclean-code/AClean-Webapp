-- ARA drafts stay separate from delivered messages and financial transactions.
BEGIN;
CREATE TABLE public.wa_ara_reviews (
  id uuid PRIMARY KEY,
  phone text NOT NULL CHECK (phone ~ '^[0-9]{8,15}$'),
  status text NOT NULL DEFAULT 'GENERATING' CHECK (status IN ('GENERATING','PENDING','COPIED','DISMISSED','ACCEPTED','FAILED','UNCERTAIN')),
  reply text NOT NULL DEFAULT '' CHECK (length(reply) <= 4000),
  intent text NOT NULL DEFAULT '',
  reasons jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(reasons)='array'),
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text
);
CREATE INDEX wa_ara_reviews_pending ON public.wa_ara_reviews(phone,created_at DESC) WHERE status IN ('GENERATING','PENDING','FAILED','UNCERTAIN');
ALTER TABLE public.wa_ara_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY ara_review_read ON public.wa_ara_reviews FOR SELECT TO authenticated USING (public.get_my_role() IN ('Owner','Admin'));
REVOKE ALL ON public.wa_ara_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.wa_ara_reviews TO authenticated;
GRANT ALL ON public.wa_ara_reviews TO service_role;

CREATE FUNCTION public.resolve_ara_review(p_id uuid,p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE item public.wa_ara_reviews%ROWTYPE; actor text;
BEGIN
  IF coalesce(public.get_my_role(),'') NOT IN ('Owner','Admin') THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('COPIED','DISMISSED') THEN RAISE EXCEPTION 'Status tinjau tidak valid'; END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid();
  SELECT * INTO item FROM public.wa_ara_reviews WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draf tidak ditemukan'; END IF;
  IF item.status<> 'PENDING' THEN RAISE EXCEPTION 'Draf telah ditinjau admin lain atau belum siap. Muat ulang.' USING ERRCODE='40001'; END IF;
  UPDATE public.wa_ara_reviews SET status=p_status,reviewed_at=now(),reviewed_by=coalesce(actor,'Admin') WHERE id=p_id RETURNING * INTO item;
  RETURN to_jsonb(item);
END $$;
REVOKE ALL ON FUNCTION public.resolve_ara_review(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_ara_review(uuid,text) TO authenticated;

-- Default review-only. Existing chatbot enablement and customer data are untouched.
INSERT INTO public.app_settings(key,value) VALUES ('wa_ara_mode','review') ON CONFLICT (key) DO NOTHING;
COMMIT;
