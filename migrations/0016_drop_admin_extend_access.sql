-- ============================================================
-- 0016 — drop admin_extend_access   [FEATURE REMOVAL]
--
-- The "הארכה ב־30 ימים" action was removed from the admin access UI
-- and from the service layer. The SECURITY DEFINER function below is
-- now dead surface: nothing calls it, but EXECUTE was granted to
-- authenticated, so any signed-in account could still invoke it
-- directly. Dropping it closes that door and keeps the database in
-- step with the code.
--
-- APPLY, THEN VERIFY:
--
--   SELECT p.proname FROM pg_proc p
--    JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'admin_extend_access';
--   -- expect zero rows
--
--   SELECT routine_name, grantee FROM information_schema.routine_privileges
--    WHERE routine_name = 'admin_extend_access';
--   -- expect zero rows
-- ============================================================

REVOKE ALL ON FUNCTION public.admin_extend_access(uuid, timestamptz) FROM authenticated;
DROP FUNCTION IF EXISTS public.admin_extend_access(uuid, timestamptz);
