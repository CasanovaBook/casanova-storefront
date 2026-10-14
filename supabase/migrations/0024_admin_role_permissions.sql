-- ============================================================
-- 0024 — enforce the admin role matrix in the database
--        [REQUIRES SERVER-SIDE FUNCTIONS]
--
-- WHY
--
-- 0022 put every catalogue write behind a SECURITY DEFINER function
-- that checks `is_admin()`. `is_admin()` answers one question — "is
-- this account staff?" — and the app has five staff roles with
-- genuinely different powers (src/lib/permissions.ts):
--
--   SUPER_ADMIN  everything, including delete_product
--   CONTENT      products, edit_price, edit_content
--   FINANCE      edit_price only, and no access to /admin/products
--   SUPPORT      no product permission at all
--   MARKETING    no product permission at all
--
-- With 0022 as written, a SUPPORT or MARKETING account passes
-- `is_admin()` and can therefore call `admin_save_product` with any
-- price it likes, or `admin_delete_product` on a sold title — the
-- panel's `can(adminRole, "edit_price")` check is a UI affordance
-- and a caller holding an `authenticated` token is not obliged to
-- render the panel. The one check that actually mattered
-- (`guard(actor, "edit_price")` inside api.ts) was on the code path
-- that is no longer used when Supabase is configured.
--
-- This migration moves the decision server-side. It does not invent a
-- new authorization system: `admin_role_permissions()` below is a
-- literal transcription of `ROLE_PERMISSIONS` in
-- src/lib/permissions.ts, and the two must be changed together. That
-- file remains the single source of truth for the UI; this one is
-- the enforcement copy.
--
-- WHAT CHANGES
--
--   admin_role_permissions(text)   role -> permission[]
--   admin_permission_matrix()      the whole matrix, for verification
--   admin_has_permission(text)     does auth.uid() hold it?
--
--   admin_save_product            is_admin() + per-field permission
--   admin_delete_product          is_admin() + delete_product
--   admin_set_product_status      is_admin() + products
--   admin_move_product            is_admin() + products
--   admin_save_category           is_admin() + products
--   admin_delete_category         is_admin() + products
--
--   admin_grant_access            is_admin() + grant_access
--   admin_set_access_status       is_admin() + grant_access
--   admin_remove_access           is_admin() + grant_access
--
-- `admin_extend_access` is not restated: migration 0016 dropped it, so
-- there is nothing to gate. The GRANT loop at the end iterates whatever
-- `admin_%` functions actually exist, which is why it names it.
--
-- FIELD -> PERMISSION
--
-- Mirrors api.ts, which gated `edit_price` on price/sale_price and
-- `edit_content` on content_url/content_file/image_url. Two families
-- are additionally fenced here because they carry the same risk and
-- api.ts had no equivalent path for them once the hosted write took
-- over: `images` / `cover_colors` / `media_links` (the imagery an
-- editor can replace wholesale) and `metadata` (the JSONB bag that
-- holds the Storage pointer, so editing it is editing the file a
-- customer will be served).
--
-- `currency` is priced money and sits with the price fields.
--
-- GRANTS
--
-- Probing the live database showed `anon` able to *execute* every
-- admin function: a request with the anon key reached the function
-- body and was refused by its own `is_admin()` check, rather than
-- being refused by Postgres. The `REVOKE … FROM PUBLIC` in 0015 and
-- 0022 is therefore not in force on the deployed project. Nothing was
-- ever writable through it — the in-body check held — but a body
-- check is one `IF` away from being the only thing standing between a
-- stranger and the catalogue, so the grants are made explicit here
-- and `anon` is revoked by name.
--
-- Apply order: 0022, 0023 then this file.
-- ============================================================

BEGIN;

