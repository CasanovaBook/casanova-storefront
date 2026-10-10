-- ============================================================
-- 0023 — checkout that writes the real order and entitlement
--        [REQUIRES A SERVER-SIDE FUNCTION]
--
-- THE BUG
--
-- `checkout()` in src/lib/api-orders.ts read the product, wrote the order and
-- granted the entitlement in `localStorage`. The reader is served through the
-- `get-content-url` edge function, which resolves a protected file only for an
-- account holding an ACTIVE row in `public.user_products`. So on the hosted
-- deployment a completed purchase produced a local order nobody could fulfil,
-- an entitlement the edge function could not see, and a reader that answered
-- "אין לך הרשאת גישה פעילה לספר זה".
--
-- WHAT THIS FUNCTION IS
--
-- One transaction that: resolves the product and its price from the catalogue
-- (never from the request), records the order, its line item and a captured
-- manual payment, and writes the buyer's entitlement. The entitlement snapshot
-- is built server-side from the product row, exactly like 0015's
-- `admin_grant_access`, so a renamed or later-archived title still renders in
-- the customer's library.
--
-- WHY IT IS ALLOWED TO SELF-GRANT — AND WHEN IT STOPS
--
-- This deployment has no payment gateway, and the web checkout is already
-- auto-approving every order for exactly that reason (src/lib/api-orders.ts,
-- `if (!provider)`). The function keeps that behaviour: it records a PAID
-- order and grants access in one transaction. It refuses the moment
-- `platform_settings.payment_provider` is set — at that point money must be
-- captured by a webhook first, and this RPC stops being an approval path
-- instead of quietly remaining one.
--
-- It grants only to `auth.uid()`: a caller can never name another account.
--
-- BLINDING: the price is re-derived from `public.products` (sale price when
-- lower) and any client-supplied discount is clamped to the subtotal, so a
-- request cannot invent a price. Coupon validity is still evaluated in the
-- browser (coupons have not moved to Supabase yet); the code is stored for
-- provenance and the discount is only ever applied downward.
-- ============================================================

BEGIN;

-- Order numbers come from a sequence, not from COUNT(*): two simultaneous
-- checkouts must not compute the same customer-facing number.
CREATE SEQUENCE IF NOT EXISTS public.storefront_order_seq;

