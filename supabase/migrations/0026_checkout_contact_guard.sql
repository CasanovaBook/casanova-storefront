-- ============================================================
-- 0026 — the checkout contact rules, enforced where they are written
--        [REQUIRES A SERVER-SIDE FUNCTION]
--
-- WHAT THIS IS FOR
--
-- 0023 moved the money out of the browser: the price is re-derived from
-- `public.products` and a client cannot invent one. It left two rules behind
-- in the form, though. `CheckoutPage` marks the phone as required and refuses
-- to continue without one — "חובה לרכישה — לצורכי יצירת קשר על ההזמנה" — and
-- it validates the address with `emailProblem`. The RPC accepted whatever it
-- was told: `p_phone` is written as `NULLIF(btrim(...), '')`, so an empty
-- number is simply stored as no number, and `p_email` is written as
-- `btrim(p_email)` with no shape check at all. Any authenticated session
-- could therefore record a PAID order with no way to contact the buyer and
-- any string in the address column, without ever opening the form.
--
-- The rule itself is not new and is not being changed here. What is new is
-- that the layer which writes the row now agrees with the layer that states
-- the requirement, so the requirement is a rule rather than a courtesy.
--
-- COMPATIBILITY
--
-- This function is only called by the storefront checkout, and the form
-- already collects both values on every path that reaches it, so no existing
-- customer action is refused that would have succeeded before. Orders already
-- written are untouched — this is a guard on the INSERT, not a constraint on
-- the column, and deliberately so: adding a NOT NULL to `orders.customer_phone`
-- would fail on the historical rows, which the storefront does not own.
--
-- The phone test is permissive on purpose: the storefront writes the flat
-- local form (`0501234567`), but a number with a `+`, spaces, dashes or
-- brackets is still a number, and this is not the place to decide which
-- country's format a customer may leave behind. The shape test refuses
-- anything that is not essentially digits, which is the actual failure mode.
--
-- REFUSALS are bare tokens, mapped to Hebrew in
-- src/integrations/supabase/supabase-checkout.ts (CHECKOUT_REFUSALS), the
-- same arrangement 0011 and 0023 use. SQLSTATE 22023 is the one 0023 already
-- raises for `name_required`; the client matches the token in the message
-- before it falls back to the code, so the mapping stays unambiguous.
--
-- ROLLBACK AND RECOVERY
--
-- This migration changes no data, no table and no grant that 0023 did not
-- already set: it is one `CREATE OR REPLACE FUNCTION`. There is nothing to
-- unwind in the rows, and `storefront_order_seq` is untouched, so order
-- numbers keep advancing either way.
--
-- Supabase migrations are forward-only — deleting a row from
-- `supabase_migrations.schema_migrations` does not undo SQL that already ran.
-- To restore the previous behaviour, apply a corrective migration that
-- re-creates the function from 0023 (that file is idempotent: `CREATE OR
-- REPLACE`, `CREATE SEQUENCE IF NOT EXISTS`, and it grants the same
-- privileges to the same role). Re-running 0023 verbatim is the reviewed way
-- back; do not hand-edit the function in the SQL console, or the file and the
-- database stop describing the same thing.
--
-- Order of operations matters in one direction only. Applying this migration
-- while an older bundle is still deployed is safe: the old client also
-- required the phone in the form, so only crafted requests that skipped the
-- form start being refused. Rolling the bundle back after this migration is
-- applied is the case to avoid — the client would stop refusing, and the
-- function would, so a form bug would surface as a database error instead of
-- a field message.
-- ============================================================

BEGIN;

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
  v_email      text := btrim(COALESCE(p_email, ''));
  v_phone      text := btrim(COALESCE(p_phone, ''));
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

  -- The address the receipt goes to has to be a real, ASCII address. The
  -- form says as much (`emailProblem` refuses a Hebrew local part, and
  -- `isEmail` requires ASCII), and the auth account behind it can only hold
  -- an ASCII address anyway — so a non-Latin local part here was never a
  -- deliverable address, just a string in a column.
  IF v_email = ''
     OR v_email !~ '^[A-Za-z0-9._%+!#$&''*/=?^`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'email_invalid' USING ERRCODE = '22023';
  END IF;

  -- A purchase is coordinated by phone in this store, so the number is part
  -- of the order rather than a nicety the form asks for and the database
  -- discards.
  IF v_phone = '' THEN
    RAISE EXCEPTION 'phone_required' USING ERRCODE = '22023';
  END IF;

  IF v_phone !~ '^\+?[0-9][0-9 ()-]{6,18}$' THEN
    RAISE EXCEPTION 'phone_invalid' USING ERRCODE = '22023';
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
    v_email, NULLIF(v_phone, ''), now()
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
  'public.products, and refuses a request with no contactable address or no '
  'phone number. Refuses once platform_settings.payment_provider is set, at '
  'which point a provider webhook owns approval.';

REVOKE ALL ON FUNCTION
  public.create_storefront_order(uuid, text, text, text, text, text, numeric)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.create_storefront_order(uuid, text, text, text, text, text, numeric)
  TO authenticated;

COMMIT;

-- ============================================================
-- VERIFICATION — run after applying
--
-- Only check 1 is safe to run against production: it reads the catalog.
-- Checks 2, 3 and 4 CALL the function, and a successful call writes a PAID
-- order, an order item, a captured manual payment and a live entitlement for
-- whichever account `auth.uid()` resolves to. Run them on a disposable
-- database. The SQL console cannot stand in for a customer session anyway:
-- it runs as a role with no `auth.uid()`, so every call there returns
-- `auth_required` before any of these guards is reached — a green console run
-- proves nothing about them. The real post-deployment check is one purchase
-- completed in the storefront, plus check 1.
-- ============================================================
-- 1. The guard is in the stored definition:
--
--    SELECT prosrc LIKE '%phone_required%' AND prosrc LIKE '%email_invalid%'
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname = 'create_storefront_order';
--
-- 2. A phone-less order is refused, in Hebrew on the storefront:
--
--    SELECT public.create_storefront_order(
--      '<a buyable product_id>', 'Test', 'Buyer', 'test@example.com', NULL);
--    -- expected: ERROR: phone_required
--
-- 3. A malformed or non-ASCII address is refused the same way:
--
--    SELECT public.create_storefront_order(
--      '<a buyable product_id>', 'Test', 'Buyer', 'not-an-address', '0501234567');
--    -- expected: ERROR: email_invalid
--
--    SELECT public.create_storefront_order(
--      '<a buyable product_id>', 'Test', 'Buyer', 'קונה@example.com', '0501234567');
--    -- expected: ERROR: email_invalid
--
-- 4. The normal storefront purchase still completes, and the row carries
--    both values:
--
--    SELECT public.create_storefront_order(
--      '<a buyable product_id>', 'Test', 'Buyer', 'test@example.com', '0501234567');
--
--    SELECT order_number, customer_email, customer_phone
--      FROM public.orders ORDER BY created_at DESC LIMIT 1;
-- ============================================================
