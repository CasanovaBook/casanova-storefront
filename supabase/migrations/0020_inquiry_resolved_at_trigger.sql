-- ============================================================
-- 0020 — The resolution moment is stamped by the database
--
-- WHY
--
-- `inquiries.resolved_at` already exists (TIMESTAMPTZ, guarded by
-- chk_inquiry_resolution) and is the field both panels display — there is no
-- second timestamp to add. What was wrong is who filled it: nothing in the
-- database ever did. The admin's browser computed it (`nowIso()` in
-- updateInquiry) and sent it as a column value, so the moment a ticket was
-- recorded as resolved was that admin's workstation clock. A machine a few
-- minutes off, or set to the wrong zone, wrote a wrong resolution time that
-- looked perfectly plausible — and the row's own `updated_at` came from the
-- server (set_updated_at), so two timestamps on the same row could disagree
-- about the same instant.
--
-- This migration makes the database the only authority for that column,
-- reusing it exactly as it is:
--
--   • A status TRANSITION into RESOLVED or CLOSED from outside that pair
--     stamps `resolved_at = NOW()`, so the stored time is the server's.
--   • RESOLVED ↔ CLOSED is the same resolution, so moving a resolved ticket
--     to closed (or back) KEEPS the moment it was first resolved — the rule
--     the client already applies with `existing.resolved_at ?? nowIso()`, now
--     enforced server-side. Closing is not re-resolving.
--   • Leaving the pair clears it, so a reopened ticket carries no misleading
--     resolution time — again the client's own rule, applied by the server.
--   • An UPDATE that does not move the status (a reply's freshness bump, an
--     assignment, an order link, a note) leaves the stored moment alone, so a
--     ticket cannot slide its resolution time forward on every unrelated
--     write.
--   • Existing resolved rows keep their stored value: the trigger only writes
--     on a transition.
--   • INSERT is covered too — a new ticket lands NULL, a row inserted
--     already resolved is stamped unless it brought a historical value —
--     which also means chk_inquiry_resolution cannot be violated by a write
--     that forgot the column.
--
-- The client still sends its own value for the offline driver, where there is
-- no database; against Supabase this trigger overwrites it.
--
-- APPLY, THEN VERIFY
--
--   UPDATE public.inquiries SET status = 'RESOLVED' WHERE inquiry_id = '<T>';
--   SELECT status, resolved_at, now() FROM public.inquiries WHERE inquiry_id = '<T>';
--    → resolved_at equals the server's NOW() (to the second), not the
--      browser's clock.
--
--   UPDATE public.inquiries SET assigned_to = NULL WHERE inquiry_id = '<T>';
--    → resolved_at unchanged (that was not a transition).
--
--   UPDATE public.inquiries SET status = 'CLOSED' WHERE inquiry_id = '<T>';
--    → resolved_at unchanged: closing an already-resolved ticket is not a
--      new resolution.
--
--   UPDATE public.inquiries SET status = 'OPEN' WHERE inquiry_id = '<T>';
--    → resolved_at IS NULL again.
--
--   UPDATE public.inquiries SET status = 'RESOLVED' WHERE inquiry_id = '<T>';
--    → a fresh NOW(), i.e. re-resolving records the new moment.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.stamp_inquiry_resolution()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('RESOLVED', 'CLOSED') THEN
    IF TG_OP = 'INSERT' THEN
      /* A row inserted already resolved keeps an explicitly supplied
       * historical moment (data migration / backfill) and is stamped
       * otherwise. */
      IF NEW.resolved_at IS NULL THEN
        NEW.resolved_at := NOW();
      END IF;
    ELSIF NEW.resolved_at IS NULL
       OR OLD.status NOT IN ('RESOLVED', 'CLOSED') THEN
      /* Entering the resolved pair is the resolution event, so it is stamped
       * from the server clock — once. RESOLVED → CLOSED keeps the original
       * moment because OLD is already inside the pair and a value is stored.
       * OLD is only read here, never in the INSERT branch: it is unassigned
       * for an insert. */
      NEW.resolved_at := NOW();
    END IF;
  ELSE
    /* Anything that is not resolved carries no resolution moment. */
    NEW.resolved_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inquiries_resolution_stamp ON public.inquiries;
CREATE TRIGGER trg_inquiries_resolution_stamp
  BEFORE INSERT OR UPDATE ON public.inquiries
  FOR EACH ROW EXECUTE FUNCTION public.stamp_inquiry_resolution();

COMMIT;
