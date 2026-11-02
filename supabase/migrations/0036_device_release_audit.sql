-- ============================================================
-- 0036 - Device disconnect: recorded state, and re-claims that leave a trace
--
-- WHY
--
-- 0035 made the server the authority on which devices hold slots. Two
-- loose ends survived it, and both are about what a disconnect *leaves
-- behind*.
--
--   1. A self-release wrote `ended_at` and nothing else. The row kept
--      `secure_flag_active = TRUE`, so a device that had been deliberately
--      disconnected was indistinguishable in the table from one that was
--      still open and protected - and the release wrote no event at all, so
--      the protection log only ever showed blocks, never the disconnects that
--      came before them. The reader whose slot someone else freed learned
--      nothing, and support could not tell "the reader released their phone"
--      from "the sweep reaped it".
--   2. A blocked fingerprint could claim a fresh slot - by design, the lock
--      screen tells the reader to ask for re-registration, and the limit is
--      checked again on the way back in. But it did so silently: nothing in
--      the log said "the device you blocked twenty minutes ago is reading
--      again". An administrator was left believing a block had more effect
--      than it does.
--
-- This migration records both. It does NOT make a block permanent: a revoked
-- device can still re-register if a slot is free, which is the product's
-- stated intent. What changes is that every such re-claim is now an event an
-- administrator can see and act on.
--
-- APPLY, THEN VERIFY
--
--    SELECT conname, pg_get_constraintdef(oid)
--      FROM pg_constraint
--     WHERE conrelid = 'public.security_events'::regclass AND contype = 'c';
--    The event_type check must list SESSION_RELEASED and
--    DEVICE_RECLAIM_AFTER_BLOCK.
--
--    As a customer holding a live slot:
--      SELECT public.end_my_device_session('<their session uuid>');
--    then
--      SELECT ended_at, secure_flag_active FROM device_sessions
--       WHERE session_id = '<that uuid>';
--      -- ended_at set, secure_flag_active = false
--      SELECT event_type, metadata FROM security_events
--       WHERE session_id = '<that uuid>' ORDER BY created_at DESC LIMIT 1;
--      -- SESSION_RELEASED
--
--    Block a device, then re-claim it from the same fingerprint:
--      SELECT public.admin_revoke_device_session('<uuid>', 'testing');
--      SELECT public.claim_my_device_session('<same fingerprint>', 'WEB', 'x');
--      -- a new row, and a DEVICE_RECLAIM_AFTER_BLOCK event naming the old one
-- ============================================================

BEGIN;

-- ── 1. Two more things worth recording ────────────────────
--
-- The constraint was declared inline on the column, so Postgres named it;
-- finding it by predicate rather than by name keeps this safe on a project
-- where the generated name differs. Re-adding a superset of the old list
-- cannot invalidate existing rows.

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
    FROM pg_constraint
   WHERE conrelid = 'public.security_events'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%event_type%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.security_events DROP CONSTRAINT %I', v_conname
    );
  END IF;

  ALTER TABLE public.security_events
    ADD CONSTRAINT security_events_event_type_check
    CHECK (event_type IN (
      -- Browser deterrents (web reader)
      'SCREENSHOT_BLOCKED','RECORDING_DETECTED','COPY_BLOCKED',
      'PRINT_BLOCKED','CONTEXT_MENU_BLOCKED','SOURCE_VIEW_BLOCKED',
      'VISIBILITY_HIDDEN',
      -- Session and device administration (both clients)
      'SESSION_REVOKED','SESSION_RELEASED','DEVICE_LIMIT_EXCEEDED',
      'DEVICE_RECLAIM_AFTER_BLOCK',
      -- Native reader
      'DOWNLOAD_BLOCKED','SHARE_BLOCKED','MIRROR_DETECTED',
      'DEVICE_COMPROMISED','GRANT_REPLAY_BLOCKED','OFFLINE_EXPIRED'
    ));
END
$$;

-- ── 2. end_my_device_session: close it properly ───────────
--
-- `secure_flag_active` means "this device is running behind the protection
-- layer". A closed slot is not, and leaving the flag set is how a released
-- row came to look like a live, protected reader to anything that counts
-- them. The release is also logged now, with the releasing account recorded
-- in metadata - which is the only way to tell a reader's own disconnect from
-- somebody else freeing their slot from the dashboard.

CREATE OR REPLACE FUNCTION public.end_my_device_session(p_session_id uuid)
RETURNS public.device_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.device_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  UPDATE public.device_sessions
     SET ended_at           = NOW(),
         secure_flag_active = FALSE
   WHERE session_id = p_session_id
     AND user_id    = v_uid
     AND revoked = FALSE
     AND ended_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_open';
  END IF;

  INSERT INTO public.security_events (user_id, session_id, event_type, platform, metadata)
  VALUES (
    v_row.user_id,
    v_row.session_id,
    'SESSION_RELEASED',
    v_row.platform,
    jsonb_build_object(
      'released_by', v_uid::text,
      'own_row',     v_row.user_id = v_uid,
      'device_name', v_row.device_name
    )
  );

  RETURN v_row;
