-- ============================================================
-- 0010 — delete every account except the one admin
--
-- KEEPS:  maorgacp@gmail.com   (role = ADMIN)
-- DELETES: every other auth user and its public.users profile,
--          plus all data that belongs to them.
--
-- ⚠ DESTRUCTIVE AND IRREVERSIBLE. This permanently removes customer
--   accounts, orders, payments, invoices, refunds, entitlements,
--   reading progress, support conversations and CRM records. There
--   is no undo and no soft-delete: the rows are gone.
--
--   Run the PREVIEW block first and READ IT. If the "would delete"
--   count includes maorgacp@gmail.com, STOP — the guard has failed
--   and running the rest would lock you out of your own admin panel.
--
-- WHY auth.users HAS TO BE DELETED TOO
--
-- public.users is the profile; auth.users holds the credentials.
-- Deleting only the profile would leave the account able to sign in
-- and re-create itself, and the address would still exist in the
-- project's email/identity records. Both are removed.
--
-- WHY THE ORDER MATTERS
--
-- Two foreign keys to users are ON DELETE RESTRICT, not CASCADE:
--
--   refunds.initiated_by_id   (schema.sql:619)
--   inquiry_notes.author_id   (schema.sql:840)
--
-- RESTRICT means Postgres refuses to delete a user while a refund
-- row or an inquiry note still points at them. Those two are
-- cleared first, or the final DELETE aborts and nothing happens.
-- Every other reference is CASCADE or SET NULL and needs no
-- attention.
-- ============================================================

-- ── PREVIEW — run this FIRST. It changes nothing. ─────────────
-- Expect: 1 row to keep, N to delete.
-- Verify maorgacp@gmail.com appears in the KEEP row.
SELECT
  CASE WHEN LOWER(email) = 'maorgacp@gmail.com'
       THEN 'KEEP' ELSE 'DELETE' END AS action,
  email, role, account_status, created_at
FROM public.users
ORDER BY action DESC, created_at DESC;

-- Also confirm no OTHER admin exists. If a second ADMIN or
-- MODERATOR shows up below, decide about them before deleting.
SELECT email, role, admin_role FROM public.users
WHERE role IN ('ADMIN','MODERATOR');

-- ── DELETE ───────────────────────────────────────────────────
BEGIN;

-- 1. Auth first, while the ids are still readable from public.users.
--    There is NO foreign key between auth.users and public.users,
--    so both sides must be deleted explicitly.
--
--    Driven off public.users rather than auth.users.email: auth.users
--    is owned and shaped by Supabase (it appears nowhere in this
--    repo's schema), so its exact column set is not something this
--    migration can rely on. public.users.user_id IS the same UUID as
--    auth.users.id — the app already keys every profile off it — and
--    public.users IS defined here, so this side is verifiable.
--
--    An auth account with no public.users row is not deleted by this
--    statement. Query 3 in the VERIFY block below detects that case
--    so nothing is left stranded holding credentials.
DELETE FROM auth.users
WHERE id NOT IN (
  SELECT user_id FROM public.users
  WHERE LOWER(email) = 'maorgacp@gmail.com'
);

-- 2. The two RESTRICT blockers, cleared before the users go.
--    A refund initiated by, or a note authored by, the account
--    being removed would otherwise abort the whole transaction.
DELETE FROM refunds
WHERE LOWER(initiated_by_id::text) IN (
  SELECT user_id::text FROM public.users
  WHERE LOWER(email) <> 'maorgacp@gmail.com'
);

DELETE FROM inquiry_notes
WHERE author_id IN (
  SELECT user_id FROM public.users
  WHERE LOWER(email) <> 'maorgacp@gmail.com'
);

-- 3. The profiles. Their entire dependent tree — orders, payments,
--    invoices, entitlements, reading progress, subscriptions,
--    device sessions, content grants, support threads, CRM records —
--    goes with them by CASCADE.
DELETE FROM public.users
WHERE LOWER(email) <> 'maorgacp@gmail.com';

COMMIT;

-- ── VERIFY ───────────────────────────────────────────────────
-- Must return exactly one row, and it must be maorgacp@gmail.com.
SELECT user_id, email, role, admin_role FROM public.users;

-- Must return exactly one row, the same account.
SELECT id, email FROM auth.users;

-- ⚠ MUST RETURN NO ROWS. Any row here is an auth account with no
-- public.users profile — it survived the DELETE above because the
-- statement keys off public.users. Sign-in is still possible for it,
-- so it must be removed. Delete by id, the value in auth_user_id:
--
--   DELETE FROM auth.users WHERE id = '<auth_user_id>';
--
-- If this returns maorgacp@gmail.com, the guard has failed. Do not
-- delete it; the account in public.users no longer matches the one
-- you are trying to keep.
SELECT a.id AS auth_user_id, a.email
FROM auth.users a
LEFT JOIN public.users p ON p.user_id = a.id
WHERE p.user_id IS NULL;

-- Both must be 0.
SELECT
  (SELECT count(*) FROM orders)                          AS orders_left,
  (SELECT count(*) FROM user_products)                  AS entitlements_left,
  (SELECT count(*) FROM inquiry_notes)                  AS notes_left,
  (SELECT count(*) FROM refunds)                        AS refunds_left;

-- ── IF YOU ENDED UP LOCKED OUT ───────────────────────────────
-- If maorgacp@gmail.com was deleted by mistake, sign-in is
-- impossible: Supabase holds the credentials and the password
-- cannot be reset from SQL. Recovery is Supabase dashboard →
-- Authentication → Users → recreate the account, then re-insert
-- the public.users row with role='ADMIN' and admin_role set
-- (SUPER_ADMIN / SUPPORT / FINANCE / CONTENT / MARKETING, which
-- are the values the CHECK constraint allows). That is why the
-- preview block above exists.
