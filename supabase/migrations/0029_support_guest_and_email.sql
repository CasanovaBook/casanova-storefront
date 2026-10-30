-- ============================================================
-- 0029 - Support for guests, email replies and account linking
--
-- WHY
--
-- 0018 gave the ticket table a single authenticated write path
-- (`create_my_inquiry`) and 0019/0021 did the same for conversations.
-- That left three gaps this migration closes:
--
--   1. A visitor without an account could not open a ticket at all. The
--      public form silently wrote a browser-local row the support queue on
--      another device could never see.
--   2. A support reply was never emailed, and a reply sent by email had no
--      way back into the conversation.
--   3. A guest ticket stayed orphaned forever: `user_id` was NULL, and the
--      customer RLS policy (`user_id = auth.uid()`) could never match it
--      after that visitor registered with the same address.
--
-- WHAT
--
--   • `create_guest_inquiry(...)` - SECURITY DEFINER, executable ONLY by
--     service_role. The `support-inquiry` Edge Function validates the
--     request, verifies Turnstile and rate limits before calling it. The
--     function stamps the ticket number from the same sequence 0018 uses,
--     trims/validates every field and links `user_id` when the address
--     already belongs to a registered account.
--   • `claim_my_inquiries()` - executable by authenticated sessions only.
--     Links every unowned ticket whose customer_email matches the caller's
--     profile email, and re-attributes email-origin notes on those tickets
--     to the account. Called by the storefront after login/registration, so
--     "היסטוריה זמינה אחרי התחברות" becomes true.
--   • `support_inbound_reply(...)` - SECURITY DEFINER, executable ONLY by
--     service_role. The `support-inbound` Edge Function parses a provider
--     webhook and calls this with the ticket number and sender. The sender
--     MUST match the ticket's customer_email; the note is stored as
--     customer-visible with `author_email` recorded (author_id when the
--     ticket is linked) and the ticket reopens if it was waiting.
--   • `inquiry_notes.author_id` becomes nullable and `author_email` is
--     added, because an unlinked guest reply has no `public.users` row to
--     point at. Existing rows are untouched.
--
-- APPLY, THEN VERIFY
--
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('create_guest_inquiry','claim_my_inquiries',
--                      'support_inbound_reply');
--    → three rows.
--
--   -- As service_role:
--   SELECT create_guest_inquiry('Dana','dana@example.com','נושא','הודעה ארוכה');
--    → INQ-2026-0001…
--
--   -- As an authenticated user whose public.users.email is dana@example.com:
--   SELECT claim_my_inquiries();   -- → 1 (or more)
--   SELECT count(*) FROM inquiries WHERE user_id = auth.uid();
--
--   -- As service_role, with the ticket number from the first call:
--   SELECT support_inbound_reply('INQ-2026-0001','dana@example.com','תודה');
--    → a customer-visible note; replay with another address raises
--      sender_mismatch.
-- ============================================================

BEGIN;

-- ── 1. Notes can carry a guest author ───────────────────────

ALTER TABLE public.inquiry_notes
  ALTER COLUMN author_id DROP NOT NULL;

ALTER TABLE public.inquiry_notes
  ADD COLUMN IF NOT EXISTS author_email VARCHAR(255);

COMMENT ON COLUMN public.inquiry_notes.author_email IS
  'Sender address for notes that arrived by email from a guest without a users row.';

-- Guest tickets are linked by address, so that lookup needs an index that
-- only covers the unclaimed rows.
CREATE INDEX IF NOT EXISTS idx_inquiries_unclaimed_email
  ON public.inquiries (lower(customer_email))
  WHERE user_id IS NULL;

-- ── 2. create_guest_inquiry() - the public write path ───────
-- Called by the support-inquiry Edge Function with the service role. The
-- function is the validation/CAPTCHA/rate-limit boundary; this one is the
-- atomic database write. Nothing here trusts a client-supplied user id.

CREATE OR REPLACE FUNCTION public.create_guest_inquiry(
  p_name     text,
  p_email    text,
  p_subject  text,
  p_message  text,
  p_phone    text DEFAULT NULL,
  p_topic    text DEFAULT 'GENERAL'
)
RETURNS public.inquiries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email   text := lower(btrim(COALESCE(p_email, '')));
  v_name    text := btrim(COALESCE(p_name, ''));
  v_subject text := btrim(COALESCE(p_subject, ''));
  v_message text := btrim(COALESCE(p_message, ''));
  v_phone   text := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_user_id uuid;
  v_inquiry public.inquiries;
