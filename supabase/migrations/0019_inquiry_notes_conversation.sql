-- ============================================================
-- 0019 — Support conversations: inquiry_notes RLS + customer replies
--
-- WHY
--
-- 0018 moved the ticket itself into `public.inquiries` and gave it RLS, so
-- a customer's ticket now reaches /admin/support. The CONVERSATION did
-- not follow: `public.inquiry_notes` — the table the schema already
-- documents as "internal or customer-visible replies" — had no RLS, no
-- client write path and was never read, so an admin's "תגובה ללקוח" was
-- written into that admin's browser document and the customer could never
-- see it. The customer also had no way to open a ticket at all.
--
-- This migration gives the notes table its access rules and its write
-- paths, mirroring the inquiries design exactly:
--
--   • Customers read ONLY customer-visible notes (`internal = FALSE`) on
--     their OWN tickets. Internal staff annotations stay unreadable to
--     them, on every path — the policy, not the UI, is what enforces it.
--   • Staff (`is_admin()`) read every note on every ticket and insert
--     replies and annotations, always attributed to themselves
--     (`author_id = auth.uid()`), so a forged author is refused.
--   • Customers never INSERT: their only write path is
--     `reply_to_my_inquiry()`, a SECURITY DEFINER function that proves
--     ownership of the ticket, forces `internal = FALSE` and stamps the
--     author from the JWT. A crafted request cannot post into somebody
--     else's conversation, nor write an internal note.
--   • There is no UPDATE and no DELETE policy: a note is immutable once
--     written, so an appended conversation can never be rewritten. (The
--     inquiries ON DELETE CASCADE still removes them with their ticket.)
--   • The table joins the supabase_realtime publication (0017/0018
--     pattern) so a reply appears on the other side within seconds.
--
-- APPLY, THEN VERIFY
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'inquiry_notes'
--    ORDER BY policyname;
--    → inquiry_notes_insert_staff      | INSERT
--      inquiry_notes_select_own_public | SELECT
--      inquiry_notes_select_staff      | SELECT
--
--   SELECT pubname, schemaname, tablename
--     FROM pg_publication_tables
--    WHERE tablename = 'inquiry_notes';
--    Expect one row: supabase_realtime | public | inquiry_notes.
--
--   As customer A (owner of ticket T) with an admin note on T that is
--   internal = TRUE:
--     SELECT * FROM inquiry_notes;              -- only the FALSE notes of A's tickets
--     SELECT reply_to_my_inquiry('<T>', 'תודה, עובד עכשיו');  -- succeeds, internal = FALSE
--     SELECT reply_to_my_inquiry('<someone-elses-T>', 'x');   -- ERROR: not_owner
--     INSERT INTO inquiry_notes (...) VALUES (...);           -- ERROR: RLS, no INSERT policy
--
--   As an admin: SELECT count(*) FROM inquiry_notes → every note; the
--   reply above is visible; INSERT with author_id <> auth.uid() is
--   refused by the WITH CHECK.
-- ============================================================

BEGIN;

-- ── 1. Row Level Security ───────────────────────────────────

ALTER TABLE public.inquiry_notes ENABLE ROW LEVEL SECURITY;

-- Customers see the customer-visible half of their own conversations.
-- `internal = FALSE` is part of the USING clause (not a client filter), so
-- an internal annotation can never be selected by a customer session.
DROP POLICY IF EXISTS inquiry_notes_select_own_public ON public.inquiry_notes;
CREATE POLICY inquiry_notes_select_own_public ON public.inquiry_notes
  FOR SELECT TO authenticated
  USING (
    internal = FALSE
    AND EXISTS (
      SELECT 1
        FROM public.inquiries i
       WHERE i.inquiry_id = inquiry_notes.inquiry_id
         AND i.user_id = auth.uid()
    )
  );

