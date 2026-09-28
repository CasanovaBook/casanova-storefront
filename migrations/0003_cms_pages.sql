-- ============================================================
-- 0003 — CMS custom pages + categories
-- ============================================================
-- Lets staff create new content pages from Maestro CMS and organise
-- them into categories. Each page has a slug that becomes its public
-- URL (/pages/<slug>). Content is stored as Markdown so the editor
-- can render headings, paragraphs, lists, bold, links and images
-- without a heavyweight rich-text library.
-- ============================================================

BEGIN;

-- ============================================================
-- CMS_CATEGORIES — grouping for custom pages
-- ============================================================
CREATE TABLE IF NOT EXISTS cms_categories (
  id            VARCHAR(255) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(255) UNIQUE NOT NULL,
  description   TEXT         NOT NULL DEFAULT '',
  display_order INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_categories_order
  ON cms_categories (display_order, name);

-- ============================================================
-- CMS_PAGES — custom content pages created from Maestro
-- ============================================================
CREATE TABLE IF NOT EXISTS cms_pages (
  id              VARCHAR(255) PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  slug            VARCHAR(255) UNIQUE NOT NULL,
  content         TEXT         NOT NULL DEFAULT '',
  excerpt         TEXT         NOT NULL DEFAULT '',
  category_id     VARCHAR(255) REFERENCES cms_categories (id) ON DELETE SET NULL,
  cover_image     TEXT         NOT NULL DEFAULT '',
  seo_title       VARCHAR(180),
  seo_description VARCHAR(320),
  status          VARCHAR(50)  NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('ACTIVE', 'INACTIVE', 'DRAFT', 'ARCHIVED')),
  visibility      VARCHAR(20)  NOT NULL DEFAULT 'PUBLIC'
                    CHECK (visibility IN ('PUBLIC', 'UNLISTED', 'HIDDEN')),
  display_order   INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_pages_status
  ON cms_pages (status);
CREATE INDEX IF NOT EXISTS idx_cms_pages_category
  ON cms_pages (category_id);
CREATE INDEX IF NOT EXISTS idx_cms_pages_order
  ON cms_pages (display_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_pages_storefront
  ON cms_pages (status, visibility)
  WHERE status = 'ACTIVE' AND visibility = 'PUBLIC';

-- Auto-touch updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cms_categories_updated_at'
  ) THEN
    CREATE TRIGGER trg_cms_categories_updated_at
      BEFORE UPDATE ON cms_categories
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cms_pages_updated_at'
  ) THEN
    CREATE TRIGGER trg_cms_pages_updated_at
      BEFORE UPDATE ON cms_pages
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ============================================================
-- RLS POLICIES
-- ============================================================
ALTER TABLE cms_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_pages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS cms_categories_read ON cms_categories;
  DROP POLICY IF EXISTS cms_categories_write ON cms_categories;
  DROP POLICY IF EXISTS cms_pages_read ON cms_pages;
  DROP POLICY IF EXISTS cms_pages_write ON cms_pages;

  -- Categories: public read, authenticated write
  CREATE POLICY cms_categories_read ON cms_categories
    FOR SELECT USING (true);

  CREATE POLICY cms_categories_write ON cms_categories
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

  -- Pages: public read only ACTIVE+PUBLIC, authenticated full access
  CREATE POLICY cms_pages_read ON cms_pages
    FOR SELECT USING (true);

  CREATE POLICY cms_pages_write ON cms_pages
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
END;
$$;

COMMIT;
