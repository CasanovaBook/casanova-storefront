-- ============================================================
-- 0022 — make /admin/products write the real catalogue
--        [REQUIRES SERVER-SIDE FUNCTIONS]
--
-- THE BUG
--
-- The admin products page rendered and saved `localStorage['casanova_db_v1']`
-- while every public surface — the storefront, the sales page, the reader's
-- signed-URL endpoint — read `public.products` in Supabase. An edit in
-- /admin/products therefore changed nothing a customer could see, and a
-- product the storefront sold had no admin row to edit at all.
--
-- WHY THE WRITE IS A FUNCTION, NOT A TABLE POLICY
--
-- RLS is row-level. A policy wide enough for an admin to write the catalogue
-- is also a policy a client holding the anon key could exercise by
-- impersonating the request, and `products` is the source of truth for what
-- is sold, at what price, and whether it is public. So the catalogue stays
-- unwritable from the browser and every admin write goes through a
-- SECURITY DEFINER function that checks `is_admin()` itself — the same
-- pattern as 0011 (account status), 0013 and 0015 (entitlements).
--
-- WHAT THE FUNCTIONS DO
--
--   admin_save_product(jsonb)     insert or update a product row, plus its
--                                 books / categories / images / links /
--                                 relations in the same transaction
--   admin_set_product_status(...) ACTIVE / INACTIVE / DRAFT / ARCHIVED
--   admin_delete_product(uuid)    hard delete, refused while referenced
--   admin_move_product(uuid,int)  swap position with the neighbour
--   admin_save_category(jsonb)    insert or update a category
--   admin_delete_category(uuid)   delete a category (product links cascade)
--
-- PAYLOAD CONTRACT — presence means "set", absent means "leave alone"
--
-- The panel sends only the fields it changed (`diffPatch`). A key that is
-- present is written; a key that is absent is left untouched; a key present
-- with a JSON null clears the column. This is what lets an editor empty a
-- sale price without every other field being overwritten by defaults.
-- ============================================================

BEGIN;

-- ============================================================
-- SAVE PRODUCT — insert or update one catalogue row
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

  -- An update carries the row's id; a create may carry a pre-generated one
  -- (the panel uploads to Storage under it before the first save) or none.
  v_id := COALESCE(NULLIF(p_product->>'product_id', '')::uuid, gen_random_uuid());

  /* The stored row, read once. The INSERT leg below cannot see `products.*`
   * the way the ON CONFLICT leg can, so every field a partial update does
   * not carry has to fall back to these values — otherwise a price-only
   * edit would be validated against price = 0 on the insert attempt and
   * rejected by the sale-price CHECK before the conflict was ever seen. */
  SELECT price, sale_price, status, product_type, name, slug
    INTO v_ex_price, v_ex_sale, v_ex_status, v_ex_type, v_ex_name, v_ex_slug
    FROM public.products
   WHERE product_id = v_id;

  /* The proposed insert tuple must satisfy every NOT NULL and CHECK on its
   * own: PostgreSQL validates it before it ever reaches conflict resolution,
   * so a price-only update that proposed name = NULL would be rejected by the
   * NOT NULL constraint instead of falling through to the UPDATE branch. The
   * values a partial update does not carry therefore fall back to the stored
   * row here; the ON CONFLICT branch below decides what is actually written. */
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

  -- ── Book metadata (EBOOK only; the books trigger enforces it) ──
  v_book := p_product->'book';
  IF p_product ? 'book' THEN
    v_book_any := jsonb_typeof(v_book) = 'object' AND (
      COALESCE(btrim(COALESCE(v_book->>'author_name', '')), '') <> '' OR
      COALESCE(btrim(COALESCE(v_book->>'isbn', '')), '') <> '' OR
      COALESCE(btrim(COALESCE(v_book->>'publisher', '')), '') <> '' OR
      COALESCE(btrim(COALESCE(v_book->>'language', '')), '') <> '' OR
      COALESCE(btrim(COALESCE(v_book->>'publication_date', '')), '') <> '' OR
      NULLIF(v_book->>'total_pages', '') IS NOT NULL
    );

    -- The books trigger refuses a row for any non-EBOOK product, so a
    -- stale row is removed instead of kept.
    IF v_type <> 'EBOOK' THEN
      v_book_any := false;
    END IF;

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
      SELECT v_row.product_id, img.value, (ord - 1)::integer
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
             COALESCE(NULLIF(ml.value->>'platform', ''), 'WEB'),
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
  'SECURITY DEFINER because the catalogue is the source of truth for what is '
  'sold; is_admin() is the real gate. Payload keys present are written, '
  'absent keys are left alone, null clears.';