-- ============================================================
-- CREATE ORDER AND GRANT
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_storefront_order(
  p_product_id  uuid,
  p_first_name  text,
  p_last_name   text,
  p_email       text,
  p_phone       text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_discount    numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile    public.users;
  v_product    public.products;
  v_prefix     text;
  v_order_no   text;
  v_order      public.orders;
  v_item       public.order_items;
  v_entitlement public.user_products;
  v_snapshot   jsonb;
  v_unit       numeric(10,2);
  v_discount   numeric(10,2);
  v_total      numeric(10,2);
  v_settings   public.platform_settings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin() THEN
    SELECT * INTO v_settings
      FROM public.platform_settings
     WHERE is_singleton
     LIMIT 1;

    -- A live gateway means approval belongs to its webhook. Refuse rather
    -- than keep auto-approving behind the gateway's back.
    IF v_settings.payment_provider IS NOT NULL THEN
      RAISE EXCEPTION 'gateway_configured' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_profile FROM public.users WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_profile.account_status = 'SUSPENDED' THEN
    RAISE EXCEPTION 'account_suspended' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE product_id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Mirrors the storefront rule: only an ACTIVE product that is not HIDDEN
  -- can be bought, and an out-of-stock one cannot be sold at all.
  IF v_product.status <> 'ACTIVE'
     OR v_product.visibility = 'HIDDEN'
     OR v_product.availability = 'OUT_OF_STOCK' THEN
    RAISE EXCEPTION 'product_unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF btrim(COALESCE(p_first_name, '')) = ''
     OR btrim(COALESCE(p_last_name, '')) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = '22023';
  END IF;

  -- Server-side price. A sale price only counts when it is actually lower.
  v_unit := v_product.price;
  IF v_product.sale_price IS NOT NULL AND v_product.sale_price < v_product.price THEN
    v_unit := v_product.sale_price;
  END IF;

  v_discount := LEAST(GREATEST(COALESCE(p_discount, 0), 0), v_unit);
  v_total := v_unit - v_discount;

  SELECT COALESCE(NULLIF(btrim(order_prefix), ''), 'ORD')
    INTO v_prefix
    FROM public.platform_settings
   WHERE is_singleton
   LIMIT 1;

  v_order_no := COALESCE(v_prefix, 'ORD') || '-' || to_char(now(), 'YYYY') || '-' ||
                lpad(nextval('public.storefront_order_seq')::text, 6, '0');

  INSERT INTO public.orders (
    order_number, user_id, order_status, payment_status,
    subtotal, discount_amount, total_amount, currency,
    coupon_code, customer_first_name, customer_last_name,
    customer_email, customer_phone, paid_at
  ) VALUES (
    v_order_no, v_uid, 'PAID', 'PAID',
    v_unit, v_discount, v_total, v_product.currency,
    NULLIF(btrim(COALESCE(p_coupon_code, '')), ''),
    btrim(p_first_name), btrim(p_last_name),
    btrim(p_email), NULLIF(btrim(COALESCE(p_phone, '')), ''), now()
  )
  RETURNING * INTO v_order;

  INSERT INTO public.order_items (
    order_id, product_id, product_name, product_slug, quantity,
    unit_price, discount_amount, line_total
  ) VALUES (
    v_order.order_id, v_product.product_id, v_product.name, v_product.slug, 1,
    v_unit, v_discount, v_total
  )
  RETURNING * INTO v_item;

  INSERT INTO public.payments (
    order_id, provider, status, amount, currency,
    transaction_reference, captured_at
  ) VALUES (
    v_order.order_id, 'MANUAL', 'CAPTURED', v_total, v_product.currency,
    'AUTO-' || v_order.order_number, now()
  );

  -- Snapshot from the catalogue, never from the request body — the same
  -- contract 0015 uses for a manual grant.
  SELECT jsonb_strip_nulls(
           jsonb_build_object(
             'product_id',   p.product_id,
             'name',         p.name,
             'slug',         p.slug,
             'product_type', p.product_type,
             'cover_colors', p.cover_colors,
             'image_url',    p.image_url,
             'author_name',  b.author_name,
             'total_pages',  b.total_pages
           )
         )
    INTO v_snapshot
    FROM public.products p
    LEFT JOIN public.books b ON b.product_id = p.product_id
   WHERE p.product_id = v_product.product_id;

  INSERT INTO public.user_products (
    user_id, product_id, product_snapshot, source_order_id,
    access_status, granted_at
  ) VALUES (
    v_uid, v_product.product_id, v_snapshot, v_order.order_id,
    'ACTIVE', now()
  )
  ON CONFLICT (user_id, product_id) DO UPDATE
     SET access_status    = 'ACTIVE',
         -- A fresh purchase restores unrestricted access: an expiry from an
         -- earlier time-limited grant must not survive the new order.
         expires_at       = NULL,
         product_snapshot = EXCLUDED.product_snapshot,
         source_order_id  = COALESCE(public.user_products.source_order_id,
                                     EXCLUDED.source_order_id),
         granted_at       = now(),
         revoked_at       = NULL,
         revoked_by       = NULL,
         revoke_reason    = NULL
  RETURNING * INTO v_entitlement;

  RETURN jsonb_build_object(
    'order',       to_jsonb(v_order),
    'item',        to_jsonb(v_item),
    'entitlement', to_jsonb(v_entitlement),
    'customer', jsonb_build_object(
      'user_id',    v_profile.user_id,
      'first_name', v_profile.first_name,
      'last_name',  v_profile.last_name,
      'email',      v_profile.email,
      'phone',      v_profile.phone,
      'role',       v_profile.role,
      'admin_role', v_profile.admin_role
    )
  );
END;
$$;

COMMENT ON FUNCTION public.create_storefront_order(uuid, text, text, text, text, text, numeric) IS
  'Signed-in storefront checkout with no payment gateway connected: records a '
  'PAID order, its item, a captured manual payment and the buyer''s '
  'public.user_products entitlement in one transaction, priced from '
  'public.products. Refuses once platform_settings.payment_provider is set, '
  'at which point a provider webhook owns approval.';

REVOKE ALL ON FUNCTION
  public.create_storefront_order(uuid, text, text, text, text, text, numeric)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.create_storefront_order(uuid, text, text, text, text, text, numeric)
  TO authenticated;

COMMIT;

-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
-- 1. The function exists, is SECURITY DEFINER and pins search_path:
--
--    SELECT p.proname, p.prosecdef, p.proconfig
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname = 'create_storefront_order';
--
-- 2. Only authenticated may execute it (`anon` must NOT appear):
--
--    SELECT grantee, privilege_type
--      FROM information_schema.routine_privileges
--     WHERE routine_name = 'create_storefront_order';
--
-- 3. After one real checkout, the order is in Postgres and so is the grant:
--
--    SELECT order_number, order_status, payment_status, total_amount
--      FROM public.orders ORDER BY created_at DESC LIMIT 1;
--
--    SELECT user_id, product_id, access_status
--      FROM public.user_products
--     WHERE source_order_id = '<the order_id from the row above>';
--
-- 4. Per-product check: after a purchase the order references the same UUID
--    the storefront sells, and the reader's edge function accepts it.
-- ============================================================
