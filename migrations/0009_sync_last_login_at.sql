-- ============================================================
-- 0009 — record last login for admin   [REQUIRES A SERVER-SIDE TRIGGER]
--
-- THE BUG
--
-- "התחברות אחרונה" (last login) shows "מעולם" (never) for every
-- Supabase-backed account, even after the person has signed in.
--
-- ROOT CAUSE — nothing writes the column
--
-- public.users.last_login_at exists (schema.sql:145) and the admin UI
-- reads it correctly in all THREE display sites, falling back to
-- "מעולם" when the column is null:
--
--   • AdminUsersPage:1112     — the "התחברות אחרונה" column on
--                               /admin/users.
--   • AdminUsersPage:321      — the same field in the "צפייה" drawer.
--   • AdminDashboardPage:651  — the "משתמשים אחרונים" row on /admin.
--                               Added later: that panel previously
--                               rendered only avatar, name, email and
--                               status, so last login looked "missing"
--                               on /admin even when the column DID
--                               hold a value. Rendering it is a
--                               frontend change and is already in
--                               place; this migration is what makes
--                               the value non-null.
--
-- But in Supabase mode NO code path ever writes it:
--
--   • src/lib/api.ts:491 stamps last_login_at, but only inside
--     login() — the LEGACY localStorage driver, which is skipped
--     entirely when isSupabaseConfigured is true (AppContext:266).
--   • src/lib/supabase-auth.ts does read authUser.last_sign_in_at
--     and maps it into the in-memory User (line 223), so the
--     signed-in user sees a correct value in the DASHBOARD.
--     It is never persisted back to public.users.
--   • auth.users.last_sign_in_at IS maintained by Supabase — but
--     auth.users is not readable from the browser with the anon
--     key, and the admin list reads public.users.
--
-- So the value exists in two places, and the admin list reads the
-- one that is never written. This is already noted in
-- src/lib/first-login.ts:13-15 and migrations/0004:13-15.
--
-- WHY THE TRIGGER IS NOT OPTIONAL
--
-- The obvious client-side fix — UPDATE public.users SET
-- last_login_at = now() after signInWithPassword() — CANNOT WORK
-- today, and must not be attempted:
--
--   migrations/0004_first_login_greeting.sql:60-61 revoked the
--   table-level UPDATE grant from `authenticated` and re-granted it
--   per column, on purpose:
--
--     REVOKE UPDATE ON public.users FROM authenticated;
--     GRANT UPDATE (greeted_at) ON public.users TO authenticated;
--
--   `authenticated` may therefore update ONLY greeted_at. Widening
--   that grant to include last_login_at would hand every signed-in
--   CUSTOMER the ability to write their own last_login_at — an
--   admin-facing audit field that a user could then forge. A client
--   patch would need that grant, and the grant is the hole.
--
-- THE FIX BELOW AVOIDS THAT ENTIRELY
--
-- A trigger on auth.users runs inside the database, after GoTrue
-- has already recorded the login, as the table owner — no RLS, no
-- client grant, and nothing a browser can tamper with.
--
-- Apply this file, then deploy. The column stays empty until each
-- user signs in again, because history is not recoverable.
-- ============================================================

-- ── 1. The function ───────────────────────────────────────────
-- SECURITY DEFINER: it must be able to write public.users, which
-- RLS would otherwise block for a non-owner role. Owned by postgres.
--
-- AFTER UPDATE, not INSERT: GoTrue writes last_sign_in_at on the
-- very first sign-in too (the same reason greeted_at had to exist —
-- see first-login.ts:16-19). Watching INSERT would miss that first
-- login; watching UPDATE catches it.
--
-- last_sign_in_at IS NOT NULL, and an UPDATE cannot change a
-- primary key, so a.id = NEW.id always holds for an auth user. The
-- guard is kept anyway: it costs nothing and makes intent explicit.
CREATE OR REPLACE FUNCTION public.sync_last_login_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.last_sign_in_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only mirror a CHANGE. GoTrue touches auth.users for more than
  -- sign-in (password change, token churn, metadata edits), and
  -- without this guard every one of those would quietly reset
  -- last_login_at to "now" and make a dormant account look active.
  IF NEW.last_sign_in_at IS NOT DISTINCT FROM OLD.last_sign_in_at THEN
    RETURN NEW;
  END IF;

  -- No public.users row yet (account not yet copied by the signup
  -- trigger): skip rather than fail. Failing here would abort
  -- Supabase's own auth transaction, a far worse outcome than a
  -- missing timestamp. The next sign-in fills it in.
  UPDATE public.users
     SET last_login_at = NEW.last_sign_in_at,
         updated_at     = NEW.updated_at
   WHERE user_id = NEW.id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_last_login_at() IS
  'Mirrors auth.users.last_sign_in_at into public.users.last_login_at so '
  'the admin panel can show "last login". Runs as the table owner, so no '
  'RLS or client grant is involved and a customer cannot forge it.';

-- ── BACKFILL — one time, optional ─────────────────────────────
-- Sign-ins that already happened left no public.users timestamp,
-- and auth.users is the only record of them. This copies the truth
-- in. Run it AFTER the trigger exists so new logins are covered.
-- The join is on the user_id primary key, so each auth account maps
-- to at most one profile row.
--
--   UPDATE public.users p
--      SET last_login_at = a.last_sign_in_at
--     FROM auth.users a
--    WHERE a.id = p.user_id
--      AND a.last_sign_in_at IS NOT NULL
--      AND p.last_login_at IS NULL;
--
-- Run it once, by hand. Guarded by `p.last_login_at IS NULL` so it
-- never overwrites a real value — but it is a backfill, not a
-- migration, so keep it out of any pipeline that re-runs.
--
-- ⚠ SKIP if you cannot confirm every current account is a real
-- customer. It would also stamp admin accounts, which is accurate
-- but may not be what you want on the list.
--
-- ── VERIFY ───────────────────────────────────────────────────
-- 1. Trigger exists:
--    SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
--
-- 2. Sign in as a customer, then check the value arrived:
--    SELECT email, last_login_at FROM public.users
--    WHERE last_login_at IS NOT NULL ORDER BY last_login_at DESC;
--
--    Before: every row NULL. After one sign-in: that row is set.
--
-- 3. Confirm the mirror is exact, not merely present:
--    SELECT p.email,
--           p.last_login_at  AS profile,
--           a.last_sign_in_at AS auth_truth,
--           (p.last_login_at = a.last_sign_in_at) AS matches
--    FROM public.users p
--    JOIN auth.users a ON a.id = p.user_id
--    WHERE a.last_sign_in_at IS NOT NULL
--    ORDER BY a.last_sign_in_at DESC LIMIT 10;
--
--    `matches` must be true for every row.
--
-- 4. Security check — the customer still cannot forge it:
--    SELECT column_name FROM information_schema.column_privileges
--    WHERE grantee = 'authenticated' AND table_name = 'users'
--      AND privilege_type = 'UPDATE';
--
--    Must return ONLY greeted_at. If last_login_at appears, the
--    client-side approach was applied and the hole is open.
--
-- NOTE: existing rows stay "never" until each user signs in again,
-- unless the backfill above is run. A past login time that was
-- never recorded anywhere cannot be recovered.


-- ── 2. The trigger ────────────────────────────────────────────
-- DROP + CREATE rather than IF NOT EXISTS, so a previous version
-- that failed to compile is replaced rather than silently kept.
DROP TRIGGER IF EXISTS trg_sync_last_login_at ON auth.users;
CREATE TRIGGER trg_sync_last_login_at
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_last_login_at();

