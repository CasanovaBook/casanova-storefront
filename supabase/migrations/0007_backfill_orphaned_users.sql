-- ============================================================
-- 0007 — backfill auth accounts missing from public.users
--        [OBSOLETE — SKIP IF YOU APPLY 0010]
--
-- ⚠ If you run 0010_delete_all_users_except_admin.sql (wiping every
--   account except maorgacp@gmail.com), this file becomes pointless:
--   it would re-insert two customers that 0010 is about to delete.
--   The correct order in that case is 0010 alone — do not run both.
--
-- This file is kept for the case where you decide to KEEP your
-- customers and only repair the two accounts that never landed.
-- The choice is yours; just do not apply both.
--
-- It repairs two accounts created through the register form on
-- 2026-09-25 that carry first_name/last_name in
-- raw_user_meta_data but never got a public.users row, so the admin
-- list could not see them.
--
-- The most likely explanation is that the auth -> public copy did not
-- exist yet on the 25th and was added later. This migration does not
-- assume that; it repairs whatever is missing, whenever it went wrong.
--
-- WHY A BACKFILL RATHER THAN A NEW TRIGGER
--
-- A trigger only ever fires on the NEXT insert. It cannot reach back
-- and fix the two rows that are already stranded, so those stay
-- invisible to the admin forever until they are inserted by hand. This
-- closes that gap. It deliberately does NOT create or replace the
-- trigger — if one already exists, it keeps doing its job unchanged.
--
-- SAFE TO RE-RUN
--
-- ON CONFLICT DO NOTHING makes this a no-op the second time, and the
-- INSERT is driven by a NOT EXISTS anti-join so it can only ever add
-- rows that are genuinely absent. It never updates or deletes.
-- ============================================================

BEGIN;

INSERT INTO public.users (user_id, first_name, last_name, email, role, account_status, created_at, updated_at)
SELECT
  a.id,
  -- COALESCE guards the NOT NULL constraint: metadata is absent for
  -- accounts created straight in the Supabase dashboard rather than
  -- through the form.
  COALESCE(NULLIF(a.raw_user_meta_data->>'first_name', ''), 'לא ידוע'),
  COALESCE(NULLIF(a.raw_user_meta_data->>'last_name',  ''), 'לא ידוע'),
  a.email,
  'CUSTOMER',
  'ACTIVE',
  -- Preserve the ORIGINAL signup time, not now(). Using now() would
  -- make these two accounts sort as the newest users in the admin
  -- list, which is a lie about when they joined.
  a.created_at,
  a.created_at
FROM auth.users a
WHERE a.email IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.users p WHERE p.user_id = a.id
  )
ON CONFLICT DO NOTHING;

COMMIT;

-- ── VERIFY ───────────────────────────────────────────────────
-- Must now return no rows. If it still does, the anti-join is being
-- blocked by the UNIQUE index on LOWER(email) — report the email.
--
--   SELECT a.id, a.email FROM auth.users a
--   LEFT JOIN public.users p ON p.user_id = a.id
--   WHERE p.user_id IS NULL;
--
-- Then confirm the two repaired accounts are the OLDEST customers,
-- not the newest — i.e. the backfill dated them correctly:
--
--   SELECT email, created_at FROM public.users
--   WHERE email IN ('zvika0710@gmail.com','maorgacp1@gmail.com');
--
-- Both should read 2026-09-25. Finally, reload /admin/users and check
-- "הצטרפות" (joined) shows 25 בספטמבר for both.
--
-- NOTE: these two accounts are CUSTOMER role and unconfirmed-era
-- signups. Confirm they should be CUSTOMER before promoting either to
-- ADMIN — the backfill assigns CUSTOMER to every row it inserts.
