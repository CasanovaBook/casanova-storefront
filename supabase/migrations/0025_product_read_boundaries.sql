-- ============================================================
-- 0025 — scope what the catalogue table hands to the browser
--        [REQUIRES SERVER-SIDE FUNCTIONS + POLICY CHANGES]
--
-- WHY
--
-- Two reads were reaching further than they meant to.
--
-- 1. `supabase-catalog.ts` selected `*` from public.products. The
--    mapper then blanked `content_url` before it reached app code, so
--    the value never appeared in a component — but it was in the HTTP
--    response the whole time, and blanking a field in JavaScript is not
--    a security boundary. `content_asset_id` has the same problem:
--    it is a pointer into content_assets and was being selected for
--    every anonymous visitor. The reader has never needed either; it
--    resolves the file through the get-content-url edge function,
--    which holds the service key and checks the entitlement.
--
-- 2. The full-catalogue read for the admin panel was a plain
--    `.from("products").select(...)` with no filter, protected by
--    whatever RLS happened to exist. The `actor?.role === "ADMIN"`
--    check in CmsContext is a client-side decision and can be skipped
--    by anyone holding an authenticated token.
--
-- This migration fixes both at the database, and only ever narrows:
-- the storefront keeps exactly the rows it had, and the broad read
-- moves behind a function that asks the permission matrix.
--
-- WHAT CHANGES
--
--   public.products        SELECT policies replaced with two scoped
--                          ones; `content_url` and `content_asset_id`
--                          revoked at the COLUMN level from anon and
--                          authenticated, so a query naming them is
--                          refused by Postgres rather than answered
--                          and then hidden in the client.
--
--   books / product_images / product_media_links / product_relations
--     / product_categories  RLS enabled with a policy of the same
--                          shape. Without these, tightening products
--                          alone is cosmetic: a draft title's author,
--                          cover shots and related-product edges stay
--                          directly readable.
--
--   public.categories      deliberately left alone. The storefront
--                          filter bar lists every category, including
--                          ones no published product is in yet, so a
--                          policy keyed on published products would
--                          empty the filter.
--
--   admin_list_products()  the only way to read beyond the published
--                          set. SECURITY DEFINER, gated on the
--                          "products" permission, and it is the path
--                          src/lib/supabase-catalog.ts now uses.
--
-- THE END STATE, EXACTLY
--
--   anon                  ACTIVE + PUBLIC only, no content_url
--   authenticated         ACTIVE + PUBLIC only, no content_url
--   admin (any role)      the same published set by default; the
--                          whole catalogue through admin_list_products
--   service_role          everything, RLS bypassed (edge functions)
--
-- Apply after 0022, 0023 and 0024.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. COLUMNS — the address of a file is not public information
--
-- The table-level grant is replaced by an explicit column list.
-- `content_url` and `content_asset_id` are absent, so PostgREST
-- cannot serve them to an anonymous or signed-in customer: the
-- request is refused, not answered-and-filtered.
--
-- This is why every product read in the client now names its
-- columns — a `select=*` would ask for content_url and fail the whole
-- query rather than quietly omitting it. PRODUCT_SELECT in
-- src/lib/supabase-catalog.ts and the Maestro connector's products
-- collection were both updated in the same change.
-- ============================================================
REVOKE ALL ON public.products FROM anon, authenticated;

GRANT SELECT (
  product_id, name, subtitle, slug, sku, description, short_description,
  product_type, price, sale_price, currency, image_url, cover_colors,
  rating, reviews_count, tags, metadata,
  seo_title, seo_description, seo_keywords,
  status, visibility, availability, inventory, featured, position,
  created_at, updated_at, archived_at
) ON public.products TO anon, authenticated;

-- The editor manages these, and the admin read reaches them through
-- admin_list_products() below, which runs as the table owner. No
-- role-level grant gives them back to the browser.
COMMENT ON COLUMN public.products.content_url IS
  'Resolved address of the file. Not readable by anon or authenticated: the reader resolves it through the get-content-url edge function, which verifies the entitlement first. Admins read it through admin_list_products().';
