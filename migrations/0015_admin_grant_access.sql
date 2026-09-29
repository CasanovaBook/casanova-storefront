-- ============================================================
-- 0015 — let an admin grant, revoke and extend book access
--        [REQUIRES A SERVER-SIDE FUNCTION]
--
-- THE BUG
--
-- "פתיחת גישה" in /admin/access reported "המשתמש לא נמצא." for every
-- account that had registered through Supabase.
--
-- ROOT CAUSE — the same read/write split migration 0011 fixed for
-- `account_status`, repeated here for entitlements
--
-- 1. FRONTEND. `grantAccess` in src/lib/api-support.ts resolved the
--    target with `getDb().users.find(...)` and returned NOT_FOUND when
--    that lookup missed. It always missed: `db.users` only ever holds
--    records this browser created. The admin user LIST was moved onto
--    Supabase earlier (`fetchAllProfiles`); the access WRITE was not.
--    Fixed in the same commit as this file: the customer is resolved by
--    the identity the admin selected (public.users.user_id) and the
--    entitlement is written here, server-side.
--
-- 2. DATABASE. Even with the frontend pointed at the right row, a
--    browser cannot write `public.user_products` on someone else's
--    behalf. RLS is row-level, so a policy that let an admin write any
--    entitlement would equally let a client that impersonates the
--    request forge one — the entitlement table is the source of truth
--    for "may this user open this product?" and must not be writable
--    from an untrusted client. A SECURITY DEFINER function runs as the
--    owner, needs no table grant, and checks `is_admin()` itself. This
--    is the same pattern as 0011 / 0013.
--
-- WHY THE SNAPSHOT IS BUILT HERE
--
-- `product_snapshot` is captured from the live catalogue row rather
-- than accepted from the caller, so a client cannot claim a product
-- name or author it does not have — and so the library keeps rendering
-- the title after the product is later renamed or archived.
--
-- APPLY, THEN VERIFY
--
-- The grant keeps failing until this is applied. After applying, open
-- /admin/access, pick a Supabase-registered user and a product, and
-- press "פתיחת גישה". Then confirm the row exists for the right UUID:
--
--   SELECT user_product_id, user_id, product_id, access_status
--     FROM public.user_products
--    WHERE user_id = '<the user uuid>';
-- ============================================================

-- ============================================================
-- GRANT ACCESS — creates the entitlement, or re-activates it
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_grant_access(
  p_user_id         uuid,
  p_product_id      uuid,
  p_source_order_id uuid DEFAULT NULL
)
RETURNS public.user_products
LANGUAGE plpgsql
-- Owner-run execution; search_path pinned so a caller cannot hijack
-- resolution of is_admin(), the tables, or auth.uid().
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row      public.user_products;
  v_snapshot jsonb;
BEGIN
  -- The real gate. A signed-in customer reaching this RPC directly is
  -- refused here; the panel's own `can(adminRole, "grant_access")` check
  -- only decides what to render.
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  -- The target must be a real account. Reported by its own token so the
  -- dialog can say "the user was not found" rather than swallowing the
  -- reason the way the old local lookup did.
  PERFORM 1 FROM public.users WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Snapshot from the catalogue, never from the request body.
  -- jsonb_strip_nulls keeps absent book fields out of the stored JSON,
  -- which is what the client's optional ProductSnapshot fields expect.
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
   WHERE p.product_id = p_product_id;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- A manual grant has no order behind it, and a source order that does
  -- not exist cannot satisfy the FK. Dropped rather than failing the
  -- whole grant, because the order reference is provenance, not the
  -- grant itself.
  IF p_source_order_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.orders WHERE order_id = p_source_order_id
     ) THEN
    p_source_order_id := NULL;
  END IF;

  -- `UNIQUE (user_id, product_id)` makes this an upsert: re-granting an
  -- existing entitlement reactivates it and refreshes the snapshot
  -- instead of stacking a duplicate row.
  INSERT INTO public.user_products (
    user_id, product_id, product_snapshot, source_order_id,
    access_status, granted_at, granted_by
  ) VALUES (
    p_user_id, p_product_id, v_snapshot, p_source_order_id,
    'ACTIVE', now(), auth.uid()
  )
  ON CONFLICT (user_id, product_id) DO UPDATE
     SET access_status    = 'ACTIVE',
         -- A manual grant restores unrestricted access: an expiry left over
         -- from a previously time-limited entitlement must not survive and
         -- keep the row effectively closed while its status reads ACTIVE.
         expires_at       = NULL,
         product_snapshot = EXCLUDED.product_snapshot,
         -- Keep the original provenance if a purchase already recorded one.
         source_order_id  = COALESCE(
                              public.user_products.source_order_id,
                              EXCLUDED.source_order_id
                            ),
         granted_at       = now(),
         granted_by       = auth.uid(),
         -- A previously revoked row must not carry stale revocation data
         -- into its active life.
         revoked_at       = NULL,
         revoked_by       = NULL,
         revoke_reason    = NULL
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.admin_grant_access(uuid, uuid, uuid) IS
  'Admin-only: creates or re-activates a public.user_products entitlement '
  'for one account and product. SECURITY DEFINER because the entitlement '
  'table is the source of truth for content access and must not be writable '
  'from a browser; the snapshot is captured from the catalogue server-side.';

