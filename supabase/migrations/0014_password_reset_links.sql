-- 0014 — password_reset_links: server-side seal for admin-minted recovery links.
--
-- WHY THIS TABLE EXISTS
--
-- `admin-password-reset` mints a real Supabase recovery link through
-- `auth.admin.generateLink` (service_role only). That link is a live
-- credential on the Supabase project domain — exposing it in the admin UI or
-- in an email leaks infrastructure and leaves the raw recovery token sitting
-- in inboxes and chat history. Instead the link is sealed here, behind a
-- random 128-bit id, and the admin UI only ever sees
-- https://casanova-books.com/reset-password?r=<id>. `redeem-password-reset`
-- is the only reader: it swaps the id for the sealed link inside the
-- customer's browser and deletes the row in the same request, making every
-- seal strictly single-use.
--
-- ACCESS MODEL
--
-- The table deliberately lives in `public` (so the service_role functions
-- reach it through the normal REST path) but with RLS enabled and **no**
-- policies at all: the anon/authenticated keys can neither read nor write
-- it, and only the service role — used exclusively inside the two Edge
-- Functions — touches it. The raw recovery token never leaves the trusted
-- runtime.

CREATE TABLE IF NOT EXISTS password_reset_links (
  -- The redeemable secret: a full crypto.randomUUID with the dashes
  -- stripped — 128 bits of entropy, unguessable and un enumerable.
  id           UUID         PRIMARY KEY,
  -- The sealed Supabase action link. Readable only by the service role.
  action_link  TEXT         NOT NULL,
  -- Hard lifetime, enforced again at redeem time. 10 minutes by design;
  -- see LINK_TTL_SECONDS in supabase/functions/admin-password-reset.
  expires_at   TIMESTAMPTZ  NOT NULL,
  -- Set inside the same transaction that returns the link, so a race
  -- between two redeem attempts deletes the row exactly once.
  redeemed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Redeem looks up by id; the periodic sweep (below) prunes by expiry.
CREATE INDEX idx_prl_expires ON password_reset_links (expires_at);

ALTER TABLE password_reset_links ENABLE ROW LEVEL SECURITY;

-- No policies: nothing is writable or readable through anon/authenticated.
-- Service role bypasses RLS, which is exactly the single intended path.

-- Housekeeping: rows whose seal has expired are dead weight. The redeem
-- function opportunistically deletes the row it consumed; this event trigger
-- removes stale rows so the table cannot grow without bound.
CREATE OR REPLACE FUNCTION prl_sweep() RETURNS trigger AS $$
BEGIN
  DELETE FROM password_reset_links WHERE expires_at < NOW();
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER prl_sweep_trigger
AFTER INSERT ON password_reset_links
FOR EACH ROW EXECUTE FUNCTION prl_sweep();
