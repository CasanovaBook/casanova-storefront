-- ============================================================
-- 0018 — Support inquiries: authoritative identity, RLS, realtime
--
-- WHY
--
-- Support tickets lived only in the browser's local document: a customer
-- submitting from /dashboard/support wrote a row the admin dashboard on
-- any other device could never see. `public.inquiries` (schema.sql) is the
-- shared queue both sides of the flow were meant to read, but it had no
-- RLS and no client write path, so nothing ever landed in it.
--
-- This migration gives the table its access rules and a single customer
-- write path:
--
--   • Customers read only their own tickets (user_id = auth.uid()).
--   • Customers never INSERT directly. The only customer write path is
--     `create_my_inquiry()`, a SECURITY DEFINER function that stamps
--     user_id, customer_name and customer_email from the authenticated
--     profile — so a crafted request cannot open a ticket under another
--     account's name or address.
--   • Staff (`is_admin()`, the same predicate the live users/entitlement
--     policies use) read the whole queue and move tickets through their
--     lifecycle (status, assignment, linkage).
--   • The table joins the supabase_realtime publication (0017 pattern) so
--     a new or re-statused ticket reaches the other side of the flow
--     within seconds, without a manual refresh.
--
-- NOTE
--
-- `public.inquiry_notes` remains client-local for this change (internal
-- staff annotations are a per-browser record today and are not part of
-- the customer↔admin sync requirements). Anonymous (signed-out) public
-- form submissions also remain client-local: there is no authenticated
-- identity to stamp, and an unauthenticated insert path would be an open
-- spam surface.
--
-- APPLY, THEN VERIFY
--
--    SELECT policyname, cmd, roles FROM pg_policies
--     WHERE schemaname = 'public' AND tablename = 'inquiries'
--     ORDER BY policyname;
--     → inquiries_select_own   | SELECT | {authenticated}
--       inquiries_select_staff | SELECT | {authenticated}
--       inquiries_update_staff | UPDATE | {authenticated}
--       inquiries_insert_staff | INSERT | {authenticated}
--
--    SELECT pubname, schemaname, tablename
--      FROM pg_publication_tables
--     WHERE tablename = 'inquiries';
--    Expect one row: supabase_realtime | public | inquiries.
--
--    From an authenticated session for user A, confirm events for user
--    B's rows do NOT arrive (RLS filtering) while A's own do:
--
--      SELECT pubname, schemaname, tablename
--        FROM pg_publication_tables
--       WHERE tablename = 'inquiries';
--
--    And a customer cannot write the table directly:
--
--      SET ROLE authenticated;
--      SET request.jwt.claims = '{"sub":"<user A uuid>","role":"authenticated"}';
--      INSERT INTO public.inquiries (ticket_number, customer_name,
--        customer_email, subject, message) VALUES ('X','X','X','X','X');
--      -- ERROR: new row violates row-level security policy (no INSERT
--      -- policy for non-staff; only create_my_inquiry may insert).
--      RESET ROLE;
-- ============================================================

BEGIN;

-- ── 1. Row Level Security ───────────────────────────────────

ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;

-- Customers read their own tickets only.
DROP POLICY IF EXISTS inquiries_select_own ON public.inquiries;
CREATE POLICY inquiries_select_own ON public.inquiries
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Staff read the whole queue. is_admin() is the live staff predicate the
-- users/entitlement policies already rely on (see migrations 0005, 0011,
-- 0015 headers).
DROP POLICY IF EXISTS inquiries_select_staff ON public.inquiries;
CREATE POLICY inquiries_select_staff ON public.inquiries
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Staff move tickets through their lifecycle (status, assignment, order
-- linkage, topic/subject corrections). The chk_inquiry_resolution
-- constraint and trg_inquiry_assignee_is_staff still apply.
DROP POLICY IF EXISTS inquiries_update_staff ON public.inquiries;
CREATE POLICY inquiries_update_staff ON public.inquiries
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Staff may log a phone ticket directly (source = 'CMS', with the caller's
-- details entered by hand). Customers have no INSERT policy: their only
-- write path is create_my_inquiry() below.
DROP POLICY IF EXISTS inquiries_insert_staff ON public.inquiries;
CREATE POLICY inquiries_insert_staff ON public.inquiries
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- No DELETE policy anywhere: nothing in the product deletes tickets, and
-- no browser role should be able to.
--
-- The table previously had RLS disabled; anon connections therefore lose
-- direct table access entirely (they never had a legitimate use for it).

REVOKE ALL ON public.inquiries FROM anon;

-- ── 2. Ticket numbers ───────────────────────────────────────
-- `ticket_number` is UNIQUE NOT NULL with no default, and every writer so
-- far supplied it from a per-browser counter. A real sequence makes the
-- server-generated numbers collision-free and monotonic.

