-- ============================================================
-- 0005 — let staff read the user list   [SUPERSEDED — DO NOT APPLY]
--
-- ⚠ THIS MIGRATION IS NOT NEEDED. The live database already has
--   policies that do this job, and better. It was written from
--   migration 0004 alone, which describes only part of the real
--   schema. Read the live policies before applying anything here:
--
--   "Admins have full access to users"  ALL     USING (is_admin())
--   "Users can view own profile"        SELECT  USING (auth.uid() = user_id OR is_admin())
--   "Users can update own profile"      UPDATE  USING (auth.uid() = user_id)
--   users_claim_greeting                UPDATE  USING (user_id = auth.uid())
--   users_read_own                      SELECT  USING (user_id = auth.uid())
--
-- `is_admin()` already exists and already grants staff SELECT on the
-- whole table, which is why the admin list renders every user today.
-- Applying this file would add a redundant `users_read_staff` policy
-- and a second `is_staff()` function that does the same job under a
-- different name. Two functions, two policies, one behaviour — more
-- surface to keep in sync, for no gain.
--
-- It is kept in the repo as a record of the original diagnosis, which
-- was correct: the admin list really did read localStorage only, and
-- really did need a Supabase read (see src/context/AdminContext.tsx).
-- The read was the fix; the RLS half turned out to be unnecessary.
--
-- ── Original content follows, for reference only ─────────────
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