COMMENT ON COLUMN public.products.content_asset_id IS
  'Pointer into content_assets. Not readable by anon or authenticated; see content_url.';

-- ============================================================
-- 2. POLICIES — replace whatever was there with a known shape
--
-- The deployed policies are not in version control, so they are
-- dropped and recreated rather than patched. The dropped set is
-- echoed as NOTICE so the before-state is in the migration log:
--
--   SELECT polname, polcmd::text, pg_get_expr(polqual, polrelid)
--     FROM pg_policies WHERE tablename = 'products';
--
-- Nothing about a write changes: public.products still has no INSERT,
-- UPDATE or DELETE policy for anon or authenticated, so the only way
-- to modify the catalogue remains the 0022 functions.
-- ============================================================
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT policyname, cmd
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'products'
  LOOP
    RAISE NOTICE '0025: dropping policy % (%) on public.products', v.policyname, v.cmd;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.products', v.policyname);
  END LOOP;
END;
$$;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- The one read policy, and it is the same for everyone.
--
-- Staff included: an administrator reading the table directly still gets
-- only the published set. The panel and the entitlement pickers reach the
-- rest of the catalogue through admin_list_products() below, which is the
-- single deliberate exception and is gated on the permission matrix rather
-- than on role alone. Two policies carrying the same predicate would be
-- OR'd by Postgres and read as though the second granted something extra,
-- so there is one.
--
-- The predicate is exactly what the storefront shows: published and
-- publicly listed, in any availability state — an out-of-stock title stays
-- visible so the page can say so rather than quietly omitting it.
CREATE POLICY products_read ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (status = 'ACTIVE' AND visibility = 'PUBLIC');

-- ============================================================
-- 3. THE CHILD TABLES — a draft title's detail is still a detail
--
-- Each policy answers the same question: does this row belong to a
-- product a visitor may see, or is the caller staff?
--
-- No INSERT/UPDATE/DELETE policy is created for any of them: the
-- catalogue's child rows are written only by admin_save_product.
--
-- The owner column is named per table, not assumed. Four of the five
-- hang off `product_id`; `product_relations` does not — it is an edge
-- table with `source_product_id` and `target_product_id`, and its
-- schema comment says the source product owns the relation. The first
-- draft of this migration wrote `product_id` for all five and died with
-- `42703: column product_relations.product_id does not exist`, four
-- iterations into the loop.
--
-- `source_product_id` is also the correct test, not merely a valid one:
-- the storefront embeds this table with
-- `product_relations!product_relations_source_product_id_fkey(...)`, so
-- the only edges it ever reads are the outgoing ones of a product it has
-- already filtered to the published set.
--
-- Each column is checked against information_schema before it is used,
-- so a future schema change fails with a sentence naming the table
-- instead of a bare 42703 from inside a format() string.
-- ============================================================
DO $$
DECLARE
  spec   text;
  v_tbl  text;
  v_col  text;
  v_pol  text;
BEGIN
  FOREACH spec IN ARRAY ARRAY[
    'books.product_id',
    'product_images.product_id',
    'product_media_links.product_id',
    'product_categories.product_id',
    'product_relations.source_product_id'
  ] LOOP
    v_tbl := split_part(spec, '.', 1);
    v_col := split_part(spec, '.', 2);

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = v_tbl
         AND column_name = v_col
    ) THEN
      RAISE EXCEPTION
        '0025: public.% does not exist. The catalogue schema has moved; '
        'fix the owner column in this migration before applying it.', v_col
        USING HINT = format('checked public.%', v_tbl);
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);

    -- Drop any pre-existing policy, for the same determinism reason
    -- as the products table above.
    FOR v_pol IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = v_tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol, v_tbl);
    END LOOP;

    EXECUTE format($f$
      CREATE POLICY %1$I_read ON public.%1$I
        FOR SELECT
        TO anon, authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.products p
             WHERE p.product_id = %2$I.%3$I
               AND p.status = 'ACTIVE'
               AND p.visibility = 'PUBLIC'
          )
          OR public.is_admin()
        )
    $f$, v_tbl, v_tbl, v_col);

    RAISE NOTICE '0025: read policy on public.% via %.%', v_tbl, v_tbl, v_col;
  END LOOP;