-- ============================================================
-- THE MATRIX — a transcription of ROLE_PERMISSIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_role_permissions(p_role text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'SUPER_ADMIN' THEN ARRAY[
      'dashboard','products','cms','users','access','orders','finance',
      'emails','alerts','audit','crm','support','settings','security',
      'refund','execute_refund','mark_paid','edit_order','grant_access',
      'edit_price','edit_content','delete_product','block_user',
      'resend_email','manage_roles','manage_support','manage_drm',
      'cms:edit_live'
    ]::text[]

    WHEN 'SUPPORT' THEN ARRAY[
      'dashboard','users','access','orders','emails','alerts','crm',
      'support','manage_support','grant_access','block_user',
      'resend_email','cms:edit_live'
    ]::text[]

    WHEN 'FINANCE' THEN ARRAY[
      'dashboard','orders','finance','alerts','support','refund',
      'execute_refund','mark_paid','edit_order','edit_price',
      'cms:edit_live'
    ]::text[]

    WHEN 'CONTENT' THEN ARRAY[
      'dashboard','products','cms','edit_price','edit_content',
      'cms:edit_live'
    ]::text[]

    WHEN 'MARKETING' THEN ARRAY[
      'dashboard','cms','crm','finance','emails','resend_email',
      'support','cms:edit_live'
    ]::text[]

    ELSE ARRAY[]::text[]
  END;
$$;

COMMENT ON FUNCTION public.admin_role_permissions(text) IS
  'The staff permission matrix, transcribed from ROLE_PERMISSIONS in '
  'src/lib/permissions.ts. Keep the two in step: that file decides what '
  'the panel shows, this one decides what the database accepts.';

-- ============================================================
-- THE MATRIX, AS DATA — so a verification query can read it back
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_permission_matrix()
RETURNS TABLE (admin_role text, permission text)
LANGUAGE sql
STABLE
AS $$
  SELECT r.role, p.permission
    FROM unnest(ARRAY['SUPER_ADMIN','SUPPORT','FINANCE','CONTENT','MARKETING'])
         AS r(role)
   CROSS JOIN LATERAL unnest(public.admin_role_permissions(r.role)) AS p(permission);
$$;

-- ============================================================
-- THE PREDICATE
--
-- SECURITY DEFINER because it reads public.users, which RLS scopes to
-- the caller's own row; STABLE because it is called several times per
-- statement and must not re-read within one.
--
-- The `role = 'ADMIN'` test is kept separate from the matrix on
-- purpose. `users.role` is the coarse staff flag `is_admin()` uses;
-- `users.admin_role` only narrows what a staff member may do and is
-- NULL for an account with no named role. An account that is staff
-- but unassigned would otherwise be handed the empty array and read as
-- "holds nothing", which is right — but an account that is *not*
-- staff with admin_role somehow set must never be treated as staff.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.users u
     WHERE u.user_id = auth.uid()
       AND u.role = 'ADMIN'
       AND u.account_status = 'ACTIVE'
       AND p_permission = ANY (public.admin_role_permissions(u.admin_role))
  );
$$;

COMMENT ON FUNCTION public.admin_has_permission(text) IS
  'True when the signed-in account is active staff and its admin_role '
  'carries the named permission. The server-side twin of can() in '
  'src/lib/permissions.ts; the catalogue RPCs call it, so a caller that '
  'skips the UI cannot skip the policy.';