BEGIN
  IF v_name = '' OR length(v_name) > 200 THEN
    RAISE EXCEPTION 'validation_name';
  END IF;

  IF v_email = ''
     OR length(v_email) > 255
     OR v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'validation_email';
  END IF;

  IF v_phone IS NOT NULL AND length(v_phone) > 50 THEN
    RAISE EXCEPTION 'validation_phone';
  END IF;

  IF v_subject = '' OR length(v_subject) > 255 THEN
    RAISE EXCEPTION 'validation_subject';
  END IF;

  IF length(v_message) < 10 OR length(v_message) > 20000 THEN
    RAISE EXCEPTION 'validation_message';
  END IF;

  -- A registered address gets its ticket attached immediately; the claim
  -- function below covers the opposite order (ticket first, account later).
  SELECT u.user_id INTO v_user_id
    FROM public.users u
   WHERE lower(u.email) = v_email
   LIMIT 1;

  INSERT INTO public.inquiries (
    ticket_number,
    customer_name,
    customer_email,
    customer_phone,
    subject,
    message,
    topic,
    status,
    source,
    user_id
  ) VALUES (
    'INQ-' || to_char(now(), 'YYYY') || '-'
      || lpad(nextval('public.inquiry_ticket_seq')::text, 4, '0'),
    v_name,
    v_email,
    v_phone,
    v_subject,
    v_message,
    CASE
      WHEN p_topic IN ('GENERAL','ORDER','REFUND','ACCESS','BILLING','TECHNICAL')
        THEN p_topic
      ELSE 'GENERAL'
    END,
    'NEW',
    'WEBSITE',
    v_user_id
  )
  RETURNING * INTO v_inquiry;

  RETURN v_inquiry;
END;
$$;

REVOKE ALL ON FUNCTION public.create_guest_inquiry(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_guest_inquiry(text, text, text, text, text, text) TO service_role;

-- ── 3. claim_my_inquiries() - history follows the account ───

CREATE OR REPLACE FUNCTION public.claim_my_inquiries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT lower(u.email) INTO v_email
    FROM public.users u
   WHERE u.user_id = v_uid;

  IF v_email IS NULL OR v_email = '' THEN
    RETURN 0;
  END IF;

  UPDATE public.inquiries
     SET user_id = v_uid,
         updated_at = now()
   WHERE user_id IS NULL
     AND lower(customer_email) = v_email;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Email-origin notes on the claimed tickets become the customer's own
  -- messages, so the reply-limit logic and the "mine" styling agree with
  -- what the customer actually wrote.
  UPDATE public.inquiry_notes n
     SET author_id = v_uid
    FROM public.inquiries i
   WHERE n.inquiry_id = i.inquiry_id
     AND i.user_id = v_uid
     AND n.author_id IS NULL
     AND lower(COALESCE(n.author_email, '')) = v_email;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_my_inquiries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_my_inquiries() TO authenticated;

-- ── 4. support_inbound_reply() - email replies into the thread ──

CREATE OR REPLACE FUNCTION public.support_inbound_reply(
  p_ticket_number text,
  p_from_email    text,
  p_content       text
)
RETURNS public.inquiry_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket  text := upper(btrim(COALESCE(p_ticket_number, '')));
  v_from    text := lower(btrim(COALESCE(p_from_email, '')));
  v_content text := btrim(COALESCE(p_content, ''));
  v_inquiry public.inquiries;
  v_note    public.inquiry_notes;
BEGIN
  IF v_ticket = '' THEN
    RAISE EXCEPTION 'ticket_missing';
  END IF;

  IF v_content = '' OR length(v_content) > 20000 THEN
    RAISE EXCEPTION 'validation_content';
  END IF;

  SELECT * INTO v_inquiry
    FROM public.inquiries
   WHERE upper(ticket_number) = v_ticket;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inquiry_missing';
  END IF;

  -- Only the address that opened the ticket may post to it. This is what
  -- stops a forwarded or guessed ticket number from injecting a message.
  IF v_from = '' OR v_from <> lower(v_inquiry.customer_email) THEN
    RAISE EXCEPTION 'sender_mismatch';
  END IF;

  INSERT INTO public.inquiry_notes (
    inquiry_id,
    author_id,
    author_email,
    content,
    internal
  ) VALUES (
    v_inquiry.inquiry_id,
    v_inquiry.user_id,
    v_from,
    v_content,
    FALSE
  )
  RETURNING * INTO v_note;

  UPDATE public.inquiries
     SET status = CASE
       WHEN status IN ('NEW', 'WAITING_FOR_CUSTOMER') THEN 'OPEN'
       ELSE status
     END
   WHERE inquiry_id = v_inquiry.inquiry_id;

  RETURN v_note;
END;
$$;

REVOKE ALL ON FUNCTION public.support_inbound_reply(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_inbound_reply(text, text, text) TO service_role;

COMMIT;