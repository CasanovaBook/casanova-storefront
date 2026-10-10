-- ============================================================
-- 0002 — Maestro CMS database tables
-- ============================================================
-- Applies on top of schema.sql + 0001_mobile_reader.sql.
-- Safe to re-run: every statement is IF NOT EXISTS or conditional.
--
-- WHY THIS MIGRATION EXISTS
--   Maestro CMS was ported into the Casanova storefront with a local
--   connector (localStorage). The Supabase connector existed but
--   referenced tables that were never created in the database schema:
--
--     - site_content   — did not exist at all
--     - audit_log      — schema has audit_logs (different columns)
--     - media          — schema has content_assets (different columns)
--
--   This migration creates the three tables Maestro needs, with the
--   exact column shapes its connector expects. They live alongside the
--   existing Casanova tables without conflicting.
--
--   Once applied, set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY and
--   Maestro automatically switches from localStorage to the database.
-- ============================================================

BEGIN;

-- ============================================================
-- SITE_CONTENT — key/value store for all editable site text
-- ============================================================
-- Each row is one content field. The `id` is the stable key from the
-- registry (e.g. "global.brand", "ui.auth.loginTitle", "terms.sections").
-- The `value` is JSONB so it can hold strings, arrays of objects
-- (for list fields like nav links or testimonial sections), or any
-- other JSON shape the registry defines.
--
-- When no row exists for a key, the site falls back to the registry
-- default. Editing a field in Maestro upserts the row; resetting to
-- default deletes it.
-- ============================================================
CREATE TABLE IF NOT EXISTS site_content (
  id          VARCHAR(255) PRIMARY KEY,
  value       JSONB        NOT NULL DEFAULT '{}'::JSONB,
  updated_by  VARCHAR(255),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_content_updated
  ON site_content (updated_at DESC);

-- Auto-touch updated_at on every PATCH.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_site_content_updated_at'
  ) THEN
    CREATE TRIGGER trg_site_content_updated_at
      BEFORE UPDATE ON site_content
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- The set_updated_at() function may not exist yet. Create it if missing.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ============================================================
-- MAESTRO_AUDIT_LOG — change trail for CMS operations
-- ============================================================
-- Separate from the Casanova audit_logs table (which tracks admin CRM
-- operations with its own column shape). This table records every
-- content save, reset, media upload and settings change made through
-- the Maestro CMS editor.
--
-- The Supabase connector writes here via the `audit_log` collection.
-- The Maestro audit viewer page reads from it.
-- ============================================================
CREATE TABLE IF NOT EXISTS maestro_audit_log (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    VARCHAR(255) NOT NULL DEFAULT '',
  actor_email VARCHAR(255) NOT NULL DEFAULT '',
  action      VARCHAR(50)  NOT NULL DEFAULT ''
                CHECK (action IN ('create','update','delete','list','get','')),
  entity      VARCHAR(100) NOT NULL DEFAULT '',
  entity_id   VARCHAR(255) NOT NULL DEFAULT '',
  detail      TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maestro_audit_entity
  ON maestro_audit_log (entity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maestro_audit_actor
  ON maestro_audit_log (actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maestro_audit_created
  ON maestro_audit_log (created_at DESC);

-- ============================================================
-- MEDIA — uploaded images and files managed through Maestro
-- ============================================================
-- Separate from content_assets (which holds DRM-protected book files
-- tied to products). This table holds editorial media: hero images,
-- blog photos, testimonial pictures, any file uploaded through the
-- Maestro CMS media library.
--
-- Files are stored in Supabase Storage under the /media bucket.
-- The `url` column holds the public URL.
-- ============================================================
CREATE TABLE IF NOT EXISTS media (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL DEFAULT '',
  url         TEXT         NOT NULL DEFAULT '',
  size        INTEGER      NOT NULL DEFAULT 0,
  width       INTEGER,
  height      INTEGER,
  alt         TEXT         NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_created
  ON media (created_at DESC);

-- ============================================================
-- RLS POLICIES — security lives in the database
-- ============================================================
-- When Supabase RLS is enabled, these policies control who can read
-- and write the Maestro tables. The anon key can read published
-- content; only authenticated staff may write.
-- ============================================================

-- Enable RLS on all three tables.
ALTER TABLE site_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE maestro_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;

-- Site content: anyone can read (the site needs it for every visitor),
-- only authenticated users can write (Maestro editors).
DO $$
BEGIN
  -- Drop existing policies if re-running.
  DROP POLICY IF EXISTS site_content_read ON site_content;
  DROP POLICY IF EXISTS site_content_write ON site_content;

  CREATE POLICY site_content_read ON site_content
    FOR SELECT USING (true);

  CREATE POLICY site_content_write ON site_content
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
END;
$$;

-- Maestro audit: staff can read and create; no public access.
DO $$
BEGIN
  DROP POLICY IF EXISTS maestro_audit_read ON maestro_audit_log;
  DROP POLICY IF EXISTS maestro_audit_write ON maestro_audit_log;

  CREATE POLICY maestro_audit_read ON maestro_audit_log
    FOR SELECT
    USING (auth.role() = 'authenticated');

  CREATE POLICY maestro_audit_write ON maestro_audit_log
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
END;
$$;

-- Media: anyone can read (images are public), authenticated users can write.
DO $$
BEGIN
  DROP POLICY IF EXISTS media_read ON media;
  DROP POLICY IF EXISTS media_write ON media;

  CREATE POLICY media_read ON media
    FOR SELECT USING (true);

  CREATE POLICY media_write ON media
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
END;
$$;

-- ============================================================
-- SEED — initial content from registry defaults
-- ============================================================
-- No seed data here. The site falls back to the registry defaults
-- when no row exists in site_content. The first time an admin edits
-- a field in Maestro, the row is created. This keeps the migration
-- lightweight and avoids duplicating the registry in SQL.
-- ============================================================

COMMIT;

-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('site_content','maestro_audit_log','media');
--   → 3 rows
--
--   SELECT COUNT(*) FROM site_content;  → 0 (empty until first edit)
--
--   SELECT policyname FROM pg_policies
--    WHERE tablename = 'site_content';
--   → site_content_read, site_content_write
-- ============================================================
