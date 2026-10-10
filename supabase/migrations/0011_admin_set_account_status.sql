-- ============================================================
-- 0011 — let an admin suspend / reinstate an account
--        [REQUIRES A SERVER-SIDE FUNCTION]
--
-- THE BUG
--
-- "השהיית משתמש" in the user dialog reported "המשתמש לא נמצא." for
-- every account that had registered through Supabase.
--
-- ROOT CAUSE — two layers, and both had to be fixed
--
-- 1. FRONTEND. The admin ACTIONS still ran against the local store.
--    `setUserStatus` in src/lib/api-support.ts resolved the customer
--    with `getDb().users.find(...)`, and returned NOT_FOUND when that
--    lookup missed. It always missed: `db.users` only ever holds
--    records this browser created. The READ side was moved onto
--    Supabase earlier (`fetchAllProfiles`); the write side was not.
--    Fixed in the same commit as this file.
--
-- 2. DATABASE. Even with the frontend writing to `public.users`, a
--    direct UPDATE cannot succeed. This is the part that is easy to
--    miss, because the RLS policy looks sufficient on its own:
--
--      "Admins have full access to users"   ALL   USING (is_admin())
--
--    It is necessary but NOT sufficient. GRANT and RLS are
--    independent layers and both must permit. Migration 0004 did:
--
--      REVOKE UPDATE ON public.users FROM authenticated;
--      GRANT UPDATE (greeted_at) ON public.users TO authenticated;
--
--    so `authenticated` may update exactly ONE column. An admin
--    UPDATE of `account_status` fails with 42501 "permission denied
--    for table users" before RLS is ever consulted. Confirmed against
--    the live project: PATCH /rest/v1/users answers 401 / 42501, with
--    Postgres' own hint suggesting a GRANT.
--
-- WHY A FUNCTION RATHER THAN `GRANT UPDATE (account_status)`
--
-- Granting the column would open a self-service hole. RLS is
-- ROW-level and cannot restrict which COLUMN is written, so holding
-- UPDATE(account_status) a SUSPENDED customer could write their own
-- row through the existing "Users can update own profile" policy and
-- set themselves back to ACTIVE. A veto trigger could close that,
-- but then the rule lives in two objects that must agree.
--
-- A SECURITY DEFINER function runs as the owner, so it needs no
-- column grant and the hole is never opened. It checks `is_admin()`
-- itself, which reads the CALLER's identity: `auth.uid()` comes from
-- the request's JWT claims, not from the executing role. This is the
-- same pattern 0009 uses for `last_login_at`.
--
-- APPLY, THEN VERIFY
--
-- The button keeps failing until this is applied. After applying,
-- open the user dialog on /admin/users and press "השהיית משתמש".
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  p_user_id uuid,
  p_status  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
-- Pinned so a caller cannot hijack resolution of is_admin() or the
-- table through a manipulated search_path.
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Caller must be staff. Checked here because SECURITY DEFINER
  -- bypasses RLS entirely; without this the function would let any
  -- signed-in customer suspend any account.
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  -- Mirrors the CHECK on public.users.account_status. Validated here
  -- so a bad value is a clear rejection rather than a constraint
  -- violation surfaced from deep inside the update.
  IF p_status NOT IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users
     SET account_status = p_status,
         updated_at     = now()
   WHERE user_id = p_user_id;

  -- Zero rows means the id does not exist. Told apart from a refused
  -- write on purpose: "not found" is what sent the admin hunting for
  -- a user that was rendering in the list all along.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_set_account_status(uuid, text) IS
  'Admin-only: sets public.users.account_status. SECURITY DEFINER because '
  'migration 0004 grants authenticated UPDATE on greeted_at only, so a '
  'direct write is refused with 42501; granting the column instead would '
  'let a suspended customer reactivate their own row.';

-- Reachable only by signed-in users, and only past the is_admin() check.
REVOKE ALL ON FUNCTION public.admin_set_account_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_account_status(uuid, text) TO authenticated;


-- ── VERIFY ───────────────────────────────────────────────────
--
-- 1. The function exists, is SECURITY DEFINER, and pins search_path:
--
--    SELECT p.proname,
--           p.prosecdef AS security_definer,
--           p.proconfig
--      FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public'
--       AND p.proname = 'admin_set_account_status';
--
--    Expect security_definer = true and a proconfig containing
--    search_path=public, pg_temp.
--
-- 2. Only authenticated may execute it — `anon` must NOT appear:
--
--    SELECT grantee, privilege_type
--      FROM information_schema.routine_privileges
--     WHERE routine_name = 'admin_set_account_status';
--
-- 3. Confirm the reason a direct write cannot work, i.e. that
--    authenticated still holds UPDATE on greeted_at and nothing else.
--    `account_status` must NOT be listed:
--
--    SELECT column_name, privilege_type
--      FROM information_schema.column_privileges
--     WHERE table_name = 'users'
--       AND grantee = 'authenticated'
--       AND privilege_type = 'UPDATE';