END;
$$;

-- ============================================================
-- 3b. THE 0024 HELPERS — the same missing revoke, one function over
--
-- 0024 granted the four permission helpers to `authenticated` and
-- revoked them from PUBLIC. On this project that revoke does not take
-- effect: `REVOKE … FROM PUBLIC` is not stopping the `anon` role from
-- executing, which is exactly why 0024 also had to name `anon`
-- explicitly in its grant loop.
--
-- Probing the live database after 0024 confirmed the gap:
--
--   POST /rpc/admin_role_permissions   {"p_role":"CONTENT"}
--     -> ["dashboard","products","cms","edit_price","edit_content",
--         "cms:edit_live"]              <- answered, not refused
--   POST /rpc/admin_has_permission     {"p_permission":"edit_price"}
--     -> false                          <- answered, not refused
--
-- Nothing is writable and no other account's data is reachable — a
-- customer asking `admin_has_permission` can only learn their own role,
-- which is already in the JavaScript bundle. But a permission predicate
-- that answers anonymous callers is not the shape this system is
-- supposed to have, and leaving it is the kind of thing that is
-- expensive to explain in a review later.
--
-- The refusal must be a grant denial, so `anon` is revoked by name.
-- ============================================================
DO $$
DECLARE
  v_fn  text;
  v_sig text;
BEGIN
  FOR v_fn, v_sig IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('admin_role_permissions',
                         'admin_permission_matrix',
                         'admin_has_permission',
                         'admin_require_permission')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', v_fn, v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', v_fn, v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', v_fn, v_sig);
  END LOOP;
END;
$$;

-- ============================================================
-- 4. THE ADMIN READ — one protected path for the whole catalogue
--
-- Returns jsonb rather than the products composite so the joins can
-- be assembled server-side in one round trip. The keys match what
-- `mapDbProductToEntity` already expects, so the client's mapper is
-- unchanged: `book`, `categories`, `images`, `media_links`,
-- `relations`, plus every column of the product row.
--
-- `content_url` IS included. An administrator is the audience for
-- that field, they manage it in the editor, and this function is
-- owner-run with the permission matrix in front of it — which is the
-- difference between a field the database trusts this caller with and
-- one every visitor could read.
--
-- SECURITY DEFINER, so it is not limited by the RLS policies set
-- above; the permission check inside is the gate.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_products()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.admin_require_permission('products');

  SELECT COALESCE(jsonb_agg(
           to_jsonb(p)
           || jsonb_build_object(
                'book', (
                  SELECT to_jsonb(b)
                    FROM public.books b
                   WHERE b.product_id = p.product_id
                ),
                'categories', (
                  SELECT COALESCE(jsonb_agg(
                           jsonb_build_object('category_id', pc.category_id)
                           ORDER BY pc.category_id
                         ), '[]'::jsonb)
                    FROM public.product_categories pc
                   WHERE pc.product_id = p.product_id
                ),
                'images', (
                  SELECT COALESCE(jsonb_agg(
                           jsonb_build_object(
                             'image_url',  pi.image_url,
                             'sort_order', pi.sort_order
                           ) ORDER BY pi.sort_order, pi.image_id
                         ), '[]'::jsonb)
                    FROM public.product_images pi
                   WHERE pi.product_id = p.product_id
                ),
                'media_links', (
                  SELECT COALESCE(jsonb_agg(
                           jsonb_build_object(
                             'media_link_id', ml.media_link_id,
                             'label',          ml.label,
                             'url',            ml.url,
                             'platform',       ml.platform,
                             'sort_order',     ml.sort_order
                           ) ORDER BY ml.sort_order, ml.media_link_id
                         ), '[]'::jsonb)
                    FROM public.product_media_links ml
                   WHERE ml.product_id = p.product_id
                ),
                'relations', (
                  SELECT COALESCE(jsonb_agg(
                           jsonb_build_object(
                             'target_product_id', r.target_product_id,
                             'relation_type',     r.relation_type
                           ) ORDER BY r.relation_type, r.sort_order
                         ), '[]'::jsonb)
                    FROM public.product_relations r
                   WHERE r.source_product_id = p.product_id
                )
              )
           ORDER BY p.position, p.created_at DESC
         ), '[]'::jsonb)
    INTO v_rows
    FROM public.products p;

  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.admin_list_products() IS
  'The whole catalogue with its books, categories, images, media links '
  'and relations, as jsonb. SECURITY DEFINER and gated on the '
  '"products" permission, so it is the only way to see a DRAFT, '
  'UNLISTED, HIDDEN or ARCHIVED product — the table policies show the '
  'published set to everyone else. Replaces the unfiltered select() the '
  'admin panel used to issue.';