REVOKE ALL ON FUNCTION public.admin_role_permissions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_permission_matrix() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_has_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_role_permissions(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_permission_matrix() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_has_permission(text) TO authenticated, service_role;

-- ============================================================
-- REFUSAL HELPER
--
-- One place that decides what a denied catalogue call looks like, so
-- the wording an admin reads is the same whichever gate refused them.
-- The permission name travels in the message and is read back by
-- src/lib/supabase-catalog.ts.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_require_permission(p_permission text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_has_permission(p_permission) THEN
    RAISE EXCEPTION 'permission_denied: %', p_permission
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_require_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_require_permission(text) TO authenticated, service_role;

-- ============================================================
-- SAVE PRODUCT — is_admin() plus a per-field check
--
-- The payload contract is unchanged and still the one 0022 documents:
-- a key that is present is written, a key that is absent is left
-- alone, a key present with a JSON null clears the column. The
-- permissions are derived from the keys that are actually present, so
-- a CONTENT editor toggling `featured` is not asked for a price
-- permission it does not need, and a SUPPORT account cannot smuggle a
-- price in through the same call.
--
-- `p_product_type` is checked as a key because flipping a title away
-- from EBOOK has to be able to drop its `books` row below; that
-- reconciliation now runs whenever the *effective* type is not
-- EBOOK, not only when a book payload happened to accompany it.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_save_product(p_product jsonb)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row       public.products;
  v_id        uuid;
  v_type      text;
  v_status    text;
  v_book      jsonb;
  v_book_any  boolean;
  v_ex_price  numeric;
  v_ex_sale   numeric;
  v_ex_status text;
  v_ex_type   text;
  v_ex_name   text;
  v_ex_slug   text;
  v_name      text;
  v_slug      text;
  v_price_new numeric;
  v_sale_new  numeric;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  -- ── Authorisation, derived from the keys the caller actually sent ──
  PERFORM public.admin_require_permission('products');

  IF p_product ? 'price' OR p_product ? 'sale_price' OR p_product ? 'currency' THEN
    PERFORM public.admin_require_permission('edit_price');
  END IF;

  IF p_product ? 'content_url'
     OR p_product ? 'image_url'
     OR p_product ? 'cover_colors'
     OR p_product ? 'images'
     OR p_product ? 'media_links'
     OR p_product ? 'metadata' THEN
    PERFORM public.admin_require_permission('edit_content');
  END IF;

  -- An update carries the row's id; a create may carry a pre-generated
  -- one (the panel uploads to Storage under it before the first save)
  -- or none.
  v_id := COALESCE(NULLIF(p_product->>'product_id', '')::uuid, gen_random_uuid());

  /* The stored row, read once. The INSERT leg below cannot see
   * `products.*` the way the ON CONFLICT leg can, so every field a
   * partial update does not carry has to fall back to these values —
   * otherwise a price-only edit would be validated against price = 0
   * on the insert attempt and rejected by the sale-price CHECK before
   * the conflict was ever seen. */
  SELECT price, sale_price, status, product_type, name, slug
    INTO v_ex_price, v_ex_sale, v_ex_status, v_ex_type, v_ex_name, v_ex_slug
    FROM public.products
   WHERE product_id = v_id;

  /* The proposed insert tuple must satisfy every NOT NULL and CHECK on
   * its own: PostgreSQL validates it before it ever reaches conflict
   * resolution, so a price-only update that proposed name = NULL would
   * be rejected by the NOT NULL constraint instead of falling through
   * to the UPDATE branch. */
  v_name := COALESCE(NULLIF(btrim(COALESCE(p_product->>'name', '')), ''), v_ex_name);
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = '22023';
  END IF;

  v_slug := COALESCE(NULLIF(btrim(COALESCE(p_product->>'slug', '')), ''), v_ex_slug);
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'slug_required' USING ERRCODE = '22023';
  END IF;

  -- Enum validation, mirrored from the CHECK constraints so a typo is a
  -- clear rejection instead of a constraint error from inside the write.
  v_type := COALESCE(NULLIF(p_product->>'product_type', ''), v_ex_type, 'EBOOK');
  IF v_type NOT IN ('EBOOK', 'SUBSCRIPTION', 'DIGITAL_PRODUCT',
                    'PHYSICAL_PRODUCT', 'BUNDLE', 'COURSE', 'PREMIUM_ACCESS') THEN
    RAISE EXCEPTION 'invalid_product_type' USING ERRCODE = '22023';
  END IF;

  v_status := COALESCE(NULLIF(p_product->>'status', ''), v_ex_status, 'DRAFT');
  IF v_status NOT IN ('ACTIVE', 'INACTIVE', 'DRAFT', 'ARCHIVED') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  IF p_product ? 'visibility'
     AND p_product->>'visibility' NOT IN ('PUBLIC', 'UNLISTED', 'HIDDEN') THEN
    RAISE EXCEPTION 'invalid_visibility' USING ERRCODE = '22023';
  END IF;

  IF p_product ? 'availability'
     AND p_product->>'availability' NOT IN ('AVAILABLE', 'OUT_OF_STOCK', 'PREORDER') THEN
    RAISE EXCEPTION 'invalid_availability' USING ERRCODE = '22023';
  END IF;

  -- Price and sale price are checked as a pair against the merged row, so a
  -- payload that lowers the regular price under an existing sale price is
  -- refused with a readable message rather than by the CHECK constraint.
  IF p_product ? 'price' OR p_product ? 'sale_price' THEN
    v_price_new := COALESCE(NULLIF(p_product->>'price', '')::numeric, v_ex_price, 0);
    IF v_price_new < 0 THEN
      RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
    END IF;

    v_sale_new := CASE WHEN p_product ? 'sale_price'
                       THEN NULLIF(p_product->>'sale_price', '')::numeric
                       ELSE v_ex_sale END;

    IF v_sale_new IS NOT NULL AND (v_sale_new < 0 OR v_sale_new >= v_price_new) THEN
      RAISE EXCEPTION 'invalid_sale_price' USING ERRCODE = '22023';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.products (
      product_id, name, subtitle, slug, sku, description, short_description,
      product_type, price, sale_price, currency, image_url, cover_colors,
      content_url, tags, metadata,
      seo_title, seo_description, seo_keywords,
      status, visibility, availability, inventory, featured, position,
      archived_at, updated_at
    )
    VALUES (
      v_id,
      v_name,
      NULLIF(btrim(COALESCE(p_product->>'subtitle', '')), ''),
      v_slug,
      NULLIF(btrim(COALESCE(p_product->>'sku', '')), ''),
      COALESCE(p_product->>'description', ''),
      COALESCE(p_product->>'short_description', ''),
      v_type,
      COALESCE(NULLIF(p_product->>'price', '')::numeric, v_ex_price, 0),
      CASE WHEN p_product ? 'sale_price'
           THEN NULLIF(p_product->>'sale_price', '')::numeric
           ELSE v_ex_sale END,
      COALESCE(NULLIF(p_product->>'currency', ''), 'ILS'),
      NULLIF(btrim(COALESCE(p_product->>'image_url', '')), ''),
      CASE WHEN jsonb_typeof(p_product->'cover_colors') = 'array'
           THEN p_product->'cover_colors'
           ELSE '["#111827","#374151"]'::jsonb END,
      NULLIF(btrim(COALESCE(p_product->>'content_url', '')), ''),
      CASE WHEN jsonb_typeof(p_product->'tags') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_product->'tags'))
           ELSE '{}'::text[] END,
      CASE WHEN jsonb_typeof(p_product->'metadata') = 'object'
           THEN p_product->'metadata'
           ELSE '{}'::jsonb END,
      NULLIF(btrim(COALESCE(p_product->>'seo_title', '')), ''),
      NULLIF(btrim(COALESCE(p_product->>'seo_description', '')), ''),
      NULLIF(btrim(COALESCE(p_product->>'seo_keywords', '')), ''),
      v_status,
      COALESCE(NULLIF(p_product->>'visibility', ''), 'PUBLIC'),
      COALESCE(NULLIF(p_product->>'availability', ''), 'AVAILABLE'),
      NULLIF(p_product->>'inventory', '')::integer,
      COALESCE((p_product->>'featured')::boolean, false),
      COALESCE(NULLIF(p_product->>'position', '')::integer, 0),
      CASE WHEN v_status = 'ARCHIVED'
           THEN now() ELSE NULL END,
      now()
    )
    ON CONFLICT (product_id) DO UPDATE SET
      name = CASE WHEN p_product ? 'name' THEN EXCLUDED.name
                  ELSE public.products.name END,
      subtitle = CASE WHEN p_product ? 'subtitle' THEN EXCLUDED.subtitle
                      ELSE public.products.subtitle END,
      slug = CASE WHEN p_product ? 'slug' THEN EXCLUDED.slug
                  ELSE public.products.slug END,
      sku = CASE WHEN p_product ? 'sku' THEN EXCLUDED.sku
                 ELSE public.products.sku END,
      description = CASE WHEN p_product ? 'description' THEN EXCLUDED.description
                         ELSE public.products.description END,
      short_description = CASE WHEN p_product ? 'short_description'
                               THEN EXCLUDED.short_description
                               ELSE public.products.short_description END,
      product_type = CASE WHEN p_product ? 'product_type' THEN EXCLUDED.product_type
                          ELSE public.products.product_type END,
      price = CASE WHEN p_product ? 'price' THEN EXCLUDED.price
                   ELSE public.products.price END,
      sale_price = CASE WHEN p_product ? 'sale_price' THEN EXCLUDED.sale_price
                        ELSE public.products.sale_price END,
      currency = CASE WHEN p_product ? 'currency' THEN EXCLUDED.currency
                      ELSE public.products.currency END,
      image_url = CASE WHEN p_product ? 'image_url' THEN EXCLUDED.image_url
                       ELSE public.products.image_url END,
      cover_colors = CASE WHEN p_product ? 'cover_colors' THEN EXCLUDED.cover_colors
                          ELSE public.products.cover_colors END,
      content_url = CASE WHEN p_product ? 'content_url' THEN EXCLUDED.content_url
                         ELSE public.products.content_url END,
      tags = CASE WHEN p_product ? 'tags' THEN EXCLUDED.tags
                  ELSE public.products.tags END,
      metadata = CASE WHEN p_product ? 'metadata' THEN EXCLUDED.metadata
                      ELSE public.products.metadata END,
      seo_title = CASE WHEN p_product ? 'seo_title' THEN EXCLUDED.seo_title
                       ELSE public.products.seo_title END,
      seo_description = CASE WHEN p_product ? 'seo_description'
                             THEN EXCLUDED.seo_description
                             ELSE public.products.seo_description END,
      seo_keywords = CASE WHEN p_product ? 'seo_keywords' THEN EXCLUDED.seo_keywords
                          ELSE public.products.seo_keywords END,
      status = CASE WHEN p_product ? 'status' THEN EXCLUDED.status
                    ELSE public.products.status END,
      visibility = CASE WHEN p_product ? 'visibility' THEN EXCLUDED.visibility
                        ELSE public.products.visibility END,
      availability = CASE WHEN p_product ? 'availability' THEN EXCLUDED.availability
                          ELSE public.products.availability END,
      inventory = CASE WHEN p_product ? 'inventory' THEN EXCLUDED.inventory
                       ELSE public.products.inventory END,
      featured = CASE WHEN p_product ? 'featured' THEN EXCLUDED.featured
                      ELSE public.products.featured END,
      position = CASE WHEN p_product ? 'position' THEN EXCLUDED.position
                      ELSE public.products.position END,
      archived_at = CASE WHEN p_product ? 'status'
                         THEN (CASE WHEN EXCLUDED.status = 'ARCHIVED'
                                    THEN COALESCE(public.products.archived_at, now())
                                    ELSE NULL END)
                         ELSE public.products.archived_at END,
      -- Never clobber a stored archived_at when only, say, the price changed.
      updated_at = now()
    RETURNING * INTO v_row;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505';
  END;

  -- ── Book metadata ──
  --
  -- Reconciled on every save rather than only when the payload carried
  -- a `book` key. `trg_books_is_ebook` fires on INSERT/UPDATE OF
  -- product_id, so it never notices that `products.product_type` moved
  -- away from EBOOK, and a title switched to DIGITAL_PRODUCT would keep
  -- an author and a page count it no longer is. When the effective
  -- type is not EBOOK the row is removed outright; otherwise an absent
  -- or empty `book` clears it and a populated one upserts.
  IF v_type <> 'EBOOK' THEN
    DELETE FROM public.books WHERE product_id = v_row.product_id;

  ELSIF p_product ? 'book' THEN
    v_book := p_product->'book';

    v_book_any := jsonb_typeof(v_book) = 'object' AND (
      COALESCE(btrim(COALESCE(v_book->>'author_name', '')), '') <> '' OR
      COALESCE(btrim(COALESCE(v_book->>'isbn', '')), '') <> '' OR
      COALESCE(btrim(COALESCE(v_book->>'publisher', '')), '') <> '' OR
      COALESCE(btrim(COALESCE(v_book->>'language', '')), '') <> '' OR
      COALESCE(btrim(COALESCE(v_book->>'publication_date', '')), '') <> '' OR
      NULLIF(v_book->>'total_pages', '') IS NOT NULL
    );

    IF v_book_any THEN
      BEGIN
        INSERT INTO public.books (
          product_id, author_name, isbn, publisher, language,
          publication_date, total_pages
        ) VALUES (
          v_row.product_id,
          NULLIF(btrim(COALESCE(v_book->>'author_name', '')), ''),
          NULLIF(btrim(COALESCE(v_book->>'isbn', '')), ''),
          NULLIF(btrim(COALESCE(v_book->>'publisher', '')), ''),
          NULLIF(btrim(COALESCE(v_book->>'language', '')), ''),
          NULLIF(btrim(COALESCE(v_book->>'publication_date', '')), '')::date,
          NULLIF(v_book->>'total_pages', '')::integer
        )
        ON CONFLICT (product_id) DO UPDATE SET
          author_name = EXCLUDED.author_name,
          isbn = EXCLUDED.isbn,
          publisher = EXCLUDED.publisher,
          language = EXCLUDED.language,
          publication_date = EXCLUDED.publication_date,
          total_pages = EXCLUDED.total_pages;
      EXCEPTION
        WHEN unique_violation THEN
          RAISE EXCEPTION 'isbn_taken' USING ERRCODE = '23505';
      END;
    ELSE
      DELETE FROM public.books WHERE product_id = v_row.product_id;
    END IF;
  END IF;

  -- ── Categories / images / links / relations ──
  --
  -- Each block replaces its table wholesale, which is what makes an
  -- emptied list a clear: the client sends `[]` rather than omitting
  -- the key, and the DELETE runs before the (empty) INSERT.
  IF p_product ? 'category_ids' THEN
    DELETE FROM public.product_categories WHERE product_id = v_row.product_id;
    IF jsonb_typeof(p_product->'category_ids') = 'array' THEN
      INSERT INTO public.product_categories (product_id, category_id)
      SELECT v_row.product_id, c.value::uuid
        FROM jsonb_array_elements_text(p_product->'category_ids') AS c(value)
       WHERE EXISTS (
               SELECT 1 FROM public.categories k
                WHERE k.category_id::text = c.value
             )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF p_product ? 'images' THEN
    DELETE FROM public.product_images WHERE product_id = v_row.product_id;
    IF jsonb_typeof(p_product->'images') = 'array' THEN
      INSERT INTO public.product_images (product_id, image_url, sort_order)
      SELECT v_row.product_id, btrim(img.value), (ord - 1)::integer
        FROM jsonb_array_elements_text(p_product->'images')
             WITH ORDINALITY AS img(value, ord)
       WHERE btrim(img.value) <> '';
    END IF;
  END IF;

  IF p_product ? 'media_links' THEN
    DELETE FROM public.product_media_links WHERE product_id = v_row.product_id;
    IF jsonb_typeof(p_product->'media_links') = 'array' THEN
      INSERT INTO public.product_media_links (product_id, label, url, platform, sort_order)
      SELECT v_row.product_id,
             COALESCE(NULLIF(btrim(ml.value->>'label'), ''), 'צפייה חיה'),
             btrim(ml.value->>'url'),
             -- Validated rather than passed through: the column CHECK
             -- only accepts these three, and an unvalidated value would
             -- surface as a raw constraint violation instead of the
             -- readable refusal below.
             CASE WHEN ml.value->>'platform' IN ('YOUTUBE', 'VIMEO', 'WEB')
                  THEN ml.value->>'platform' ELSE 'WEB' END,
             (ml.ord - 1)::integer
        FROM jsonb_array_elements(p_product->'media_links')
             WITH ORDINALITY AS ml(value, ord)
       WHERE btrim(COALESCE(ml.value->>'url', '')) <> '';
    END IF;
  END IF;

  IF p_product ? 'related_product_ids'
     OR p_product ? 'upsell_ids'
     OR p_product ? 'cross_sell_ids'
     OR p_product ? 'bundle_item_ids' THEN
    DELETE FROM public.product_relations
     WHERE source_product_id = v_row.product_id;

    INSERT INTO public.product_relations
      (source_product_id, target_product_id, relation_type, sort_order)
    SELECT v_row.product_id, r.value::uuid, r.kind, r.ord - 1
      FROM (
        SELECT value, 'RELATED' AS kind, ord
          FROM jsonb_array_elements_text(COALESCE(p_product->'related_product_ids', '[]'::jsonb))
               WITH ORDINALITY AS t(value, ord)
        UNION ALL
        SELECT value, 'UPSELL', ord
          FROM jsonb_array_elements_text(COALESCE(p_product->'upsell_ids', '[]'::jsonb))
               WITH ORDINALITY AS t(value, ord)
        UNION ALL
        SELECT value, 'CROSS_SELL', ord
          FROM jsonb_array_elements_text(COALESCE(p_product->'cross_sell_ids', '[]'::jsonb))
               WITH ORDINALITY AS t(value, ord)
        UNION ALL
        SELECT value, 'BUNDLE_ITEM', ord
          FROM jsonb_array_elements_text(COALESCE(p_product->'bundle_item_ids', '[]'::jsonb))
               WITH ORDINALITY AS t(value, ord)
      ) AS r(value, kind, ord)
     WHERE r.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND r.value::uuid <> v_row.product_id
       AND EXISTS (SELECT 1 FROM public.products tp WHERE tp.product_id = r.value::uuid)
    ON CONFLICT (source_product_id, target_product_id, relation_type) DO NOTHING;
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.admin_save_product(jsonb) IS
  'Admin-only: inserts or updates one public.products row and its books, '
  'categories, images, media links and relations in one transaction. '
  'Gated on is_admin() and then on the ROLE_PERMISSIONS matrix: the '
  '"products" permission for the call, plus edit_price for price/'
  'sale_price/currency and edit_content for content_url/image_url/'
  'cover_colors/images/media_links/metadata. Payload keys present are '
  'written, absent keys are left alone, null clears.';