END;
$$;

-- ── 3. claim_my_device_session: re-claims leave a trace ───
--
-- The reuse lookup and the cap count both skip revoked rows, so a blocked
-- device never blocks its own fingerprint from coming back - that is the
-- documented intent, and it stays. What is added is the record: if this
-- fingerprint has been blocked on this account before, the new claim says so
-- and points at the row it followed.

CREATE OR REPLACE FUNCTION public.claim_my_device_session(
  p_device_fingerprint text,
  p_platform           text DEFAULT 'WEB',
  p_device_name        text DEFAULT NULL,
  p_device_model       text DEFAULT NULL,
  p_os_version         text DEFAULT NULL,
  p_app_version        text DEFAULT NULL
)
RETURNS public.device_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_fp       text := left(btrim(COALESCE(p_device_fingerprint, '')), 256);
  v_platform text := CASE
                       WHEN p_platform IN ('WEB','ANDROID','IOS') THEN p_platform
                       ELSE 'WEB'
                     END;
  v_limit    integer := public.device_limit(v_platform);
  v_idle     integer := public.device_idle_minutes(v_platform);
  v_existing public.device_sessions;
  v_blocked  public.device_sessions;
  v_open     integer;
  v_row      public.device_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF v_fp = '' THEN
    RAISE EXCEPTION 'validation_fingerprint';
  END IF;

  UPDATE public.device_sessions
     SET ended_at           = NOW(),
         secure_flag_active = FALSE
   WHERE user_id      = v_uid
     AND ended_at IS NULL
     AND revoked = FALSE
     AND last_seen_at < NOW() - make_interval(mins => v_idle);

  SELECT * INTO v_existing
    FROM public.device_sessions
   WHERE user_id            = v_uid
     AND device_fingerprint = v_fp
     AND ended_at IS NULL
     AND revoked = FALSE;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  SELECT count(*) INTO v_open
    FROM public.device_sessions
   WHERE user_id = v_uid
     AND ended_at IS NULL
     AND revoked = FALSE;

  IF v_open >= v_limit THEN
    INSERT INTO public.security_events (user_id, event_type, platform, metadata)
    VALUES (
      v_uid,
      'DEVICE_LIMIT_EXCEEDED',
      v_platform,
      jsonb_build_object(
        'open_sessions', v_open,
        'limit',         v_limit,
        'source',        'server'
      )
    );

    RAISE EXCEPTION 'device_limit_exceeded';
  END IF;

  -- Most recent block this fingerprint carried, if any. Read before the
  -- insert so the event can name the row it follows.
  SELECT * INTO v_blocked
    FROM public.device_sessions
   WHERE user_id            = v_uid
     AND device_fingerprint = v_fp
     AND revoked
   ORDER BY revoked_at DESC NULLS LAST
   LIMIT 1;

  INSERT INTO public.device_sessions (
    user_id,
    device_fingerprint,
    platform,
    device_name,
    device_model,
    os_version,
    app_version,
    device_integrity,
    secure_flag_active,
    started_at,
    last_seen_at,
    revoked
  ) VALUES (
    v_uid,
    v_fp,
    v_platform,
    left(NULLIF(btrim(COALESCE(p_device_name,  '')), ''), 160),
    left(NULLIF(btrim(COALESCE(p_device_model,  '')), ''), 120),
    left(NULLIF(btrim(COALESCE(p_os_version,    '')), ''),  60),
    left(NULLIF(btrim(COALESCE(p_app_version,   '')), ''),  40),
    'UNKNOWN',
    TRUE,
    NOW(),
    NOW(),
    FALSE
  )
  RETURNING * INTO v_row;

  IF v_blocked.session_id IS NOT NULL THEN
    INSERT INTO public.security_events (user_id, session_id, event_type, platform, metadata)
    VALUES (
      v_uid,
      v_row.session_id,
      'DEVICE_RECLAIM_AFTER_BLOCK',
      v_platform,
      jsonb_build_object(
        'previous_session_id', v_blocked.session_id::text,
        'blocked_at',          to_char(v_blocked.revoked_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'blocked_by',          v_blocked.revoked_by::text,
        'reason',              v_blocked.revoke_reason
      )
    );
  END IF;

  RETURN v_row;
END;
$$;

-- ── VERIFY ─────────────────────────────────────────────────
--
-- 1. The constraint listing above.
--
-- 2. Release: see the header. `secure_flag_active` must be false and a
--    SESSION_RELEASED event must exist for that session_id.
--
-- 3. Re-claim trace: block a device, then claim again from the same
--    fingerprint as that customer. Expect a new live row AND a
--    DEVICE_RECLAIM_AFTER_BLOCK event whose metadata points at the blocked
--    session. Claiming a fingerprint that was never blocked must produce no
--    such event - otherwise the log says nothing.
--
-- 4. The limit still refuses a third live device, and still does not evict
--    one: nothing in this migration changes the refusal.

COMMIT;
