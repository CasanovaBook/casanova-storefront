-- ============================================================
-- MIGRATION 0013 — Protect staff accounts from suspension
--
-- SYMPTOM THIS CLOSES
--
-- Suspending a מנהל from /admin/users. Migration 0011 lets any admin write
-- `account_status` on any row, including a row whose `role` is 'ADMIN' — and
-- because `role` and `account_status` are two unrelated columns, a suspended
-- admin still passes `is_admin()`. Such an account is locked out of the admin
-- area by the gate in 0012 while remaining a staff member in the data: no
-- error, nothing to click, and no way back in from the storefront.
--
-- WHY HERE AND NOT ONLY IN THE DIALOG
--
-- The dialog now refuses the click before sending it, but that is one caller in
-- one browser. This function is the only path that writes `account_status`
-- (migration 0011 explains why the column is not granted directly), so the rule
-- belongs here: a second admin, a script, or the REST endpoint all hit the same
-- veto.
--
-- REACTIVATING STAYS ALLOWED
--
-- The veto covers SUSPENDED and DEACTIVATED only. An admin already suspended
-- by hand must remain recoverable through this same button; refusing every
-- write to an admin row would make the lockout permanent and turn this guard
-- into the very bug it prevents.
--
-- HOW THE CLIENT READS IT
--
-- PostgREST forwards both the SQLSTATE and the message, so `admin_protected` is
-- matched by token in src/lib/supabase-auth.ts (STATUS_REFUSALS) rather than by
-- code: 42501 is shared with the `admin_required` refusal above, and only the
-- token tells the two apart. The dialog answers with its own popup.
--
-- APPLY, THEN VERIFY — run this in the Supabase SQL editor, then confirm:
--
--   1. The veto fires for a staff row:
--        SELECT public.admin_set_account_status(
--          '<uuid of an ADMIN row>', 'SUSPENDED');
--      Expect: ERROR: admin_protected
--
--   2. Reactivation still works, and a customer row is still suspended:
--        SELECT public.admin_set_account_status(
--          '<uuid of a CUSTOMER row>', 'SUSPENDED');
--      Expect: no error, and
--        SELECT account_status FROM public.users
--         WHERE user_id = '<uuid of a CUSTOMER row>';
--      returns SUSPENDED.
--
--   3. Restore the customer row before signing out:
--        SELECT public.admin_set_account_status(
--          '<uuid of a CUSTOMER row>', 'ACTIVE');
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  p_user_id uuid,
  p_status  text
)
RETURNS void
LANGUAGE plpgsql
-- Same owner-run execution and pinned search_path as 0011; CREATE OR REPLACE
-- keeps both, but they are restated so this file can be read on its own.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  -- Caller must be staff. Checked first, so a customer cannot learn anything
  -- about another row's role by watching which error comes back.
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  -- Mirrors the CHECK on public.users.account_status, unchanged from 0011.
  IF p_status NOT IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  -- Read the target's role before writing. No row means no role: the missing
  -- user is reported the same way 0011 reported it, rather than falling through
  -- the NOT FOUND update below with a different message.
  SELECT role
    INTO v_role
    FROM public.users
   WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_role = 'ADMIN' AND p_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'admin_protected' USING ERRCODE = '42501';
  END IF;

  UPDATE public.users
     SET account_status = p_status,
         updated_at     = now()
   WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_set_account_status(uuid, text) IS
  'Admin-only: sets public.users.account_status. Refuses SUSPENDED and '
  'DEACTIVATED on a row whose role is ADMIN (raises admin_protected) because '
  'a suspended admin still passes is_admin() and would be locked out with no '
  'way back in; reactivating such a row stays allowed.';

-- Execution is unchanged from 0011 and restated so applying this file alone
-- leaves the function reachable exactly as intended: signed-in callers only,
-- gated by the is_admin() check inside.
REVOKE ALL ON FUNCTION public.admin_set_account_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_account_status(uuid, text) TO authenticated;
