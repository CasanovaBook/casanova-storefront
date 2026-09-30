-- ============================================================
-- 0017 — Realtime delivery for user_products
--
-- WHY
--
-- Suspending (חסימה) or revoking an entitlement updated the server row
-- immediately, but a customer already inside the Reader learned about it
-- only when the client's revalidation beat happened to refetch — up to
-- 30 s later, and only while the revalidation loop was running. The
-- client now subscribes to Supabase Realtime on public.user_products
-- (scoped to its own rows) so an access change is mirrored in the
-- browser within seconds of the admin click.
--
-- HOW REALTIME DELIVERY WORKS HERE
--
-- Supabase Realtime broadcasts postgres_changes events only to
-- subscribers whose JWT passes the table's Row Level Security, exactly
-- as a SELECT would. The existing policy on public.user_products —
-- "a customer may read their own rows" — is therefore the entire
-- authorization story: a blocked user receives events about their own
-- (now blocked) row, which is precisely what the client needs to see,
-- and never about anyone else's.
--
-- The REPLICA IDENTITY requirement is the reason for the DEFAULT
-- setting below: UPDATE and DELETE events carry only the primary key
-- of the old row unless the table's replica identity includes the
-- changed columns. DEFAULT (the primary key) is enough for this
-- client, which refetches its own rows on every event rather than
-- trusting the event payload.
--
-- APPLY, THEN VERIFY
--
--    SELECT pubname, schemaname, tablename
--      FROM pg_publication_tables
--     WHERE tablename = 'user_products';
--
--    Expect one row: supabase_realtime | public | user_products.
--
--    Then, from an authenticated browser session holding a valid JWT
--    for user A, confirm events for user B's rows do NOT arrive
--    (RLS filtering) while a change to user A's own row does.
-- ============================================================

-- Idempotent: adding an already-present table to a publication is an
-- error only in older Postgres versions; the DO block keeps re-running
-- the migration safe on any of them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname  = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'user_products'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_products;
  END IF;
END
$$;

-- DEFAULT replica identity (the primary key) is what the client's
-- refetch-on-event design expects; setting it explicitly documents the
-- requirement and guards against a future ALTER that would change it.
ALTER TABLE public.user_products REPLICA IDENTITY DEFAULT;

-- ── VERIFY ───────────────────────────────────────────────────
--
-- 1. The publication membership from the query in the header comment.
--
-- 2. The client subscription: with the app open on the Reader, run
--    UPDATE public.user_products SET access_status = 'SUSPENDED'
--     WHERE user_product_id = '<open entitlement>';
--    as an admin (through admin_set_access_status, not a raw UPDATE —
--    the trigger trg_user_product_revokes_grants must still cascade).
--    The open Reader should drop its content within seconds, without a
--    browser refresh.
