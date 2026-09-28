-- ============================================================
-- 0012 — make suspension actually block authentication
--
-- PROBLEM
--
-- Changing `public.users.account_status` to SUSPENDED updated the admin
-- display, but the affected account could still sign in. That column is this
-- app's own record; GoTrue does not know about it, so the button was an
-- administrative label without a functional effect.
--
-- FIX
--
-- `admin_set_account_status` (from migrations/0011) now sets
-- `auth.users.banned_until` alongside `public.users.account_status`.
-- GoTrue rejects password and refresh-token grants while the ban timestamp
-- is in the future, so the customer cannot create a replacement session.
--
-- * SUSPENDED and DEACTIVATED set a distant ban expiry.
-- * ACTIVE clears it.
-- * The status CHECK and is_admin() gate are unchanged.
--
-- APPLY, THEN VERIFY
--
-- Sign in as the suspended customer should fail. A previously issued access
-- token remains usable only until its own short expiry, but it cannot be
-- refreshed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  p_user_id uuid,
  p_status  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
-- Pinned so a caller cannot hijack resolution of is_admin() or either table
-- through a manipulated search_path.
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Distant rather than infinite. GoTrue must parse this timestamp into its
  -- own user model, and a finite value avoids relying on any backend's
  -- treatment of the infinity sentinel.
  v_ban CONSTANT TIMESTAMPTZ := '9999-12-31T00:00:00Z';
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users
     SET account_status = p_status,
         updated_at     = now()
   WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE auth.users
     SET banned_until = CASE
                           WHEN p_status = 'ACTIVE' THEN NULL
                           ELSE v_ban
                        END
   WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.admin_set_account_status(uuid, text) IS
  'Admin-only: sets public.users.account_status and keeps GoTrue in step by '
  'setting or clearing auth.users.banned_until. SECURITY DEFINER because '
  'migration 0004 grants authenticated UPDATE on greeted_at only.';


-- ── VERIFY ───────────────────────────────────────────────────
--
-- 1. The function still exists, is SECURITY DEFINER, and pins search_path:
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
-- 2. After changing a test account to SUSPENDED, both columns agree:
--
--    SELECT p.user_id,
--           p.account_status,
--           a.banned_until
--      FROM public.users p
--      JOIN auth.users a ON a.id = p.user_id
--     WHERE p.user_id = '<test-user-id>';
--
-- 3. Reactivating the same account must clear the ban timestamp; otherwise
--    a previously blocked customer remains unable to sign in despite the
--    admin panel showing ACTIVE.
