-- ============================================================
-- 0039 - hosted admin order writes, invoices and refunds
--
-- WHY
--
-- 0033 established that a browser may only INSERT its own draft order;
-- every other order transition belongs behind a server-side function.
-- The admin panel kept calling the local-store services, so a hosted
-- order rendered in /admin/orders could not be found by "mark paid",
-- "mark failed", "cancel" or "issue invoice" - the local document never
-- held it. A hosted invoice or refund was just as invisible.
--
-- This file provides the missing server side:
--
--   reads    staff SELECT policies on orders, order_items, invoices,
--            refunds, payments and audit_logs
--   writes   admin_mark_order_paid / _failed / _cancel
--            admin_issue_invoice
--            admin_request_refund / _review / _execute / _confirm / _fail
--
-- Every write is SECURITY DEFINER, pins search_path, checks
-- admin_has_permission() against the 0024 matrix, and appends the
-- matching row to audit_logs in the same transaction. The client never
-- gets a raw table-write grant for these tables.
--
-- The order RPCs deliberately reuse the same facts the local service
-- enforced: a paid order cannot be cancelled, a paid order is the only
-- one that can be invoiced, refunds may not exceed the unrefunded
-- balance, and an invoice number is unique per order.
-- ============================================================

BEGIN;

-- ============================================================
-- STAFF READS
-- ============================================================
ALTER TABLE public.orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs      ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'orders'
       AND policyname = 'orders_select_staff'
  ) THEN
    CREATE POLICY orders_select_staff ON public.orders
      FOR SELECT TO authenticated USING (public.is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'order_items'
       AND policyname = 'order_items_select_staff'
  ) THEN
    CREATE POLICY order_items_select_staff ON public.order_items
      FOR SELECT TO authenticated USING (public.is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'invoices'
       AND policyname = 'invoices_select_staff'
  ) THEN
    CREATE POLICY invoices_select_staff ON public.invoices
      FOR SELECT TO authenticated USING (public.is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'refunds'
       AND policyname = 'refunds_select_staff'
  ) THEN
    CREATE POLICY refunds_select_staff ON public.refunds
      FOR SELECT TO authenticated USING (public.is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'payments'
       AND policyname = 'payments_select_staff'
  ) THEN
    CREATE POLICY payments_select_staff ON public.payments
      FOR SELECT TO authenticated USING (public.is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'audit_logs'
       AND policyname = 'audit_logs_select_staff'
  ) THEN
    CREATE POLICY audit_logs_select_staff ON public.audit_logs
      FOR SELECT TO authenticated USING (public.is_admin());
  END IF;
END;
$$;

