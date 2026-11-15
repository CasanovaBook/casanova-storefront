-- ============================================================
-- 0040 - guest checkout email delivery state
--
-- WHY
--
-- 0028 made the order RPC idempotent, but the Edge Function still generated
-- a recovery link and called Resend on every retry. A retry after a lost
-- response therefore consumed Supabase Auth and Resend rate limits even when
-- the welcome email had already been dispatched.
--
-- This migration gives the Edge Function one private row per order to claim
-- before it touches Auth or Resend, and changes the order RPC to report
-- whether this request inserted the order or returned an existing one.
--
-- The table is service-role only. It intentionally has no browser policies:
-- delivery state is server observability, not a client-readable order field.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.guest_checkout_email_deliveries (
  order_id            uuid PRIMARY KEY
                      REFERENCES public.orders(order_id) ON DELETE CASCADE,
  status              text NOT NULL
                      CHECK (status IN ('SENDING', 'SENT', 'FAILED')),
  reason              text,
  provider_message_id text,
  attempted_at        timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.guest_checkout_email_deliveries IS
  'One private welcome-email attempt per guest order; lets retries return the recorded outcome without another Auth/Resend call.';

COMMENT ON COLUMN public.guest_checkout_email_deliveries.reason IS
  'Sanitized delivery reason code, never a provider error body or customer data.';

ALTER TABLE public.guest_checkout_email_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guest_checkout_email_deliveries
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.guest_checkout_email_deliveries
  TO service_role;

-- Same function signature; only the returned JSON gains `created`, so
-- existing callers keep working. `created` is false for the idempotent
-- existing-order branch and true for a newly inserted order.
CREATE OR REPLACE FUNCTION public.create_guest_storefront_order(
  p_user_id        uuid,
  p_product_id     uuid,
  p_first_name     text,
  p_last_name      text,
  p_email          text,
  p_phone          text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile     public.users;
  v_product     public.products;
  v_settings    public.platform_settings;
  v_existing    public.orders;
  v_order       public.orders;
  v_item        public.order_items;
  v_entitlement public.user_products;
  v_snapshot    jsonb;
  v_prefix      text;
  v_order_no    text;
  v_unit        numeric(10,2);
  v_discount    numeric(10,2);
  v_total       numeric(10,2);
  v_email       text := lower(btrim(COALESCE(p_email, '')));
  v_phone       text := btrim(COALESCE(p_phone, ''));
  v_key         text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_profile FROM public.users WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- The Edge Function resolves the id by this address. If the profile no
  -- longer matches, refuse rather than attaching a purchase to an account
  -- the request cannot prove it owns.
  IF lower(btrim(v_profile.email)) <> v_email THEN
    RAISE EXCEPTION 'email_conflict' USING ERRCODE = 'P0001';
  END IF;

  IF v_profile.account_status IN ('SUSPENDED', 'DEACTIVATED') THEN
    RAISE EXCEPTION 'account_suspended' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings
    FROM public.platform_settings
   WHERE is_singleton
   LIMIT 1;

  -- A live gateway means approval belongs to its webhook. Guest checkout has
  -- no webhook path yet, so refuse instead of auto-approving.
  IF v_settings.payment_provider IS NOT NULL THEN
    RAISE EXCEPTION 'gateway_configured' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE product_id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_product.status <> 'ACTIVE'
     OR v_product.visibility = 'HIDDEN'
     OR v_product.availability = 'OUT_OF_STOCK' THEN
    RAISE EXCEPTION 'product_unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF btrim(COALESCE(p_first_name, '')) = ''
     OR btrim(COALESCE(p_last_name, '')) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = '22023';
  END IF;

  IF v_email = ''
     OR v_email !~ '^[A-Za-z0-9._%+!#$&''*/=?^`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'email_invalid' USING ERRCODE = '22023';
  END IF;

  IF v_phone = '' THEN
    RAISE EXCEPTION 'phone_required' USING ERRCODE = '22023';
  END IF;

  IF v_phone !~ '^\+?[0-9][0-9 ()-]{6,18}$' THEN
    RAISE EXCEPTION 'phone_invalid' USING ERRCODE = '22023';
  END IF;

  -- A retry after a lost response returns the original order instead of
  -- recording a second paid order. `created` is false so the Edge Function
  -- can avoid a fresh recovery-link/Resend attempt.
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.orders
     WHERE user_id = p_user_id
       AND idempotency_key = v_key
     LIMIT 1;

    IF FOUND THEN
      SELECT * INTO v_item
        FROM public.order_items
       WHERE order_id = v_existing.order_id
       ORDER BY order_item_id
       LIMIT 1;

      SELECT * INTO v_entitlement
        FROM public.user_products
       WHERE user_id = p_user_id
         AND product_id = p_product_id;

      RETURN jsonb_build_object(
        'created', FALSE,
        'order', to_jsonb(v_existing),
        'item', to_jsonb(v_item),
        'entitlement', to_jsonb(v_entitlement),
        'customer', jsonb_build_object(
          'user_id', v_profile.user_id,
          'first_name', v_profile.first_name,
          'last_name', v_profile.last_name,
          'email', v_profile.email,
          'phone', v_profile.phone,
          'role', v_profile.role,
          'admin_role', v_profile.admin_role
        )
      );
    END IF;
  END IF;

  -- Server-side price. The request never supplies an amount.
  v_unit := v_product.price;

  IF v_product.sale_price IS NOT NULL AND v_product.sale_price < v_product.price THEN
    v_unit := v_product.sale_price;
  END IF;

  v_discount := 0;
  v_total := v_unit;

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
    customer_email, customer_phone, paid_at, idempotency_key
  ) VALUES (
    v_order_no, p_user_id, 'PAID', 'PAID',
    v_unit, v_discount, v_total, v_product.currency,
    NULL, btrim(p_first_name), btrim(p_last_name),
    v_email, NULLIF(v_phone, ''), now(), v_key
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
    p_user_id, v_product.product_id, v_snapshot, v_order.order_id,
    'ACTIVE', now()
  )
  ON CONFLICT (user_id, product_id) DO UPDATE
     SET access_status    = 'ACTIVE',
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
    'created', TRUE,
    'order', to_jsonb(v_order),
    'item', to_jsonb(v_item),
    'entitlement', to_jsonb(v_entitlement),
    'customer', jsonb_build_object(
      'user_id', v_profile.user_id,
      'first_name', v_profile.first_name,
      'last_name', v_profile.last_name,
      'email', v_profile.email,
      'phone', v_profile.phone,
      'role', v_profile.role,
      'admin_role', v_profile.admin_role
    )
  );
