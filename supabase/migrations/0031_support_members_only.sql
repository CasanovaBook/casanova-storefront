-- ============================================================
-- 0031 - Support is members-only again
--
-- WHY
--
-- 0029 opened the queue to guests: a service-role insert function, an
-- inbound email bridge and a claim-on-login merge. Support is now scoped
-- back to authenticated accounts only, with no customer email in either
-- direction. This migration removes the database half of that feature:
--
--   • drop the guest insert / claim / inbound functions and their grants;
--   • drop the unclaimed-email index that only existed for claiming;
--   • remove the guest-email note columns and rows;
--   • require user_id on every NEW ticket.
--
-- Existing tickets are NOT deleted: a guest ticket already in the queue may
-- still hold real support history, and staff can inspect or delete it from
-- /admin/support. New tickets must be owned.
--
-- The owner check is a trigger rather than `ALTER COLUMN user_id SET NOT
-- NULL`, because the FK is ON DELETE SET NULL: deleting a user must be able
-- to clear ownership on historical rows, which a NOT NULL column would
-- reject. The rule that matters - every ticket is created by a session -
-- is enforced on INSERT.
--
-- APPLY, THEN VERIFY
--
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('create_guest_inquiry','claim_my_inquiries',
--                      'support_inbound_reply');
--    → no rows.
--
--   -- As an authenticated user:
--   SELECT create_my_inquiry('נושא','הודעה ארוכה מספיק');
--    → a ticket with user_id = auth.uid().
--
--   -- A staff insert without an owner is refused:
--   INSERT INTO public.inquiries (ticket_number, customer_name,
--     customer_email, subject, message)
--   VALUES ('X','X','x@example.com','X','X');
--    → ERROR: owner_required
-- ============================================================

BEGIN;

-- ── 1. Guest write paths ────────────────────────────────────

DROP FUNCTION IF EXISTS public.support_inbound_reply(text, text, text);
DROP FUNCTION IF EXISTS public.claim_my_inquiries();
DROP FUNCTION IF EXISTS public.create_guest_inquiry(text, text, text, text, text, text);

DROP INDEX IF EXISTS public.idx_inquiries_unclaimed_email;

-- ── 2. Guest email replies ──────────────────────────────────
-- Notes with no author can only be the inbound-email messages introduced by
-- 0029 (every other writer stamps author_id). Removing them lets the column
-- go back to NOT NULL.

DELETE FROM public.inquiry_notes WHERE author_id IS NULL;

ALTER TABLE public.inquiry_notes DROP COLUMN IF EXISTS author_email;

ALTER TABLE public.inquiry_notes ALTER COLUMN author_id SET NOT NULL;

-- ── 3. Every new ticket has an owner ────────────────────────

CREATE OR REPLACE FUNCTION public.require_inquiry_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'owner_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inquiries_require_owner ON public.inquiries;
CREATE TRIGGER trg_inquiries_require_owner
  BEFORE INSERT ON public.inquiries
  FOR EACH ROW EXECUTE FUNCTION public.require_inquiry_owner();

COMMIT;