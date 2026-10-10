-- ============================================================
-- 0004 — per-account first-login greeting
--
-- The dashboard says "ברוך הבא" on the visit that follows a
-- customer's first sign-in and "ברוך שובך" on every visit after
-- it. That distinction has to be a property of the ACCOUNT, not of
-- the browser: a customer who signs in on a phone after using a
-- desktop is a returning customer and must be greeted as one.
--
-- The two existing columns cannot answer this question, which is
-- why a new one is needed:
--
--   • public.users.last_login_at is NULL for every Supabase
--     account. Only the legacy local-driver path in src/lib/api.ts
--     writes it, so on the hosted backend it carries no history.
--   • auth.users.last_sign_in_at is set by Supabase on the very
--     first sign-in as well, so by the time it is readable it is
--     already true for the login happening right now. It can never
--     distinguish the first login from the second.
--
-- greeted_at is therefore written exactly once per account, on the
-- first dashboard view, and read forever after.
-- ============================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS greeted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.greeted_at IS
  'Set once, on the first dashboard view after sign-in. NULL means the '
  'account has never been greeted; the dashboard renders "ברוך הבא" for '
  'exactly that state and "ברוך שובך" once this is set. Written per '
  'account so a second device never re-greets a returning customer.';

COMMIT;

-- The greeting must be claimable by the signed-in customer, and by
-- nobody else. Without RLS the anon key could UPDATE any account's
-- greeted_at — and, far worse, any other column on `users`. Enabling
-- RLS here and allowing exactly one narrow write is what makes the
-- UPDATE in src/lib/first-login.ts safe to run from the browser.
--
-- The column grant is the important half: `authenticated` may update
-- ONLY greeted_at, so a compromised client cannot escalate itself by
-- writing role = 'ADMIN' into its own profile row.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_read_own ON public.users;
CREATE POLICY users_read_own ON public.users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::uuid);

DROP POLICY IF EXISTS users_claim_greeting ON public.users;
CREATE POLICY users_claim_greeting ON public.users
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::uuid)
  WITH CHECK (user_id = auth.uid()::uuid);

REVOKE UPDATE ON public.users FROM authenticated;
GRANT UPDATE (greeted_at) ON public.users TO authenticated;

-- ============================================================
-- HOW THE APP USES IT
--
-- The greeting is claimed with a single conditional UPDATE that
-- returns a row only for the caller that actually set the value:
--
--   UPDATE public.users SET greeted_at = NOW()
--    WHERE user_id = $1 AND greeted_at IS NULL
--   RETURNING user_id;
--
-- A non-empty result means "this call was first, say ברוך הבא".
-- An empty result means somebody already greeted the account, say
-- ברוך שובך. Because the NULL test and the write happen in one
-- statement, two devices opening the dashboard at the same moment
-- cannot both win: the second UPDATE matches no row. A read-then-write
-- check in application code would have that race.
--
-- To reset the greeting for an account (support, or re-testing):
--   UPDATE public.users SET greeted_at = NULL WHERE user_id = '...';
-- ============================================================