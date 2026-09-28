-- ============================================================
-- 0006 DIAGNOSTIC — run this, it is read-only (SELECT only)
--
-- Symptom being investigated:
--   A newly registered user does not appear in the admin list
--   ("משתמשים אחרונים" / /admin/users) AND does not appear in the
--   public.users table.
--
-- Nothing in this file changes data. It only reports.
-- Run it in the Supabase SQL editor and paste the output back.
-- ============================================================

-- ── 1. Does the signup trigger exist, and what does it do? ──────
--
-- CORRECTED. The first version of this query filtered on
--   c.relname = 'auth.users'
-- which can never match: pg_class.relname holds the table name only
-- ("users"), and the schema lives in pg_namespace separately. That
-- bug made the query report "no trigger" even when one exists.
SELECT
  t.tgname                                   AS trigger_name,
  t.tgenabled                                AS enabled,
  pg_get_triggerdef(t.oid)                  AS definition
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth'
  AND c.relname = 'users'
  AND NOT t.tgisinternal;

-- ── 2. Auth accounts that have NO public.users row ─────────────
-- These are the "orphans": registered successfully, invisible to
-- the admin. A non-empty result here reproduces the bug exactly.
SELECT
  a.id                AS auth_user_id,
  a.email,
  a.created_at        AS auth_created_at,
  a.raw_user_meta_data->>'first_name' AS meta_first,
  a.raw_user_meta_data->>'last_name'  AS meta_last
FROM auth.users a
LEFT JOIN public.users p ON p.user_id = a.id
WHERE p.user_id IS NULL
ORDER BY a.created_at DESC;

-- ── 3. Does public.users have any row the auth side lacks? ──────
-- The reverse orphan. Indicates a manual/backfilled row, or a
-- trigger that only runs on some paths.
SELECT p.user_id, p.email, p.role, p.created_at
FROM public.users p
LEFT JOIN auth.users a ON a.id = p.user_id
WHERE a.id IS NULL
ORDER BY p.created_at DESC;

-- ── 4. Current RLS policies on public.users ────────────────────
-- Expect users_read_own (SELECT) and users_claim_greeting (UPDATE).
-- If users_read_staff is missing, migration 0005 was never applied
-- and the admin list can only ever show the local fallback.
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users'
ORDER BY policyname;

-- ── 5. Sanity: is is_staff() present and callable? ─────────────
-- Returns true/false for whichever role runs this. It should return
-- false here (SQL editor is not a signed-in staff JWT), which
-- confirms the function exists without granting anything away.
SELECT public.is_staff() AS i_am_staff;

-- ── 6. What the admin list should render right now ─────────────
-- The 4 most recent by created_at — compare against the dashboard.
SELECT user_id, first_name, last_name, email, role, created_at
FROM public.users
ORDER BY created_at DESC
LIMIT 4;