REVOKE ALL ON FUNCTION public.admin_list_products() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_products() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_products() TO authenticated;

COMMIT;

-- ============================================================
-- VERIFICATION — run after applying
--
-- 1. The storefront is unharmed. As `anon`:
--
--      curl "$URL/rest/v1/products?select=product_id,slug,name,price,sale_price"
--
--    Must return the published titles with their prices. Identical to
--    the result before this migration — that equality is the proof
--    that nothing a visitor could see was taken away.
--
-- 2b. The 0024 permission helpers are refused by grant, not answered:
--
--      curl -X POST "$URL/rest/v1/rpc/admin_role_permissions" \
--        -H "apikey: $ANON" -H "Content-Type: application/json" \
--        -d '{"p_role":"CONTENT"}'
--    -> {"code":"42501", ... "permission denied for function"}
--
--    A `["dashboard","products",…]` answer means 0025 was not applied.
--
-- 4. The protected columns are gone from the wire, not just hidden:
--
--      curl "$URL/rest/v1/products?select=content_url"
--    → {"code":"42501", ... "permission denied for table products"}
--
--      curl "$URL/rest/v1/products?select=content_asset_id"
--    → the same
--
--    A 200 with a null value means the grant did not take.
--
-- 5. The policies are the ones that were intended:
--
--      SELECT policyname, cmd, roles::text,
--             pg_get_expr(polqual, polrelid) AS using
--        FROM pg_policies
--       WHERE schemaname = 'public' AND tablename IN
--             ('products','books','product_images','product_media_links',
--              'product_relations','product_categories')
--       ORDER BY tablename, policyname;
--
--    Expect seven rows, all cmd = 'SELECT', and on `products` exactly
--    one: (status = 'ACTIVE' AND visibility = 'PUBLIC'). A row with
--    cmd = 'INSERT', 'UPDATE' or 'ALL' on products would mean the
--    catalogue had become browser-writable and must be removed.
--
-- 6. The write boundary is unchanged:
--
--      SELECT to_regclass('public.products') IS NOT NULL AS table_ok,
--             has_table_privilege('anon', 'public.products', 'INSERT') AS anon_can_insert,
--             has_table_privilege('authenticated', 'public.products', 'UPDATE') AS user_can_update;
--    → table_ok = true, anon_can_insert = false, user_can_update = false
--
-- 7. admin_list_products reaches what the policies hide:
--
--      SELECT public.admin_list_products();
--      -- CUSTOMER -> admin_required
--      -- SUPPORT  -> admin_required (no `products` permission)
--      -- CONTENT  -> the full catalogue
-- ============================================================
