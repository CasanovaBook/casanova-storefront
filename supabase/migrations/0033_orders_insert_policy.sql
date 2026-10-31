-- ============================================================
-- 0033 - tighten direct INSERTs into public.orders
--
-- The live policy "Users can create pending order for themselves" has no
-- WITH CHECK expression, so any authenticated caller can supply another
-- user's user_id (and a non-pending status). For an INSERT policy the
-- expression that matters is pg_policy.polwithcheck / pg_policies.with_check;
-- pg_policies.qual is NULL for INSERT policies by definition.
--
-- This migration:
--   1. makes sure RLS is enabled on public.orders;
--   2. drops the permissive policy and recreates it scoped to
--      `authenticated`, requiring auth.uid() = user_id and a draft-only
--      order: order_status and payment_status must be PENDING, with no
--      paid/cancelled timestamps.
--
-- The schema's CHECK constraints use upper-case status values. A literal
-- 'pending' would be rejected by chk_order_status, so the policy uses
-- 'PENDING'.
--
-- Note: server-side order writers are SECURITY DEFINER functions owned by a
-- privileged role (create_storefront_order, create_guest_storefront_order,
-- and the admin order RPCs). They are not subject to this client INSERT
-- policy and keep creating PAID orders. If no browser code inserts orders
-- directly, the strongest option is to drop the INSERT policy entirely and
-- keep all writes behind those RPCs.
--
-- Before applying, inspect for OTHER permissive INSERT policies on orders:
-- permissive policies are OR-ed, so this stricter policy does not restrict
-- inserts if another INSERT policy still allows them.
--
--   SELECT polname, polcmd::text, polroles::regrole[],
--          pg_get_expr(polqual, polrelid)       AS using_expr,
--          pg_get_expr(polwithcheck, polrelid)  AS with_check_expr
--     FROM pg_policy
--    WHERE polrelid = 'public.orders'::regclass;
-- ============================================================

BEGIN;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Codify the draft defaults as well; the policy below rejects anything
-- that tries to bypass them.
ALTER TABLE public.orders
  ALTER COLUMN order_status SET DEFAULT 'PENDING',
  ALTER COLUMN payment_status SET DEFAULT 'PENDING';

DROP POLICY IF EXISTS "Users can create pending order for themselves"
  ON public.orders;

CREATE POLICY "Users can create pending order for themselves"
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND order_status = 'PENDING'
    AND payment_status = 'PENDING'
    AND paid_at IS NULL
    AND cancelled_at IS NULL
  );

COMMIT;