-- ============================================================
-- THE REST OF THE CATALOGUE — one permission each
--
-- These bodies are unchanged from 0022 apart from the added check;
-- they are reproduced so this file leaves the deployed set consistent
-- rather than half-old and half-new.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_set_product_status(
  p_product_id uuid,
  p_status     text
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.products;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.admin_require_permission('products');

  IF p_status NOT IN ('ACTIVE', 'INACTIVE', 'DRAFT', 'ARCHIVED') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products
     SET status      = p_status,
         archived_at = CASE WHEN p_status = 'ARCHIVED'
                            THEN COALESCE(archived_at, now())
                            ELSE NULL END,
         updated_at  = now()
   WHERE product_id = p_product_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_product(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  -- SUPER_ADMIN only in the current matrix. The 0022 body checked
  -- `is_admin()` alone, which handed delete to SUPPORT and MARKETING.
  PERFORM public.admin_require_permission('delete_product');

  PERFORM 1 FROM public.products WHERE product_id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- order_items.product_id is ON DELETE RESTRICT, and user_products is the
  -- entitlement ledger. Both mean "this product has history" — archive is
  -- the correct action, and the panel shows the same wording the local
  -- driver used.
  IF EXISTS (SELECT 1 FROM public.order_items WHERE product_id = p_product_id) THEN
    RAISE EXCEPTION 'product_has_orders' USING ERRCODE = '23503';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_products WHERE product_id = p_product_id) THEN
    RAISE EXCEPTION 'product_has_grants' USING ERRCODE = '23503';
  END IF;

  -- subscriptions.product_id is also ON DELETE RESTRICT and was not
  -- covered above, so a subscribed title used to surface a raw
  -- constraint violation. Named here for the same reason.
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE product_id = p_product_id) THEN
    RAISE EXCEPTION 'product_has_subscriptions' USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.products WHERE product_id = p_product_id;