CREATE SEQUENCE IF NOT EXISTS public.inquiry_ticket_seq;

-- Seed past any number already in the table so the first server ticket
-- cannot collide with a legacy row. Falls back to 1 if the suffixes do
-- not parse — the UNIQUE constraint remains the final guard.
DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT MAX((substring(ticket_number FROM '[0-9]+$'))::bigint)
    INTO v_max
    FROM public.inquiries;

  PERFORM setval('public.inquiry_ticket_seq', COALESCE(v_max, 0) + 1, false);
EXCEPTION WHEN OTHERS THEN
  PERFORM setval('public.inquiry_ticket_seq', 1, false);
END
$$;

-- ── 3. create_my_inquiry() — the customer write path ────────
-- SECURITY DEFINER so the insert succeeds without a table-level INSERT
-- policy for customers, and so the profile read below is authoritative
-- regardless of the caller's own row visibility. Identity never comes
-- from the arguments: user_id, customer_name and customer_email are
-- resolved from the JWT and public.users inside the function.

CREATE OR REPLACE FUNCTION public.create_my_inquiry(
  p_subject          text,
  p_message          text,
  p_topic            text DEFAULT 'GENERAL',
  p_customer_phone   text DEFAULT NULL,
  p_related_order_id uuid DEFAULT NULL
)
RETURNS public.inquiries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile public.users;
  v_inquiry public.inquiries;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO v_profile FROM public.users WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_missing';
  END IF;

  IF p_subject IS NULL OR btrim(p_subject) = '' THEN
    RAISE EXCEPTION 'validation_subject';
  END IF;

  IF p_message IS NULL OR length(btrim(p_message)) < 10 THEN
    RAISE EXCEPTION 'validation_message';
  END IF;

  -- A related order must exist and belong to the caller; anything else is
  -- silently dropped rather than failing the whole submission.
  IF p_related_order_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.orders o
       WHERE o.order_id = p_related_order_id
         AND (o.user_id = v_uid
              OR lower(o.customer_email) = lower(v_profile.email))
    ) THEN
      p_related_order_id := NULL;
    END IF;
  END IF;

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
    user_id,
    related_order_id
  ) VALUES (
    'INQ-' || to_char(now(), 'YYYY') || '-'
      || lpad(nextval('public.inquiry_ticket_seq')::text, 4, '0'),
    COALESCE(
      NULLIF(btrim(v_profile.first_name || ' ' || v_profile.last_name), ''),
      v_profile.email
    ),
    v_profile.email,
    NULLIF(btrim(COALESCE(p_customer_phone, '')), ''),
    btrim(p_subject),
    btrim(p_message),
    CASE
      WHEN p_topic IN ('GENERAL','ORDER','REFUND','ACCESS','BILLING','TECHNICAL')
        THEN p_topic
      ELSE 'GENERAL'
    END,
    'NEW',
    'WEBSITE',
    v_uid,
    p_related_order_id
  )
  RETURNING * INTO v_inquiry;

  RETURN v_inquiry;
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_inquiry(text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_my_inquiry(text, text, text, text, uuid) TO authenticated;

-- ── 4. Realtime delivery ────────────────────────────────────
-- Idempotent: adding an already-present table to a publication is an
-- error only in older Postgres versions; the DO block keeps re-running
-- the migration safe on any of them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname  = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'inquiries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inquiries;
  END IF;
END
$$;

-- DEFAULT replica identity (the primary key) is what the client's
-- refetch-on-event design expects; setting it explicitly documents the
-- requirement and guards against a future ALTER that would change it.
ALTER TABLE public.inquiries REPLICA IDENTITY DEFAULT;

-- ── VERIFY ───────────────────────────────────────────────────
--
-- 1. Policies + publication: the queries in the header comment.
--
-- 2. Customer flow: as user A,
--      SELECT create_my_inquiry('בדיקה', 'הודעה ארוכה מספיק לשליחה');
--    returns a row with user_id = A, the profile's name/email and a fresh
--    INQ-YYYY-NNNN ticket number. A SELECT * FROM inquiries returns only
--    A's rows.
--
-- 3. Staff flow: as an admin (is_admin() true),
--      SELECT count(*) FROM inquiries;              -- the whole queue
--      UPDATE inquiries SET status = 'OPEN' WHERE inquiry_id = ...;
--    succeeds; the same UPDATE as user A is refused by RLS.
--
-- 4. Realtime: with the customer page open as user A, run the staff
--    UPDATE from (3) against A's ticket — the page updates within
--    seconds, without a browser refresh.
--
-- 5. Client-side: submit from /dashboard/support; the ticket appears in
--    פניות קודמות immediately and in /admin/support on the admin's device
--    within seconds.

COMMIT;
