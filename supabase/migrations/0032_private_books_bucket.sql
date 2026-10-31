-- ============================================================
-- 0032 - the books bucket is private, explicitly
--
-- BACKGROUND
--
-- The reader treats `books` as a private bucket: the Edge Functions sign
-- objects inside their runtime (get-content-url legacy) or stream them
-- after checking the JWT and entitlement (reader-content). But bucket
-- visibility was configured only in the dashboard, not in version control.
--
-- A bucket with `public = true` serves every object at
--   /storage/v1/object/public/books/<path>
-- with no token, policy or customer session. A leaked or guessed path
-- (the reader path is deterministic: product-<id>/book.pdf) would then be
-- the whole book. This migration makes the flag explicit and idempotent.
--
-- WHAT THIS DOES NOT DO
--
-- It does not inspect or drop `storage.objects` policies. A policy that
-- grants anon/authenticated SELECT on this bucket would still expose
-- objects through the authenticated Storage API even with public = false.
-- Run the audit query below in the SQL editor after applying this file and
-- remove any such policy:
--
--   SELECT policyname, cmd, qual, with_check
--     FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND (qual ILIKE '%books%' OR with_check ILIKE '%books%');
--
-- Signed URLs and the service-role Edge Functions do not need an
-- authenticated SELECT policy on this bucket.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('books', 'books', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Verification (read-only): must return public = false.
-- SELECT id, public FROM storage.buckets WHERE id = 'books';
