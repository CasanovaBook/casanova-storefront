-- ============================================================
-- 0034 - reader bookmarks and highlights
--
-- Customer-owned annotations for a purchased title. Both tables are
-- RLS-scoped to auth.uid(): a client can read, create, edit or delete only
-- rows whose user_id is its own. The service role is not needed for these
-- writes; the browser's authenticated role owns them directly.
--
-- Page is 1-based and refers to the PDF page. Highlight rectangles are
-- normalized to the rendered page (0..1), so they survive zoom, fullscreen
-- and the two-page spread layout.
-- ============================================================

BEGIN;

-- ── Bookmarks ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reader_bookmarks (
  bookmark_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users (user_id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products (product_id) ON DELETE CASCADE,
  page        INTEGER NOT NULL CHECK (page >= 1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_reader_bookmark_page UNIQUE (user_id, product_id, page)
);

CREATE INDEX IF NOT EXISTS idx_reader_bookmarks_owner
  ON public.reader_bookmarks (user_id, product_id, page);

ALTER TABLE public.reader_bookmarks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reader_bookmarks FROM anon;
GRANT SELECT, INSERT, DELETE ON public.reader_bookmarks TO authenticated;

DROP POLICY IF EXISTS reader_bookmarks_select_own ON public.reader_bookmarks;
CREATE POLICY reader_bookmarks_select_own
  ON public.reader_bookmarks
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS reader_bookmarks_insert_own ON public.reader_bookmarks;
CREATE POLICY reader_bookmarks_insert_own
  ON public.reader_bookmarks
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS reader_bookmarks_delete_own ON public.reader_bookmarks;
CREATE POLICY reader_bookmarks_delete_own
  ON public.reader_bookmarks
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ── Highlights and notes ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reader_highlights (
  highlight_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users (user_id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES public.products (product_id) ON DELETE CASCADE,
  page         INTEGER NOT NULL CHECK (page >= 1),
  color        VARCHAR(20) NOT NULL DEFAULT '#facc15'
                 CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  -- Array of normalized { x, y, width, height } objects (0..1).
  rects        JSONB NOT NULL DEFAULT '[]'::JSONB
                 CHECK (jsonb_typeof(rects) = 'array'),
  quote        TEXT NOT NULL DEFAULT ''
                 CHECK (char_length(quote) <= 4000),
  note         TEXT CHECK (note IS NULL OR char_length(note) <= 2000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reader_highlights_owner
  ON public.reader_highlights (user_id, product_id, page, created_at);

ALTER TABLE public.reader_highlights ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reader_highlights FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reader_highlights TO authenticated;

DROP POLICY IF EXISTS reader_highlights_select_own ON public.reader_highlights;
CREATE POLICY reader_highlights_select_own
  ON public.reader_highlights
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS reader_highlights_insert_own ON public.reader_highlights;
CREATE POLICY reader_highlights_insert_own
  ON public.reader_highlights
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS reader_highlights_update_own ON public.reader_highlights;
CREATE POLICY reader_highlights_update_own
  ON public.reader_highlights
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS reader_highlights_delete_own ON public.reader_highlights;
CREATE POLICY reader_highlights_delete_own
  ON public.reader_highlights
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

COMMIT;