REVOKE ALL ON FUNCTION public.admin_grant_access(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_grant_access(uuid, uuid, uuid) TO authenticated;

-- ============================================================
-- SET STATUS — suspend, revoke, expire or re-activate
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_set_access_status(
  p_user_product_id uuid,
  p_status          text
)
RETURNS public.user_products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.user_products;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  -- Mirrors the CHECK on public.user_products.access_status, so a bad
  -- value is a clear rejection rather than a constraint error surfaced
  -- from inside the update.
  IF p_status NOT IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'SUSPENDED') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  -- chk_user_product_revocation requires revoked_at/revoked_by whenever
  -- access_status is REVOKED; they are cleared on every other status so
  -- a reactivated row does not read as "revoked but ACTIVE". Reactivation
  -- also clears any expiry: ACTIVE with a past expires_at still closes the
  -- book, which is not what "restore access" means. Other statuses keep
  -- expires_at untouched.
  UPDATE public.user_products
     SET access_status = p_status,
         expires_at    = CASE WHEN p_status = 'ACTIVE' THEN NULL ELSE expires_at END,
         revoked_at    = CASE WHEN p_status = 'REVOKED' THEN now()       ELSE NULL END,
         revoked_by    = CASE WHEN p_status = 'REVOKED' THEN auth.uid()  ELSE NULL END,
         revoke_reason = CASE WHEN p_status = 'REVOKED' THEN 'נשלל על ידי מנהל' ELSE NULL END
   WHERE user_product_id = p_user_product_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.admin_set_access_status(uuid, text) IS
  'Admin-only: changes public.user_products.access_status. A non-ACTIVE '
  'status also revokes every content_access_grant already minted for the '
  'entitlement, through trg_user_product_revokes_grants.';

REVOKE ALL ON FUNCTION public.admin_set_access_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_access_status(uuid, text) TO authenticated;

-- ============================================================
-- EXTEND — push the expiry of an entitlement out
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_extend_access(
  p_user_product_id uuid,
  p_expires_at      timestamptz
)
RETURNS public.user_products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.user_products;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  IF p_expires_at IS NULL THEN
    RAISE EXCEPTION 'invalid_expiry' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_products
     SET expires_at    = p_expires_at,
         access_status = 'ACTIVE',
         revoked_at    = NULL,
         revoked_by    = NULL,
         revoke_reason = NULL
   WHERE user_product_id = p_user_product_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.admin_extend_access(uuid, timestamptz) IS
  'Admin-only: sets a new expires_at on a public.user_products row and '
  'reactivates it if it had lapsed.';

REVOKE ALL ON FUNCTION public.admin_extend_access(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_extend_access(uuid, timestamptz) TO authenticated;

-- ============================================================
-- REMOVE — delete the entitlement outright
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_remove_access(
  p_user_product_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.user_products
   WHERE user_product_id = p_user_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_remove_access(uuid) IS
  'Admin-only: deletes a public.user_products row. content_access_grants '
  'pointing at it are removed by their own ON DELETE CASCADE.';

REVOKE ALL ON FUNCTION public.admin_remove_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_remove_access(uuid) TO authenticated;

-- ── VERIFY ───────────────────────────────────────────────────
--
-- 1. The four functions exist, are SECURITY DEFINER and pin search_path:
--
--    SELECT p.proname, p.prosecdef AS security_definer, p.proconfig
--      FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public'
--       AND p.proname IN ('admin_grant_access', 'admin_set_access_status',
--                         'admin_extend_access', 'admin_remove_access');
--
--    Expect four rows, security_definer = true, and a proconfig
--    containing search_path=public, pg_temp.
--
-- 2. Only authenticated may execute them — `anon` must NOT appear:
--
--    SELECT routine_name, grantee, privilege_type
--      FROM information_schema.routine_privileges
--     WHERE routine_name LIKE 'admin\_%\_access%'
--     ORDER BY routine_name, grantee;
--
-- 3. A signed-in customer must be refused (run from the app's SQL
--    session as a non-admin) — expect ERROR: admin_required:
--
--    SELECT public.admin_grant_access('<uuid>', '<uuid>');
-- ============================================================
