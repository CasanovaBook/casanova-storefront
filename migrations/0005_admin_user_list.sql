-- ============================================================
-- 0005 — let staff read the user list
--
-- WHY THIS IS NEEDED
--
-- 0004 enabled RLS on public.users with exactly one SELECT policy:
--
--   users_read_own  USING (user_id = auth.uid()::uuid)
--
-- That is correct for a customer, who may read their own row and
-- nothing else. It is also the reason the admin dashboard could not
-- show registered users: `SELECT * FROM public.users` returned the
-- signed-in admin's own row and silently dropped every customer,
-- because a row that fails the policy is not an error — it is simply
-- absent from the result set. The dashboard then read the browser's
-- local store instead, which only ever contains accounts created by
-- that same browser, so a customer who registered anywhere else was
-- invisible.
--
-- This migration opens exactly one door: a signed-in member of staff
-- may read the whole user list. It adds NO write access. A customer
-- still cannot read anybody but themselves, and the narrow
-- `users_claim_greeting` write from 0004 is left exactly as it was.
--
-- WHY A HELPER FUNCTION INSTEAD OF A SUBQUERY
--
-- The obvious policy is
--
--   USING (EXISTS (SELECT 1 FROM public.users u
--                   WHERE u.user_id = auth.uid() AND u.role <> 'CUSTOMER'))
--
-- and it fails: a policy on `users` that reads `users` makes Postgres
-- re-enter the same policies while deciding the inner row, which
-- Postgres detects and rejects as infinite recursion. The predicate
-- is therefore evaluated in a SECURITY DEFINER function, which runs
-- as its owner and so is not itself subject to RLS.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.user_id = auth.uid()
      AND u.role IN ('ADMIN', 'MODERATOR')
  );
$$;

COMMENT ON FUNCTION public.is_staff() IS
  'True when the caller is a signed-in staff member. SECURITY DEFINER so '
  'the RLS policy on public.users can call it without recursing into '
  'itself. Revoked from anon; only the authenticated role may execute it.';

-- Only the signed-in role needs this. anon must never be able to ask
-- "am I staff?" — it has no JWT, so it resolves to false regardless,
-- but the grant is kept narrow so the function is not a public surface.
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

-- Staff may read the full directory. OR-ed with the existing own-row
-- policy by Postgres (permissive policies are combined), so a customer
-- reading their own profile is unaffected.
DROP POLICY IF EXISTS users_read_staff ON public.users;
CREATE POLICY users_read_staff ON public.users
  FOR SELECT TO authenticated
  USING (public.is_staff());

-- 0004 revoked the table-level UPDATE grant and re-granted it per
-- column. SELECT was never revoked, so this is a no-op today; it is
-- stated explicitly so the staff read is not lost to a later blanket
-- REVOKE, and so applying this migration twice is harmless.
GRANT SELECT ON public.users TO authenticated;

COMMIT;

-- ── VERIFY ───────────────────────────────────────────────────
-- Run after applying. Expect 3 policies on public.users.
--
--   SELECT policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'users'
--    ORDER BY policyname;
--     → users_claim_greeting | UPDATE | {authenticated}
--     → users_read_own      | SELECT | {authenticated}
--     → users_read_staff    | SELECT | {authenticated}
--
-- As an ADMIN, `SELECT count(*) FROM public.users` must return the
-- full customer count. As a CUSTOMER it must return 1 — their own row.
--
-- NOTE: the signup trigger that copies an auth user into public.users
-- (`handle_new_user()`) is owned by the Supabase dashboard, not this
-- repository — it appears in no file under migrations/ or schema.sql.
-- This migration does not touch it.
