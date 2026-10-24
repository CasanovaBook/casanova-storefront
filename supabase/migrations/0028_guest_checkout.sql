-- ============================================================
-- 0028 - Guest checkout: provision account, grant access, deliver setup link
-- ============================================================
-- The existing create_storefront_order RPC is bound to auth.uid() and is
-- executable only by authenticated. A guest has no session, so checkout now
-- goes through a service-role Edge Function that:
--
--   1. finds or creates the Supabase Auth user for the typed email,
--   2. ensures the matching public.users profile,
--   3. calls create_guest_storefront_order below,
--   4. sends a Supabase recovery email so the buyer can set a password.
--
-- This migration adds the service-role-only building blocks and hardens the
-- CMS write policies. Auto-created customer accounts must not inherit the
-- current "any authenticated user may write site content" behaviour.
--
-- Payment model: no gateway is connected, so the order is auto-approved and
-- the entitlement is granted immediately. The gateway guard stays in place;
-- a real gateway needs a webhook and a pending-order flow first.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Auth lookup (service role only)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
    FROM auth.users
   WHERE email IS NOT NULL
     AND lower(email) = lower(btrim(COALESCE(p_email, '')))
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_auth_user_id_by_email(text) IS
  'Service-role-only lookup used by the guest-checkout Edge Function to find '
  'an existing Supabase Auth user before creating one.';

REVOKE ALL ON FUNCTION public.get_auth_user_id_by_email(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text)
  TO service_role;

-- ------------------------------------------------------------
-- Idempotency for guest checkout retries
-- ------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
  ON public.orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ------------------------------------------------------------
-- Guest order RPC (service role only)
-- ------------------------------------------------------------
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
  -- recording a second paid order.
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
  'Idempotent on orders.idempotency_key.';

REVOKE ALL ON FUNCTION public.create_guest_storefront_order(
  uuid, uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_guest_storefront_order(
  uuid, uuid, text, text, text, text, text
) TO service_role;

-- ------------------------------------------------------------
-- CMS write hardening
-- ------------------------------------------------------------
-- Auto-created customers receive the authenticated role. The policies from
-- 0002/0003 let any authenticated user write CMS content. Restrict every
-- write to staff whose admin_role carries cms:edit_live (the same matrix the
-- CMS UI uses). Keep all public SELECT policies unchanged.
DO $$
BEGIN
  IF to_regprocedure('public.admin_has_permission(text)') IS NULL THEN
    RAISE EXCEPTION
      'public.admin_has_permission(text) is missing; apply migration 0024 first';
  END IF;
END;
$$;

DROP POLICY IF EXISTS site_content_write ON public.site_content;
CREATE POLICY site_content_write ON public.site_content
  FOR ALL TO authenticated
  USING (public.admin_has_permission('cms:edit_live'))
  WITH CHECK (public.admin_has_permission('cms:edit_live'));

DROP POLICY IF EXISTS media_write ON public.media;
CREATE POLICY media_write ON public.media
  FOR ALL TO authenticated
  USING (public.admin_has_permission('cms:edit_live'))
  WITH CHECK (public.admin_has_permission('cms:edit_live'));

DROP POLICY IF EXISTS maestro_audit_read ON public.maestro_audit_log;
CREATE POLICY maestro_audit_read ON public.maestro_audit_log
  FOR SELECT TO authenticated
  USING (public.admin_has_permission('cms:edit_live'));

DROP POLICY IF EXISTS maestro_audit_write ON public.maestro_audit_log;
CREATE POLICY maestro_audit_write ON public.maestro_audit_log
  FOR ALL TO authenticated
  USING (public.admin_has_permission('cms:edit_live'))
  WITH CHECK (public.admin_has_permission('cms:edit_live'));

DO $$
BEGIN
  IF to_regclass('public.cms_pages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS cms_pages_write ON public.cms_pages';
    EXECUTE $policy$
      CREATE POLICY cms_pages_write ON public.cms_pages
        FOR ALL TO authenticated
        USING (public.admin_has_permission('cms:edit_live'))
        WITH CHECK (public.admin_has_permission('cms:edit_live'))
    $policy$;
  ELSE
    RAISE NOTICE 'guest_checkout: cms_pages does not exist, skipping policy';
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.cms_categories') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS cms_categories_write ON public.cms_categories';
    EXECUTE $policy$
      CREATE POLICY cms_categories_write ON public.cms_categories
        FOR ALL TO authenticated
        USING (public.admin_has_permission('cms:edit_live'))
        WITH CHECK (public.admin_has_permission('cms:edit_live'))
    $policy$;
  ELSE
    RAISE NOTICE 'guest_checkout: cms_categories does not exist, skipping policy';
  END IF;
END;
$$;

COMMIT;

-- ============================================================
-- Verification after applying
-- ============================================================
-- 1. Service-role only:
--
--   SELECT has_function_privilege(
--            'anon',
--            'public.create_guest_storefront_order(uuid,uuid,text,text,text,text,text)',
--            'EXECUTE') AS anon_can_execute,
--          has_function_privilege(
--            'authenticated',
--            'public.create_guest_storefront_order(uuid,uuid,text,text,text,text,text)',
--            'EXECUTE') AS authenticated_can_execute;
--
--   Expected: false, false.
--
-- 2. CMS policies:
--
--   SELECT tablename, policyname, roles, cmd
--     FROM pg_policies
--    WHERE policyname IN (
--      'site_content_write', 'media_write',
--      'maestro_audit_read', 'maestro_audit_write',
--      'cms_pages_write', 'cms_categories_write'
--    )
--    ORDER BY tablename, policyname;
--
-- 3. Staff access check (run as a staff JWT):
--
--   SELECT public.admin_has_permission('cms:edit_live');
--
--   Expected: true for every CMS staff admin_role.
-- ============================================================
