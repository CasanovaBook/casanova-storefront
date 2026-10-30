-- ============================================================
-- 0030 - Staff deletion of a support ticket
--
-- WHY
--
-- 0018 intentionally has no DELETE policy: neither customers nor the anon
-- role may remove a ticket. Staff still need a way to erase a spam or
-- duplicate ticket, and doing it from the browser would require either a
-- DELETE policy (any admin API call could then wipe the whole table) or the
-- service key in the bundle.
--
-- This function is the narrow, auditable path:
--   • it is SECURITY DEFINER, but the first thing it checks is auth.uid()
--     and public.is_admin() - the same predicate every staff policy uses;
--   • it deletes exactly one ticket by id, and the ON DELETE CASCADE on
--     inquiry_notes removes the conversation with it;
--   • email_logs has no foreign key to inquiries, so delivery history
--     survives, which is what keeps the audit trail intact.
--
-- The UI asks for confirmation before calling it; the database does not rely
-- on that confirmation and refuses any non-admin caller regardless.
--
-- APPLY, THEN VERIFY
--
--   -- As an admin:
--   SELECT public.delete_inquiry('<ticket uuid>');
--    → ticket and its notes are gone.
--
--   -- As a customer / anon:
--   SELECT public.delete_inquiry('<ticket uuid>');
--    → ERROR: forbidden / unauthenticated.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_inquiry(p_inquiry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  DELETE FROM public.inquiries WHERE inquiry_id = p_inquiry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inquiry_missing';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_inquiry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_inquiry(uuid) TO authenticated;

COMMIT;