END;
$$;

COMMENT ON FUNCTION public.admin_delete_product(uuid) IS
  'Admin-only, and only for a role carrying delete_product (SUPER_ADMIN in '
  'the current matrix). Refused with product_has_orders / product_has_grants '
  '/ product_has_subscriptions while history references it, so archiving '
  'stays the only safe removal for a sold title.';

CREATE OR REPLACE FUNCTION public.admin_move_product(
  p_product_id uuid,
  p_direction  integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pos       integer;
  v_other     uuid;
  v_other_pos integer;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.admin_require_permission('products');

  IF p_direction NOT IN (-1, 1) THEN
    RAISE EXCEPTION 'invalid_direction' USING ERRCODE = '22023';
  END IF;

  SELECT position INTO v_pos FROM public.products WHERE product_id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT product_id, position
    INTO v_other, v_other_pos
    FROM public.products
   WHERE product_id <> p_product_id
     AND CASE WHEN p_direction = 1
              THEN (position, product_id) > (v_pos, p_product_id)
              ELSE (position, product_id) < (v_pos, p_product_id)
         END
   ORDER BY CASE WHEN p_direction = 1 THEN position END ASC,
            CASE WHEN p_direction = -1 THEN position END DESC
   LIMIT 1;

  -- At the edge of the grid there is nothing to swap with.
  IF v_other IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.products
     SET position = CASE WHEN product_id = p_product_id THEN v_other_pos
                         ELSE v_pos END,
         updated_at = now()
   WHERE product_id IN (p_product_id, v_other);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_category(p_category jsonb)
RETURNS public.categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.categories;
  v_id  uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.admin_require_permission('products');

  IF btrim(COALESCE(p_category->>'name', '')) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = '22023';
  END IF;
  IF btrim(COALESCE(p_category->>'slug', '')) = '' THEN
    RAISE EXCEPTION 'slug_required' USING ERRCODE = '22023';
  END IF;

  v_id := NULLIF(p_category->>'category_id', '')::uuid;

  BEGIN
    INSERT INTO public.categories
      (category_id, name, slug, description, display_order)
    VALUES (
      COALESCE(v_id, gen_random_uuid()),
      btrim(p_category->>'name'),
      btrim(p_category->>'slug'),
      NULLIF(btrim(COALESCE(p_category->>'description', '')), ''),
      COALESCE(NULLIF(p_category->>'display_order', '')::integer,
               (SELECT COALESCE(MAX(display_order), 0) + 1 FROM public.categories))
    )
    ON CONFLICT (category_id) DO UPDATE SET
      name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      description = CASE WHEN p_category ? 'description'
                         THEN EXCLUDED.description
                         ELSE public.categories.description END,
      display_order = CASE WHEN p_category ? 'display_order'
                           THEN EXCLUDED.display_order
                           ELSE public.categories.display_order END
    RETURNING * INTO v_row;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'category_slug_taken' USING ERRCODE = '23505';
  END;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_category(p_category_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.admin_require_permission('products');

  DELETE FROM public.categories WHERE category_id = p_category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- ============================================================
-- ENTITLEMENTS — the same gate, applied to 0015
--
-- 0015 checked `is_admin()` on its own, so a SUPPORT or MARKETING
-- account could grant, suspend, revoke and delete entitlements —
-- capabilities the app's own matrix withholds from both of them.
--
-- The three bodies below are COPIED from 0015, not rewritten.
-- Restating a function is how a migration quietly changes behaviour, and
-- the first draft of this section did exactly that: it dropped
-- `expires_at = CASE WHEN p_status = 'ACTIVE' THEN NULL`, so restoring
-- access would have left a lapsed expiry sitting on a row whose status
-- read ACTIVE — a book the reader would still refuse — and it renamed the
-- refusal from `access_not_found`, a token
-- src/lib/supabase-entitlements.ts already translates into a message.
--
-- The rule for this section, then: byte-identical to 0015 except for one
-- added `admin_require_permission('grant_access')` under the is_admin()
-- check. If a behaviour here ever needs to change, change it in 0015 as
-- well and re-copy, rather than editing only this copy.
-- ----------------------------------------------------------------

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
  PERFORM public.admin_require_permission('grant_access');

  -- The target must be a real account.
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
  'from a browser; the snapshot is captured from the catalogue server-side. '
  'Body copied verbatim from 0015 — only the grant_access gate is new.';

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
  PERFORM public.admin_require_permission('grant_access');

  -- Mirrors the CHECK on public.user_products.access_status.
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
  'Admin-only, and only for a role carrying grant_access: changes '
  'public.user_products.access_status. A non-ACTIVE status also revokes every '
  'content_access_grant already minted for the entitlement, through '
  'trg_user_product_revokes_grants. Body copied verbatim from 0015 — only the '
  'grant_access gate is new.';

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

  PERFORM public.admin_require_permission('grant_access');

  DELETE FROM public.user_products
   WHERE user_product_id = p_user_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_remove_access(uuid) IS
  'Admin-only, and only for a role carrying grant_access: deletes a '
  'public.user_products row. content_access_grants pointing at it are removed '
  'by their own ON DELETE CASCADE. Body copied verbatim from 0015 — only the '
  'grant_access gate is new.';


-- ============================================================
-- GRANTS — the boundary the probe found missing
--
-- `anon` is revoked by name, not only through PUBLIC, so the refusal
-- is a grant denial and no function body is entered at all. Nothing
-- changes for `authenticated`: the in-body permission check is what
-- decides, and it now consults the matrix.
-- ============================================================
DO $$
DECLARE
  v_fn text;
  v_sig text;
BEGIN
  FOR v_fn, v_sig IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'admin_save_product', 'admin_set_product_status',
         'admin_delete_product', 'admin_move_product',
         'admin_save_category', 'admin_delete_category',
         'admin_grant_access', 'admin_set_access_status',
         'admin_extend_access', 'admin_remove_access'
       )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', v_fn, v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', v_fn, v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', v_fn, v_sig);
  END LOOP;
END;
$$;

-- The checkout RPC is a customer's own purchase, not an admin action:
-- any signed-in account may call it, and it grants only to auth.uid().
-- It still must be unreachable by anon.
REVOKE ALL ON FUNCTION public.create_storefront_order(uuid, text, text, text, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_storefront_order(uuid, text, text, text, text, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_storefront_order(uuid, text, text, text, text, text, numeric) TO authenticated;

COMMIT;

-- ============================================================
-- VERIFICATION — run after applying
--
-- 1. The matrix matches src/lib/permissions.ts:
--
--      SELECT admin_role, string_agg(permission, ',' ORDER BY permission)
--        FROM public.admin_permission_matrix()
--       GROUP BY admin_role ORDER BY admin_role;
--
--    Expect: CONTENT edit_content,edit_price,cms,products / FINANCE
--    edit_price (no products) / MARKETING and SUPPORT none of the four
--    / SUPER_ADMIN all four.
--
-- 2. Nobody but `authenticated` may execute the admin functions:
--
--      SELECT routine_name, grantee
--        FROM information_schema.routine_privileges
--       WHERE routine_name LIKE 'admin\_%'
--         OR routine_name = 'create_storefront_order'
--       ORDER BY routine_name, grantee;
--
--    `anon` must not appear on any `admin_%` row.
--
-- 3. The permission matrix, as a customer-facing refusal. Run each as
--    the account named in the sign-in column; `permission_denied` is
--    the expected message and 42501 the expected code:
--
--      SELECT public.admin_save_product('{"name":"x","slug":"x","price":1}'::jsonb);
--      -- SUPPORT      -> permission_denied: products
--      -- MARKETING    -> permission_denied: products
--      -- FINANCE      -> permission_denied: products
--      -- CONTENT      -> succeeds (holds products + edit_price)
--      -- SUPER_ADMIN  -> succeeds
--      -- CUSTOMER     -> admin_required
--      -- anon         -> permission denied for function
--
--      SELECT public.admin_delete_product('<uuid>'::uuid);
--      -- SUPPORT / MARKETING / FINANCE / CONTENT -> permission_denied: delete_product
--      -- SUPER_ADMIN                               -> succeeds or product_not_found
--      -- CUSTOMER                                  -> admin_required
--
-- 4. The storefront is unaffected — as `anon`:
--
--      SELECT product_id, slug FROM public.products;   -- only ACTIVE+PUBLIC
--
--    Must return the published titles and nothing else.
-- ============================================================
