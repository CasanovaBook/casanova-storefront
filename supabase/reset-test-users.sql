-- ============================================================
--  DELETE ALL CUSTOMERS (role = 'CUSTOMER'), KEEP ALL STAFF
--  Admin / Moderator accounts are never touched.
--  One transaction. Change COMMIT to ROLLBACK to abort.
-- ============================================================

-- 1. Auth first, while the ids can still be read from public.users.
--    There is NO foreign key between the two tables, so both must
--    be deleted explicitly.
DELETE FROM auth.users a
USING public.users u
WHERE a.id = u.user_id AND u.role = 'CUSTOMER';

-- 2. Orders. The rest of the order tree (order_items, payments,
--    coupon_usage) CASCADEs automatically. refunds and invoices
--    are ON DELETE RESTRICT, so they are removed first.
DELETE FROM refunds  WHERE order_id IN (SELECT o.order_id FROM orders o JOIN users u ON u.user_id = o.user_id WHERE u.role = 'CUSTOMER');
DELETE FROM invoices WHERE order_id IN (SELECT o.order_id FROM orders o JOIN users u ON u.user_id = o.user_id WHERE u.role = 'CUSTOMER');
DELETE FROM orders   WHERE user_id IN (SELECT user_id FROM users WHERE role = 'CUSTOMER');

-- 3. Support notes. inquiry_notes.author_id is ON DELETE RESTRICT
--    and would otherwise block the users delete.
DELETE FROM inquiry_notes WHERE author_id IN (SELECT user_id FROM users WHERE role = 'CUSTOMER');

-- 4. The customers. Their orders, entitlements (user_products),
--    reading progress, subscriptions, device sessions, content
--    grants, password-reset tokens and app sessions all CASCADE
--    away with this single statement.
DELETE FROM users WHERE role = 'CUSTOMER';

COMMIT;

-- ── Verify: customers 0, staff 1 ────────────────────────────
SELECT
  (SELECT COUNT(*) FROM users WHERE role = 'CUSTOMER')  AS customers_left,
  (SELECT COUNT(*) FROM users WHERE role <> 'CUSTOMER') AS staff_kept,
  (SELECT COUNT(*) FROM orders)                        AS orders_left,
  (SELECT COUNT(*) FROM user_products)                 AS entitlements_left;