-- ============================================================
-- AUDIT HELPER
--
-- Not granted to authenticated: it is an implementation detail of the
-- RPCs below. A caller must not be able to write arbitrary audit rows.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_record_audit(
  p_category     text,
  p_action       text,
  p_target_type  text,
  p_target_id    text,
  p_target_label text,
  p_details      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
  v_role text;
BEGIN
  SELECT COALESCE(NULLIF(btrim(first_name || ' ' || last_name), ''), email),
         COALESCE(admin_role, role)
    INTO v_name, v_role
    FROM public.users
   WHERE user_id = auth.uid();

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, category, action,
    target_type, target_id, target_label, details
  ) VALUES (
    auth.uid(),
    COALESCE(v_name, 'מערכת'),
    COALESCE(v_role, 'SYSTEM'),
    p_category,
    p_action,
    p_target_type,
    p_target_id,
    p_target_label,
    p_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_audit(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_record_audit(text, text, text, text, text, text) FROM anon;

-- ============================================================
-- MARK PAID
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_mark_order_paid(
  p_order_id   uuid,
  p_provider   text DEFAULT NULL,
  p_reference  text DEFAULT NULL,
  p_card_last4 text DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order    public.orders;
  v_item     record;
  v_snapshot jsonb;
  v_provider text;
BEGIN
  IF NOT public.admin_has_permission('mark_paid') THEN
    RAISE EXCEPTION 'permission_denied: mark_paid' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
    FROM public.orders
   WHERE order_id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.payment_status = 'PAID' THEN
    RAISE EXCEPTION 'order_already_paid' USING ERRCODE = '23505';
  END IF;

  IF v_order.payment_status IN ('REFUNDED', 'PARTIALLY_REFUNDED') THEN
    RAISE EXCEPTION 'order_already_refunded' USING ERRCODE = '23505';
  END IF;

  IF v_order.order_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'order_cancelled' USING ERRCODE = '23505';
  END IF;

  UPDATE public.orders
     SET payment_status = 'PAID',
         order_status   = 'PAID',
         paid_at        = COALESCE(paid_at, now()),
         cancelled_at   = NULL,
         updated_at     = now()
   WHERE order_id = p_order_id
  RETURNING * INTO v_order;

  v_provider := COALESCE(NULLIF(btrim(COALESCE(p_provider, '')), ''), 'MANUAL');

  -- payments.CHECK requires a transaction reference for CAPTURED. The
  -- panel allows a manual confirmation without one, so the payment row
  -- is written only when there is a real reference to record.
  IF NULLIF(btrim(COALESCE(p_reference, '')), '') IS NOT NULL THEN
    INSERT INTO public.payments (
      order_id, provider, status, amount, currency,
      transaction_reference, card_last4, captured_at
    ) VALUES (
      p_order_id, v_provider, 'CAPTURED', v_order.total_amount,
      v_order.currency, btrim(p_reference),
      NULLIF(btrim(COALESCE(p_card_last4, '')), ''), now()
    );
  END IF;

  -- A confirmed purchase grants access to every purchased title, using
  -- the same snapshot rules as admin_grant_access (0015/0024).
  FOR v_item IN
    SELECT product_id FROM public.order_items WHERE order_id = p_order_id
  LOOP
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
     WHERE p.product_id = v_item.product_id;

    IF v_snapshot IS NOT NULL THEN
      INSERT INTO public.user_products (
        user_id, product_id, product_snapshot, source_order_id,
        access_status, granted_at, granted_by
      ) VALUES (
        v_order.user_id, v_item.product_id, v_snapshot, p_order_id,
        'ACTIVE', now(), auth.uid()
      )
      ON CONFLICT (user_id, product_id) DO UPDATE
         SET access_status    = 'ACTIVE',
             expires_at       = NULL,
             product_snapshot = EXCLUDED.product_snapshot,
             source_order_id  = COALESCE(
                                  public.user_products.source_order_id,
                                  EXCLUDED.source_order_id
                                ),
             granted_at       = now(),
             granted_by       = auth.uid(),
             revoked_at       = NULL,
             revoked_by       = NULL,
             revoke_reason    = NULL;
    END IF;
  END LOOP;

  PERFORM public.admin_record_audit(
    'ORDER_CHANGE',
    'אישור תשלום',
    'ORDER',
    p_order_id::text,
    v_order.order_number || ' · ' || v_order.customer_first_name || ' ' || v_order.customer_last_name,
    '₪' || v_order.total_amount::text || ' · ' || v_provider ||
      COALESCE(' · ' || NULLIF(btrim(p_reference), ''), '')
  );

  RETURN v_order;
END;
$$;

-- ============================================================
-- MARK FAILED
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_mark_order_failed(
  p_order_id uuid,
  p_reason   text
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders;
BEGIN
  IF NOT public.admin_has_permission('mark_paid') THEN
    RAISE EXCEPTION 'permission_denied: mark_paid' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
    FROM public.orders
   WHERE order_id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.payment_status IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED') THEN
    RAISE EXCEPTION 'order_already_paid' USING ERRCODE = '23505';
  END IF;

  UPDATE public.orders
     SET payment_status = 'FAILED',
         order_status   = 'FAILED',
         updated_at     = now()
   WHERE order_id = p_order_id
  RETURNING * INTO v_order;

  UPDATE public.payments
     SET status = 'FAILED', failure_reason = btrim(p_reason)
   WHERE order_id = p_order_id AND status = 'PENDING';

  PERFORM public.admin_record_audit(
    'ORDER_CHANGE',
    'סימון תשלום ככושל',
    'ORDER',
    p_order_id::text,
    v_order.order_number,
    btrim(p_reason)
  );

  RETURN v_order;
END;
$$;

-- ============================================================
-- CANCEL
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  p_order_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders;
BEGIN
  IF NOT public.admin_has_permission('edit_order') THEN
    RAISE EXCEPTION 'permission_denied: edit_order' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
    FROM public.orders
   WHERE order_id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.payment_status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') THEN
    RAISE EXCEPTION 'order_paid_cannot_cancel' USING ERRCODE = '23505';
  END IF;

  UPDATE public.orders
     SET payment_status = 'CANCELLED',
         order_status   = 'CANCELLED',
         cancelled_at   = now(),
         updated_at     = now()
   WHERE order_id = p_order_id
  RETURNING * INTO v_order;

  PERFORM public.admin_record_audit(
    'ORDER_CHANGE',
    'ביטול הזמנה',
    'ORDER',
    p_order_id::text,
    v_order.order_number,
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), '-')
  );

  RETURN v_order;
END;
$$;

-- ============================================================
-- INVOICE
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq;

CREATE OR REPLACE FUNCTION public.admin_issue_invoice(p_order_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order   public.orders;
  v_invoice public.invoices;
  v_prefix  text;
  v_number  text;
BEGIN
  IF NOT public.admin_has_permission('finance') THEN
    RAISE EXCEPTION 'permission_denied: finance' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
    FROM public.orders
   WHERE order_id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.payment_status NOT IN ('PAID', 'PARTIALLY_REFUNDED') THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE order_id = p_order_id;
  IF FOUND THEN
    RAISE EXCEPTION 'invoice_exists' USING ERRCODE = '23505';
  END IF;

  SELECT NULLIF(btrim(invoice_prefix), '') INTO v_prefix
    FROM public.platform_settings
   LIMIT 1;

  v_number := COALESCE(v_prefix, 'INV') || '-' ||
              to_char(now(), 'YYYY') || '-' ||
              lpad(nextval('public.invoice_number_seq')::text, 4, '0');

  BEGIN
    INSERT INTO public.invoices (
      order_id, invoice_number, amount, currency, issued_at, status
    ) VALUES (
      p_order_id, v_number, v_order.total_amount, v_order.currency, now(), 'ISSUED'
    )
    RETURNING * INTO v_invoice;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'invoice_exists' USING ERRCODE = '23505';
  END;

  PERFORM public.admin_record_audit(
    'OTHER',
    'הנפקת חשבונית',
    'INVOICE',
    p_order_id::text,
    v_order.order_number || ' · ' || v_order.customer_email,
    v_invoice.invoice_number
  );

  RETURN v_invoice;
END;
$$;

-- ============================================================
-- REFUNDS
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_request_refund(
  p_order_id uuid,
  p_amount   numeric,
  p_reason   text
)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order             public.orders;
  v_refund            public.refunds;
  v_payment_id        uuid;
  v_payment_provider  text;
  v_already           numeric;
  v_available         numeric;
BEGIN
  IF NOT public.admin_has_permission('refund') THEN
    RAISE EXCEPTION 'permission_denied: refund' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
    FROM public.orders
   WHERE order_id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.payment_status NOT IN ('PAID', 'PARTIALLY_REFUNDED') THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'refund_amount_invalid' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'refund_reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_already
    FROM public.refunds
   WHERE order_id = p_order_id
     AND status IN ('APPROVED', 'PROCESSING', 'REFUNDED');

  v_available := v_order.total_amount - v_already;
  IF p_amount > v_available THEN
    RAISE EXCEPTION 'refund_exceeds_balance' USING ERRCODE = '22023';
  END IF;

  SELECT payment_id, provider
    INTO v_payment_id, v_payment_provider
    FROM public.payments
   WHERE order_id = p_order_id AND status = 'CAPTURED'
   ORDER BY created_at DESC
   LIMIT 1;

  INSERT INTO public.refunds (
    order_id, payment_id, original_amount, amount, currency,
    reason, status, provider, requested_at, initiated_by_id
  ) VALUES (
    p_order_id, v_payment_id, v_order.total_amount, p_amount,
    v_order.currency, btrim(p_reason), 'REQUESTED', v_payment_provider,
    now(), auth.uid()
  )
  RETURNING * INTO v_refund;

  PERFORM public.admin_record_audit(
    'REFUND',
    'רישום בקשת החזר כספי',
    'ORDER',
    p_order_id::text,
    v_order.order_number || ' · ' || v_order.customer_first_name || ' ' || v_order.customer_last_name,
    '₪' || p_amount::text || ' מתוך ₪' || v_order.total_amount::text || ' · ' || btrim(p_reason)
  );

  RETURN v_refund;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_refund(
  p_refund_id uuid,
  p_decision  text,
  p_note      text DEFAULT NULL
)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refund public.refunds;
BEGIN
  IF NOT public.admin_has_permission('refund') THEN
    RAISE EXCEPTION 'permission_denied: refund' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'refund_decision_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_refund
    FROM public.refunds
   WHERE refund_id = p_refund_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_refund.status NOT IN ('REQUESTED', 'PENDING', 'FAILED') THEN
    RAISE EXCEPTION 'refund_status_invalid' USING ERRCODE = '23505';
  END IF;

  UPDATE public.refunds
     SET status      = p_decision,
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_note = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE refund_id = p_refund_id
  RETURNING * INTO v_refund;

  PERFORM public.admin_record_audit(
    'REFUND',
    CASE WHEN p_decision = 'APPROVED' THEN 'אישור בקשת החזר' ELSE 'דחיית בקשת החזר' END,
    'REFUND',
    p_refund_id::text,
    v_refund.order_id::text,
    '₪' || v_refund.amount::text ||
      COALESCE(' · ' || NULLIF(btrim(p_note), ''), '')
  );

  RETURN v_refund;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_execute_refund(p_refund_id uuid)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refund      public.refunds;
  v_enabled     boolean;
  v_provider    text;
BEGIN
  IF NOT public.admin_has_permission('execute_refund') THEN
    RAISE EXCEPTION 'permission_denied: execute_refund' USING ERRCODE = '42501';
  END IF;

  SELECT refund_execution_enabled, payment_provider
    INTO v_enabled, v_provider
    FROM public.platform_settings
   LIMIT 1;

  IF NOT COALESCE(v_enabled, false)
     OR NULLIF(btrim(COALESCE(v_provider, '')), '') IS NULL THEN
    RAISE EXCEPTION 'refund_execution_disabled' USING ERRCODE = '0A000';
  END IF;

  SELECT * INTO v_refund
    FROM public.refunds
   WHERE refund_id = p_refund_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_refund.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'refund_status_invalid' USING ERRCODE = '23505';
  END IF;

  UPDATE public.refunds
     SET status   = 'PROCESSING',
         provider = v_provider
   WHERE refund_id = p_refund_id
  RETURNING * INTO v_refund;

  PERFORM public.admin_record_audit(
    'REFUND',
    'שליחת החזר לספק התשלומים',
    'REFUND',
    p_refund_id::text,
    v_refund.order_id::text,
    '₪' || v_refund.amount::text || ' · ' || v_provider
  );

  RETURN v_refund;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_confirm_refund(
  p_refund_id         uuid,
  p_provider_refund_id text
)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refund public.refunds;
  v_order  public.orders;
  v_total  numeric;
BEGIN
  IF NOT public.admin_has_permission('execute_refund') THEN
    RAISE EXCEPTION 'permission_denied: execute_refund' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(COALESCE(p_provider_refund_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'refund_provider_reference_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_refund
    FROM public.refunds
   WHERE refund_id = p_refund_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_refund.status NOT IN ('PROCESSING', 'APPROVED') THEN
    RAISE EXCEPTION 'refund_status_invalid' USING ERRCODE = '23505';
  END IF;

  UPDATE public.refunds
     SET status             = 'REFUNDED',
         provider_refund_id = btrim(p_provider_refund_id),
         processed_at       = now(),
         reviewed_at        = COALESCE(reviewed_at, now()),
         reviewed_by        = COALESCE(reviewed_by, auth.uid())
   WHERE refund_id = p_refund_id
  RETURNING * INTO v_refund;

  SELECT * INTO v_order FROM public.orders WHERE order_id = v_refund.order_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM public.refunds
   WHERE order_id = v_refund.order_id AND status = 'REFUNDED';

  UPDATE public.orders
     SET payment_status = CASE WHEN v_total >= total_amount
                               THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END,
         order_status   = CASE WHEN v_total >= total_amount
                               THEN 'REFUNDED' ELSE order_status END,
         updated_at     = now()
   WHERE order_id = v_refund.order_id;

  PERFORM public.admin_record_audit(
    'REFUND',
    'החזר כספי אושר על ידי ספק התשלומים',
    'REFUND',
    p_refund_id::text,
    v_order.order_number,
    '₪' || v_refund.amount::text || ' · מזהה ספק ' || btrim(p_provider_refund_id)
  );

  RETURN v_refund;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_fail_refund(
  p_refund_id uuid,
  p_note      text
)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refund public.refunds;
BEGIN
  IF NOT public.admin_has_permission('refund') THEN
    RAISE EXCEPTION 'permission_denied: refund' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'refund_reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_refund
    FROM public.refunds
   WHERE refund_id = p_refund_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_refund.status = 'REFUNDED' THEN
    RAISE EXCEPTION 'refund_already_refunded' USING ERRCODE = '23505';
  END IF;

  UPDATE public.refunds
     SET status      = 'FAILED',
         review_note = btrim(p_note),
         reviewed_at = now(),
         reviewed_by = auth.uid()
   WHERE refund_id = p_refund_id
  RETURNING * INTO v_refund;

  PERFORM public.admin_record_audit(
    'REFUND',
    'החזר כספי נכשל',
    'REFUND',
    p_refund_id::text,
    v_refund.order_id::text,
    btrim(p_note)
  );

  RETURN v_refund;
END;
$$;

-- ============================================================
-- GRANTS
-- ============================================================
DO $$
DECLARE
  v_fn  text;
  v_sig text;
BEGIN
  FOR v_fn, v_sig IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'admin_mark_order_paid',
         'admin_mark_order_failed',
         'admin_cancel_order',
         'admin_issue_invoice',
         'admin_request_refund',
         'admin_review_refund',
         'admin_execute_refund',
         'admin_confirm_refund',
         'admin_fail_refund'
       )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', v_fn, v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', v_fn, v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', v_fn, v_sig);
  END LOOP;
END;
$$;

COMMIT;

-- ============================================================
-- VERIFY
--
--   SELECT proname, prosecdef, proconfig
--     FROM pg_proc
--    WHERE proname IN ('admin_mark_order_paid', 'admin_issue_invoice',
--                      'admin_confirm_refund');
--
--   -- anon must not appear on any admin_% order function
--   SELECT routine_name, grantee
--     FROM information_schema.routine_privileges
--    WHERE routine_name LIKE 'admin\_%order%'
--       OR routine_name LIKE 'admin\_%refund%';
-- ============================================================