REVOKE ALL ON FUNCTION public.admin_save_product(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_product(jsonb) TO authenticated;

-- ============================================================
-- SET STATUS — publish, unpublish, draft or archive
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

COMMENT ON FUNCTION public.admin_set_product_status(uuid, text) IS
  'Admin-only: changes public.products.status. Archiving stamps archived_at; '
  'any other status clears it.';

REVOKE ALL ON FUNCTION public.admin_set_product_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_product_status(uuid, text) TO authenticated;

-- ============================================================
-- DELETE — hard delete, refused while referenced
-- ============================================================
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

  DELETE FROM public.products WHERE product_id = p_product_id;
END;
$$;

COMMENT ON FUNCTION public.admin_delete_product(uuid) IS
  'Admin-only: deletes a catalogue row. Refused with product_has_orders / '
  'product_has_grants while financial or entitlement history references it, '
  'so archiving stays the only safe removal for a sold title.';

REVOKE ALL ON FUNCTION public.admin_delete_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_product(uuid) TO authenticated;

-- ============================================================
-- MOVE — swap display position with the neighbour
-- ============================================================
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
  v_pos     integer;
  v_other   uuid;
  v_other_pos integer;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

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

COMMENT ON FUNCTION public.admin_move_product(uuid, integer) IS
  'Admin-only: swaps public.products.position with the adjacent row in the '
  'displayed order. A no-op at the edge of the grid.';

REVOKE ALL ON FUNCTION public.admin_move_product(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_move_product(uuid, integer) TO authenticated;

-- ============================================================
-- SAVE CATEGORY — insert or update one category
-- ============================================================
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

COMMENT ON FUNCTION public.admin_save_category(jsonb) IS
  'Admin-only: inserts or updates one public.categories row. The storefront '
  'filters read this table, so category edits in /admin/products reach it.';

REVOKE ALL ON FUNCTION public.admin_save_category(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_category(jsonb) TO authenticated;

-- ============================================================
-- DELETE CATEGORY
-- ============================================================
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

  DELETE FROM public.categories WHERE category_id = p_category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_delete_category(uuid) IS
  'Admin-only: deletes a category. product_categories rows cascade, exactly '
  'as the removed product-to-category link did in the local document.';

REVOKE ALL ON FUNCTION public.admin_delete_category(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_category(uuid) TO authenticated;

COMMIT;

-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
-- 1. Six functions, all SECURITY DEFINER with a pinned search_path:
--
--    SELECT p.proname, p.prosecdef, p.proconfig
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public'
--       AND p.proname IN ('admin_save_product','admin_set_product_status',
--                         'admin_delete_product','admin_move_product',
--                         'admin_save_category','admin_delete_category');
--    → 6 rows, prosecdef = true, proconfig = {search_path=public, pg_temp}
--
-- 2. Only signed-in users may execute them (`anon` must NOT appear):
--
--    SELECT routine_name, grantee, privilege_type
--      FROM information_schema.routine_privileges
--     WHERE routine_name LIKE 'admin\_%'
--     ORDER BY routine_name, grantee;
--
-- 3. Nothing about the read policies changed. The storefront's public read
--    and the admin's full read keep working exactly as before; only writes
--    were added.
--
-- 4. A non-admin must be refused (run as a signed-in customer) — expect
--    ERROR: admin_required:
--
--    SELECT public.admin_save_product('{"name":"x","slug":"x"}'::jsonb);
-- ============================================================