-- Staff read the whole conversation, internal notes included. is_admin()
-- is the live staff predicate the users/entitlement/inquiries policies
-- already rely on (see 0005, 0011, 0015, 0018).
DROP POLICY IF EXISTS inquiry_notes_select_staff ON public.inquiry_notes;
CREATE POLICY inquiry_notes_select_staff ON public.inquiry_notes
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Staff write replies (internal = FALSE) and internal annotations
-- (internal = TRUE). The author must be the caller, and the foreign keys
-- already refuse a note on a non-existent ticket.
DROP POLICY IF EXISTS inquiry_notes_insert_staff ON public.inquiry_notes;
CREATE POLICY inquiry_notes_insert_staff ON public.inquiry_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND author_id = auth.uid());

-- No UPDATE / DELETE policy on purpose (see the header). anon has no
-- business with ticket conversations at all.
--
-- Explicit grants as well as policies: RLS decides WHO may read or write,
-- but the role still needs the table privilege for a policy to be consulted
-- at all. `authenticated` gets exactly the two verbs the app uses (read,
-- insert); UPDATE and DELETE are revoked, matching the policies above, so a
-- future stray grant cannot reopen either.
GRANT SELECT, INSERT ON public.inquiry_notes TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.inquiry_notes FROM authenticated;
REVOKE ALL ON public.inquiry_notes FROM anon;

-- ── 2. reply_to_my_inquiry() — the customer write path ──────
-- SECURITY DEFINER so the insert succeeds without an INSERT policy for
-- customers. Ownership, the author and the public flag are all decided
-- here: the caller supplies the ticket id and the text and nothing else.

CREATE OR REPLACE FUNCTION public.reply_to_my_inquiry(
  p_inquiry_id uuid,
  p_content    text
)
RETURNS public.inquiry_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_inquiry public.inquiries;
  v_note    public.inquiry_notes;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'validation_content';
  END IF;

  SELECT * INTO v_inquiry
    FROM public.inquiries
   WHERE inquiry_id = p_inquiry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inquiry_missing';
  END IF;

  -- Only the ticket's own account may reply to it. A ticket opened from
  -- the public form while signed out has no owner and stays staff-only.
  IF v_inquiry.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  INSERT INTO public.inquiry_notes (inquiry_id, author_id, content, internal)
  VALUES (p_inquiry_id, v_uid, btrim(p_content), FALSE)
  RETURNING * INTO v_note;

  -- A customer answering a ticket that was waiting on them (or that nobody
  -- has opened yet) moves it back into the queue. Any other status is left
  -- to the staff lifecycle; RESOLVED and CLOSED keep their resolved_at, so
  -- chk_inquiry_resolution still holds.
  UPDATE public.inquiries
     SET status = CASE
       WHEN status IN ('NEW', 'WAITING_FOR_CUSTOMER') THEN 'OPEN'
       ELSE status
     END
   WHERE inquiry_id = p_inquiry_id;

  RETURN v_note;
END;
$$;

REVOKE ALL ON FUNCTION public.reply_to_my_inquiry(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reply_to_my_inquiry(uuid, text) TO authenticated;

-- ── 3. Realtime delivery ────────────────────────────────────
-- Idempotent: adding an already-present table to a publication is an
-- error only in older Postgres versions; the DO block keeps re-running the
-- migration safe on any of them.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname  = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'inquiry_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inquiry_notes;
  END IF;
END
$$;

-- DEFAULT replica identity (the primary key) is what the client's
-- refetch-on-event design expects.
ALTER TABLE public.inquiry_notes REPLICA IDENTITY DEFAULT;

-- ── VERIFY (client side) ────────────────────────────────────
--
-- 1. Customer opens /dashboard/support, clicks a ticket, writes a reply:
--    the message appears in the conversation immediately, the ticket shows
--    OPEN, and /admin/support shows the same message within seconds.
--
-- 2. Admin replies with "תגובה ללקוח": the customer's open conversation
--    shows it within seconds, without a refresh, and after a reload.
--
-- 3. An admin note marked "הערה פנימית" appears only on /admin/support —
--    never in the customer's conversation, even after a full reload (the
--    SELECT policy, not the UI, is what hides it).

COMMIT;
