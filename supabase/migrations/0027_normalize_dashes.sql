-- ============================================================
-- 0027 - Normalize en/em dashes in landing page and CMS content
-- ============================================================
-- Replaces U+2013 (en dash) and U+2014 (em dash) with a regular
-- hyphen in every content column the storefront and Maestro CMS read.
--
-- Existing rows are cleaned below. A BEFORE INSERT OR UPDATE trigger
-- is then attached to each content table, so future saves from the CMS,
-- the admin RPCs, or the REST API are normalized before they are stored.
--
-- chr(8211) / chr(8212) are used instead of literal characters so the
-- migration stays ASCII-safe regardless of the SQL client encoding.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION normalize_dashes_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT replace(replace(input, chr(8211), '-'), chr(8212), '-');
$$;

CREATE OR REPLACE FUNCTION normalize_dashes_text_array(input text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN input IS NULL THEN NULL
    ELSE ARRAY(
      SELECT normalize_dashes_text(item)
      FROM unnest(input) WITH ORDINALITY AS t(item, ord)
      ORDER BY ord
    )
  END;
$$;

CREATE OR REPLACE FUNCTION normalize_dashes_jsonb(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  kind text := jsonb_typeof(input);
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  ELSIF kind = 'string' THEN
    RETURN to_jsonb(normalize_dashes_text(input #>> '{}'));
  ELSIF kind = 'array' THEN
    RETURN COALESCE(
      (
        SELECT jsonb_agg(normalize_dashes_jsonb(item) ORDER BY ord)
        FROM jsonb_array_elements(input) WITH ORDINALITY AS t(item, ord)
      ),
      '[]'::jsonb
    );
  ELSIF kind = 'object' THEN
    RETURN COALESCE(
      (
        SELECT jsonb_object_agg(key, normalize_dashes_jsonb(item))
        FROM jsonb_each(input) AS t(key, item)
      ),
      '{}'::jsonb
    );
  END IF;
  RETURN input;
END;
$$;

-- Normalizes only the columns named in the trigger arguments. Keeping the
-- allow-list explicit leaves identifiers, slugs, URLs and storage paths alone.
CREATE OR REPLACE FUNCTION normalize_dashes_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  data jsonb := to_jsonb(NEW);
  column_name text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    IF data ? column_name THEN
      data := jsonb_set(
        data,
        ARRAY[column_name],
        normalize_dashes_jsonb(data -> column_name),
        true
      );
    END IF;
  END LOOP;

  NEW := jsonb_populate_record(NEW, data);
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- Clean existing content
-- ------------------------------------------------------------

-- Maestro key/value content. This covers every sales.* field and any
-- nested list (benefits, chapter topics, audience lists, FAQ rows).
UPDATE site_content
SET value = normalize_dashes_jsonb(value)
WHERE position(chr(8211) in value::text) > 0
   OR position(chr(8212) in value::text) > 0;

-- Landing page platform copy.
UPDATE platform_settings
SET brand_name     = normalize_dashes_text(brand_name),
    tagline        = normalize_dashes_text(tagline),
    trust_badges   = normalize_dashes_text_array(trust_badges),
    catalogue_title = normalize_dashes_text(catalogue_title),
    catalogue_blurb = normalize_dashes_text(catalogue_blurb),
    pricing_title  = normalize_dashes_text(pricing_title),
    pricing_blurb  = normalize_dashes_text(pricing_blurb),
    footer_text    = normalize_dashes_text(footer_text)
WHERE position(chr(8211) in coalesce(brand_name, '')) > 0
   OR position(chr(8212) in coalesce(brand_name, '')) > 0
   OR position(chr(8211) in coalesce(tagline, '')) > 0
   OR position(chr(8212) in coalesce(tagline, '')) > 0
   OR position(chr(8211) in coalesce(catalogue_title, '')) > 0
   OR position(chr(8212) in coalesce(catalogue_title, '')) > 0
   OR position(chr(8211) in coalesce(catalogue_blurb, '')) > 0
   OR position(chr(8212) in coalesce(catalogue_blurb, '')) > 0
   OR position(chr(8211) in coalesce(pricing_title, '')) > 0
   OR position(chr(8212) in coalesce(pricing_title, '')) > 0
   OR position(chr(8211) in coalesce(pricing_blurb, '')) > 0
   OR position(chr(8212) in coalesce(pricing_blurb, '')) > 0
   OR position(chr(8211) in coalesce(footer_text, '')) > 0
   OR position(chr(8212) in coalesce(footer_text, '')) > 0
   OR EXISTS (
     SELECT 1 FROM unnest(trust_badges) AS badge
     WHERE position(chr(8211) in badge) > 0
        OR position(chr(8212) in badge) > 0
   );

-- Book descriptions and pricing copy.
UPDATE products
SET name              = normalize_dashes_text(name),
    subtitle          = normalize_dashes_text(subtitle),
    description       = normalize_dashes_text(description),
    short_description = normalize_dashes_text(short_description),
    seo_title         = normalize_dashes_text(seo_title),
    seo_description   = normalize_dashes_text(seo_description),
    seo_keywords      = normalize_dashes_text(seo_keywords),
    tags              = normalize_dashes_text_array(tags)
WHERE position(chr(8211) in coalesce(name, '')) > 0
   OR position(chr(8212) in coalesce(name, '')) > 0
   OR position(chr(8211) in coalesce(subtitle, '')) > 0
   OR position(chr(8212) in coalesce(subtitle, '')) > 0
   OR position(chr(8211) in coalesce(description, '')) > 0
   OR position(chr(8212) in coalesce(description, '')) > 0
   OR position(chr(8211) in coalesce(short_description, '')) > 0
   OR position(chr(8212) in coalesce(short_description, '')) > 0
   OR position(chr(8211) in coalesce(seo_title, '')) > 0
   OR position(chr(8212) in coalesce(seo_title, '')) > 0
   OR position(chr(8211) in coalesce(seo_description, '')) > 0
   OR position(chr(8212) in coalesce(seo_description, '')) > 0
   OR position(chr(8211) in coalesce(seo_keywords, '')) > 0
   OR position(chr(8212) in coalesce(seo_keywords, '')) > 0
   OR EXISTS (
     SELECT 1 FROM unnest(tags) AS tag
     WHERE position(chr(8211) in tag) > 0
        OR position(chr(8212) in tag) > 0
   );

UPDATE books
SET author_name = normalize_dashes_text(author_name),
    publisher   = normalize_dashes_text(publisher)
WHERE position(chr(8211) in coalesce(author_name, '')) > 0
   OR position(chr(8212) in coalesce(author_name, '')) > 0
   OR position(chr(8211) in coalesce(publisher, '')) > 0
   OR position(chr(8212) in coalesce(publisher, '')) > 0;

UPDATE categories
SET name        = normalize_dashes_text(name),
    description = normalize_dashes_text(description)
WHERE position(chr(8211) in coalesce(name, '')) > 0
   OR position(chr(8212) in coalesce(name, '')) > 0
   OR position(chr(8211) in coalesce(description, '')) > 0
   OR position(chr(8212) in coalesce(description, '')) > 0;

UPDATE cms_sections
SET title   = normalize_dashes_text(title),
    content = normalize_dashes_text(content)
WHERE position(chr(8211) in coalesce(title, '')) > 0
   OR position(chr(8212) in coalesce(title, '')) > 0
   OR position(chr(8211) in coalesce(content, '')) > 0
   OR position(chr(8212) in coalesce(content, '')) > 0;

UPDATE testimonials
SET quote = normalize_dashes_text(quote),
    name  = normalize_dashes_text(name),
    title = normalize_dashes_text(title)
WHERE position(chr(8211) in coalesce(quote, '')) > 0
   OR position(chr(8212) in coalesce(quote, '')) > 0
   OR position(chr(8211) in coalesce(name, '')) > 0
   OR position(chr(8212) in coalesce(name, '')) > 0
   OR position(chr(8211) in coalesce(title, '')) > 0
   OR position(chr(8212) in coalesce(title, '')) > 0;

UPDATE faqs
SET question = normalize_dashes_text(question),
    answer   = normalize_dashes_text(answer)
WHERE position(chr(8211) in coalesce(question, '')) > 0
   OR position(chr(8212) in coalesce(question, '')) > 0
   OR position(chr(8211) in coalesce(answer, '')) > 0
   OR position(chr(8212) in coalesce(answer, '')) > 0;

UPDATE product_images
SET alt_text = normalize_dashes_text(alt_text)
WHERE position(chr(8211) in coalesce(alt_text, '')) > 0
   OR position(chr(8212) in coalesce(alt_text, '')) > 0;

UPDATE product_media_links
SET label = normalize_dashes_text(label)
WHERE position(chr(8211) in coalesce(label, '')) > 0
   OR position(chr(8212) in coalesce(label, '')) > 0;

DO $$
BEGIN
  IF to_regclass('public.cms_pages') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE cms_pages
      SET title           = normalize_dashes_text(title),
          content         = normalize_dashes_text(content),
          excerpt         = normalize_dashes_text(excerpt),
          seo_title       = normalize_dashes_text(seo_title),
          seo_description = normalize_dashes_text(seo_description)
      WHERE position(chr(8211) in coalesce(title, '')) > 0
         OR position(chr(8212) in coalesce(title, '')) > 0
         OR position(chr(8211) in coalesce(content, '')) > 0
         OR position(chr(8212) in coalesce(content, '')) > 0
         OR position(chr(8211) in coalesce(excerpt, '')) > 0
         OR position(chr(8212) in coalesce(excerpt, '')) > 0
         OR position(chr(8211) in coalesce(seo_title, '')) > 0
         OR position(chr(8212) in coalesce(seo_title, '')) > 0
         OR position(chr(8211) in coalesce(seo_description, '')) > 0
         OR position(chr(8212) in coalesce(seo_description, '')) > 0
    $sql$;
  ELSE
    RAISE NOTICE 'normalize_dashes: cms_pages does not exist, skipping cleanup';
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.cms_categories') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE cms_categories
      SET name        = normalize_dashes_text(name),
          description = normalize_dashes_text(description)
      WHERE position(chr(8211) in coalesce(name, '')) > 0
         OR position(chr(8212) in coalesce(name, '')) > 0
         OR position(chr(8211) in coalesce(description, '')) > 0
         OR position(chr(8212) in coalesce(description, '')) > 0
    $sql$;
  ELSE
    RAISE NOTICE 'normalize_dashes: cms_categories does not exist, skipping cleanup';
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- Keep future writes normalized
-- ------------------------------------------------------------
CREATE OR REPLACE PROCEDURE ensure_normalize_dashes_trigger(
  target_table text,
  target_columns text[]
)
LANGUAGE plpgsql
AS $$
DECLARE
  trigger_name text := 'trg_normalize_dashes_' || target_table;
  column_list text;
BEGIN
  IF to_regclass(format('public.%I', target_table)) IS NULL THEN
    RAISE NOTICE 'normalize_dashes: skipping missing table %', target_table;
    RETURN;
  END IF;

  SELECT string_agg(quote_literal(t.column_name), ', ')
  INTO column_list
  FROM unnest(target_columns) AS t(column_name);

  EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name, target_table);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I '
    'FOR EACH ROW EXECUTE FUNCTION public.normalize_dashes_row(%s)',
    trigger_name,
    target_table,
    column_list
  );
END;
$$;

CALL ensure_normalize_dashes_trigger('site_content', ARRAY['value']);
CALL ensure_normalize_dashes_trigger('platform_settings', ARRAY[
  'brand_name', 'tagline', 'trust_badges', 'catalogue_title',
  'catalogue_blurb', 'pricing_title', 'pricing_blurb', 'footer_text'
]);
CALL ensure_normalize_dashes_trigger('products', ARRAY[
  'name', 'subtitle', 'description', 'short_description',
  'seo_title', 'seo_description', 'seo_keywords', 'tags'
]);
CALL ensure_normalize_dashes_trigger('books', ARRAY['author_name', 'publisher']);
CALL ensure_normalize_dashes_trigger('categories', ARRAY['name', 'description']);
CALL ensure_normalize_dashes_trigger('cms_sections', ARRAY['title', 'content']);
CALL ensure_normalize_dashes_trigger('testimonials', ARRAY['quote', 'name', 'title']);
CALL ensure_normalize_dashes_trigger('faqs', ARRAY['question', 'answer']);
CALL ensure_normalize_dashes_trigger('product_images', ARRAY['alt_text']);
CALL ensure_normalize_dashes_trigger('product_media_links', ARRAY['label']);
CALL ensure_normalize_dashes_trigger('cms_pages', ARRAY[
  'title', 'content', 'excerpt', 'seo_title', 'seo_description'
]);
CALL ensure_normalize_dashes_trigger('cms_categories', ARRAY['name', 'description']);

DROP PROCEDURE IF EXISTS ensure_normalize_dashes_trigger(text, text[]);

COMMIT;

-- ============================================================
-- Verification after applying
-- ============================================================
-- 1. No content rows should remain with U+2013 or U+2014:
--
--   SELECT 'site_content' AS source, count(*) AS remaining
--     FROM site_content
--    WHERE position(chr(8211) in value::text) > 0
--       OR position(chr(8212) in value::text) > 0
--   UNION ALL
--   SELECT 'products', count(*) FROM products
--    WHERE position(chr(8211) in coalesce(name, '') || coalesce(subtitle, '')
--          || description || short_description) > 0
--       OR position(chr(8212) in coalesce(name, '') || coalesce(subtitle, '')
--          || description || short_description) > 0;
--
-- 2. Trigger coverage:
--
--   SELECT event_object_table, trigger_name
--     FROM information_schema.triggers
--    WHERE trigger_name LIKE 'trg_normalize_dashes_%'
--    ORDER BY event_object_table;
-- ============================================================