END;
$$;

COMMENT ON FUNCTION public.create_guest_storefront_order(
  uuid, uuid, text, text, text, text, text
) IS
  'Service-role-only guest checkout: records a PAID manual order, its item, '
  'a captured payment and the entitlement for an explicitly resolved user id. '
  'Priced from public.products; refuses once a payment gateway is configured. '
  'Idempotent on orders.idempotency_key and reports created=true only for a '
  'new order.';

REVOKE ALL ON FUNCTION public.create_guest_storefront_order(
  uuid, uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_guest_storefront_order(
  uuid, uuid, text, text, text, text, text
) TO service_role;

COMMIT;

-- ============================================================
-- VERIFICATION AFTER APPLYING
-- ============================================================
-- 1. The delivery table is invisible to browser roles:
--
--   SELECT has_table_privilege('anon',
--            'public.guest_checkout_email_deliveries', 'SELECT') AS anon_can_read,
--          has_table_privilege('authenticated',
--            'public.guest_checkout_email_deliveries', 'SELECT') AS auth_can_read;
--
--   Expected: false, false.
--
-- 2. The RPC still reports its insert/retry distinction:
--
--   SELECT public.create_guest_storefront_order(...)->>'created';
--
--   Expected: true on the first call and false for a replay with the same
--   idempotency key.
-- ============================================================
