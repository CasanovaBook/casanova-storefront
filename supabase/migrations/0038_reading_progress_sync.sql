-- ============================================================
-- 0038 - Reading progress: RLS, entitlement-checked writes, and a
--        conflict rule that lives in the database
--
-- WHY
--
-- reading_progress has existed since the first schema and the web client has
-- never written to it. Position lived in one browser's localStorage, so
-- "continue where you left off" meant "where you left off on THIS device",
-- and a reader who switched from a laptop to a phone started again at page 1.
--
-- Three things this migration decides, deliberately:
--
-- 1. IDENTITY IS NOT AN ARGUMENT. user_id comes from the JWT. A caller cannot
--    write progress onto someone else's row, and cannot choose which row of
--    its own it overwrites.
--
-- 2. THE WRITE REQUIRES AN ENTITLEMENT. The client already checks this
--    (saveReadingProgress refuses without an ACTIVE user_products row), but a
--    check that exists only in the browser is a courtesy. Without it, any
--    authenticated account could create progress rows for titles it does not
--    own, and progress rows are a form of claim about a product.
--
-- 3. THE CONFLICT RULE IS SERVER-SIDE, AND IT IS TIME-BASED.
--    One row per (user, product) means two open devices are one row. The rule
--    is: a write advances the position only when its last_read_at is newer
--    than what is stored. Doing this in the client would lose the laptop's
--    page 120 to a phone that woke up, reconnected and pushed a stale page 12
--    - which is the bug every naive sync ships with. The function returns the
--    row as it now stands, so a refused-as-stale write still tells the caller
--    the truth rather than silently disagreeing with it.
--
-- WHAT IS NOT HERE, AND WHY
--
-- No supabase_realtime membership. Progress changes on every page turn; a
-- subscription would deliver the reader's own writes back to them and, worse,
-- would deliver another device's turn as a jump in the middle of a sentence.
-- Position is pulled when a book opens and pushed while reading - one
-- direction at a time, at the reader's initiative. The events that DO need to
-- arrive unasked (a device block, an entitlement change) already have their
-- own channels.
--
-- APPLY, THEN VERIFY
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'reading_progress';
--   -> reading_progress_select_own | SELECT   (and nothing else: no
--      INSERT/UPDATE/DELETE policy, because save_my_reading_progress is the
--      only write path)
--
--   As an entitled customer:
--     SELECT * FROM public.save_my_reading_progress(
--       '<product uuid>', 42, 31.5, now());
--   -> a row with user_id = the caller.
--
--   Then an OLDER timestamp for the same product:
--     SELECT * FROM public.save_my_reading_progress(
--       '<product uuid>', 7, 5.0, now() - interval '1 hour');
--   -> still current_page = 42. The stale write is refused by the rule, not
--      by an error.
--
--   As a customer with no entitlement:
--   -> ERROR: not_entitled
-- ============================================================

BEGIN;

-- ── 1. Row Level Security ───────────────────────────────────

ALTER TABLE public.reading_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reading_progress_select_own ON public.reading_progress;
CREATE POLICY reading_progress_select_own ON public.reading_progress
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- No INSERT, UPDATE or DELETE policy for any browser role. Writes go through
-- save_my_reading_progress(), which stamps user_id from the JWT and checks the
-- entitlement. Staff are not given a write policy either: an administrator
-- editing a reader's bookmark position is not a feature, and inventing one
-- here would be a permission with no screen behind it.

REVOKE ALL ON public.reading_progress FROM anon;

-- ── 2. The write ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_my_reading_progress(
  p_product_id       uuid,
  p_current_page     integer,
  p_progress_percent numeric,
  p_last_read_at     timestamptz DEFAULT now()
)
RETURNS public.reading_progress
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_row  public.reading_progress;
  v_page integer := greatest(1, coalesce(p_current_page, 1));
  v_pct  numeric := least(100, greatest(0, coalesce(p_progress_percent, 0)));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  /* The caller cannot name the row it is writing, and cannot write about a
   * title it does not hold. */
  IF NOT EXISTS (
    SELECT 1 FROM public.user_products up
     WHERE up.user_id = v_uid
       AND up.product_id = p_product_id
       AND up.access_status = 'ACTIVE'
       AND (up.expires_at IS NULL OR up.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'not_entitled';
  END IF;

  INSERT INTO public.reading_progress (
    user_id, product_id, current_page, progress_percent, last_read_at
  ) VALUES (
    v_uid, p_product_id, v_page, v_pct, coalesce(p_last_read_at, now())
  )
  ON CONFLICT (user_id, product_id) DO UPDATE
     SET current_page     = EXCLUDED.current_page,
         progress_percent = EXCLUDED.progress_percent,
         last_read_at     = EXCLUDED.last_read_at
   WHERE reading_progress.last_read_at < EXCLUDED.last_read_at
  RETURNING * INTO v_row;

  /* A write refused by the WHERE clause above leaves RETURNING empty. Read
   * the row back so the caller learns the canonical position instead of
   * believing its own stale one - this is what stops two devices drifting
   * apart while both think they saved. */
  IF NOT FOUND THEN
    SELECT * INTO v_row
      FROM public.reading_progress
     WHERE user_id = v_uid AND product_id = p_product_id;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.save_my_reading_progress(uuid, integer, numeric, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_my_reading_progress(uuid, integer, numeric, timestamptz) TO authenticated;

-- ── VERIFY ─────────────────────────────────────────────────
--
-- 1. Policies: the header query. Exactly one row, SELECT only.
--
-- 2. Entitled write creates a row; a second call with a NEWER last_read_at
--    advances it; a call with an OLDER one returns the current row unchanged
--    and does not move the page backwards.
--
-- 3. A customer without an entitlement gets not_entitled, and no row appears.
--
-- 4. As user A, SELECT * FROM reading_progress returns only A's rows, and a
--    direct INSERT is refused by RLS.
--
-- 5. End to end: read to page 30 on the laptop, close it, open the same title
--    on the phone - it opens at page 30. Then turn to page 40 on the phone and
--    reopen the laptop: the laptop's stale page-30 write must not pull the
--    phone back, and the laptop must show 40 on its next open.

COMMIT;
