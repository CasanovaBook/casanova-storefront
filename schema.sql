-- ============================================================
-- Casanova — Digital E-Book Commerce Platform
-- PostgreSQL schema
-- ============================================================
--
-- DDL ONLY. This file intentionally contains no seed or demo rows:
-- no users, no products, no orders, no revenue, no reviews. A fresh
-- database created from this script is empty, and the application is
-- expected to render proper empty states until a real administrator
-- creates real content through the CMS.
--
-- The single exception is one `platform_settings` row, which is
-- configuration rather than content — every value in it is a neutral
-- empty default. See the note above that table.
--
-- MODELLING RULES
--   1. Relationships are expressed with IDs and foreign keys. A whole
--      object is never embedded inside another table.
--   2. Purchase-time history is preserved with explicit, bounded
--      snapshots (order_items.product_name / unit_price, the coupon
--      code on an order). Editing, archiving or deleting a product can
--      therefore never rewrite what a customer actually paid.
--   3. Totals that can be recomputed from source transactions are NOT
--      stored. Revenue, refunds per order and product sales figures
--      are derived in the views at the bottom of this file.
--   4. Nothing is allowed to claim money moved without provider
--      confirmation — enforced by CHECK constraints and a trigger on
--      `refunds`, not by application convention alone.
--
-- CLIENT ID MAPPING
--   The browser-side store currently issues prefixed string ids
--   (`prd_…`, `ord_…`). Every primary key below is a UUID; the prefix
--   convention maps 1:1 onto these tables and carries no meaning in
--   the database.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- PLATFORM SETTINGS — singleton configuration row
-- ============================================================
-- Everything that would normally live in server environment variables
-- is managed from the CMS so the business can change it without a
-- developer. `payment_provider` and `email_provider` stay NULL until
-- real credentials are configured; the application must surface that
-- honestly rather than pretending charges or deliveries happened.
--
-- The CHECK below is the database-level guarantee behind the refund
-- rule: refund execution cannot be switched on while no payment
-- gateway is connected.
-- ============================================================
CREATE TABLE platform_settings (
  settings_id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name               VARCHAR(160) NOT NULL DEFAULT '',
  default_currency         VARCHAR(3)   NOT NULL DEFAULT 'ILS',
  invoice_prefix           VARCHAR(20)  NOT NULL DEFAULT 'INV',
  order_prefix             VARCHAR(20)  NOT NULL DEFAULT 'ORD',
  inquiry_prefix           VARCHAR(20)  NOT NULL DEFAULT 'INQ',
  payment_provider         VARCHAR(100),                  -- NULL until a gateway is connected
  email_provider           VARCHAR(100),                  -- NULL until a mail service is connected
  refund_execution_enabled BOOLEAN      NOT NULL DEFAULT FALSE,
  max_upload_bytes         BIGINT       NOT NULL DEFAULT 10485760 CHECK (max_upload_bytes > 0),

  -- Mobile client controls. The React Native reader authenticates
  -- against this same database, so taking the app out of service or
  -- forcing an upgrade is a settings edit rather than a store release.
  -- A build older than mobile_min_build is refused before it can read
  -- anything, which is what makes one schema safe to serve two clients
  -- at different release cadences.
  mobile_app_enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
  mobile_min_build         INTEGER      NOT NULL DEFAULT 0 CHECK (mobile_min_build >= 0),

  -- Site copy: every string a visitor reads on the landing page as
  -- *content* rather than as application chrome. All nullable and all
  -- left unset by the seed row below, so a fresh install carries no
  -- marketing copy whatsoever and no claim about the business can reach
  -- a customer before an editor writes it. Where one is NULL the UI
  -- renders nothing in that slot; it never substitutes a placeholder.
  -- An editor clearing a field writes an empty string, which is equally
  -- falsy, hence no CHECK rejecting '' here.
  tagline                  TEXT,        -- short brand line above the hero headline
  trust_badges             TEXT[]       NOT NULL DEFAULT '{}',  -- assurance bullets; empty renders no row
  catalogue_title          TEXT,        -- heading of the catalogue block
  catalogue_blurb          TEXT,        -- intro under that heading
  pricing_title            TEXT,        -- heading of the bundle/subscription block
  pricing_blurb            TEXT,        -- intro under that heading
  footer_text              TEXT,        -- optional closing line above the copyright

  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by               UUID,                          -- FK added after `users` exists
  is_singleton             BOOLEAN      NOT NULL DEFAULT TRUE UNIQUE CHECK (is_singleton = TRUE),
  CONSTRAINT chk_refunds_require_provider
    CHECK (refund_execution_enabled = FALSE OR payment_provider IS NOT NULL)
);

-- ============================================================
-- CONTENT ASSETS — managed file storage references
-- ============================================================
-- Covers, PDFs and any other uploaded binary. Products point at an
-- asset by id; the asset row is where size, mime type, checksum and
-- version live.
-- ============================================================
CREATE TABLE content_assets (
  asset_id        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name       VARCHAR(255)  NOT NULL,
  storage_key     VARCHAR(500)  NOT NULL,   -- object-storage path
  public_url      VARCHAR(1000),            -- CDN URL once published
  file_size_bytes BIGINT        NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
  mime_type       VARCHAR(100),
  total_pages     INTEGER       CHECK (total_pages IS NULL OR total_pages > 0),
  checksum        VARCHAR(64),
  version         INTEGER       NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_assets_mime ON content_assets (mime_type);

-- ============================================================
-- USERS — customers and CMS/admin accounts in one table
-- ============================================================
-- Credential columns (password_hash, password_salt) must never be
-- selected into an API response. `role` decides customer vs staff;
-- `admin_role` narrows what a staff member may do and is only
-- meaningful when role = 'ADMIN'.
-- ============================================================
CREATE TABLE users (
  user_id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name           VARCHAR(100) NOT NULL,
  last_name            VARCHAR(100) NOT NULL,
  email                VARCHAR(255) NOT NULL,
  phone                VARCHAR(50),
  password_hash        VARCHAR(255),        -- NULL until the owner sets one (purchase-created accounts)
  password_salt        VARCHAR(64),
  password_set         BOOLEAN      NOT NULL DEFAULT TRUE,
  role                 VARCHAR(50)  NOT NULL DEFAULT 'CUSTOMER'
                         CHECK (role IN ('CUSTOMER', 'ADMIN', 'MODERATOR')),
  admin_role           VARCHAR(50)
                         CHECK (admin_role IS NULL OR admin_role IN
                           ('SUPER_ADMIN', 'SUPPORT', 'FINANCE', 'CONTENT', 'MARKETING')),
  account_status       VARCHAR(50)  NOT NULL DEFAULT 'ACTIVE'
                         CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  must_change_password BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login_at        TIMESTAMPTZ,
  -- Also stamped by reading activity, throttled to the minute. It is an
  -- admin-facing "last seen", so re-writing it on every page turn would
  -- churn the row for no benefit; see saveReadingProgress() in
  -- src/lib/api-support.ts, which applies the same rule client-side.
  last_activity_at     TIMESTAMPTZ,
  CONSTRAINT chk_admin_role_only_for_admins
    CHECK (admin_role IS NULL OR role IN ('ADMIN', 'MODERATOR'))
);

CREATE UNIQUE INDEX idx_users_email ON users (LOWER(email));
CREATE INDEX        idx_users_role   ON users (role);
CREATE INDEX        idx_users_status ON users (account_status);

ALTER TABLE platform_settings
  ADD CONSTRAINT fk_settings_updated_by
  FOREIGN KEY (updated_by) REFERENCES users (user_id) ON DELETE SET NULL;

-- ============================================================
-- PASSWORD RESET TOKENS — one-time setup or reset links
-- ============================================================
-- Only the digest is stored, so a leaked database cannot be used to
-- sign in. A token is burned by setting used_at.
-- ============================================================
CREATE TABLE password_reset_tokens (
  token_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  purpose    VARCHAR(50)  NOT NULL DEFAULT 'RESET'
               CHECK (purpose IN ('RESET', 'SETUP')),
  expires_at TIMESTAMPTZ  NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prt_user_id     ON password_reset_tokens (user_id);
CREATE INDEX idx_prt_unused_hash ON password_reset_tokens (token_hash) WHERE used_at IS NULL;

-- ============================================================
-- SESSIONS — server-side session tracking
-- ============================================================
CREATE TABLE sessions (
  session_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  token_hash     VARCHAR(255) NOT NULL,
  -- Which client holds the token. Both apps authenticate here, so a
  -- stolen-token report has to be able to say whether the browser or the
  -- phone was involved, and "sign out everywhere except this device"
  -- needs something to filter on.
  client         VARCHAR(20) NOT NULL DEFAULT 'WEB'
                   CHECK (client IN ('WEB','ANDROID','IOS')),
  app_version    VARCHAR(40),
  ip_address     INET,
  user_agent     TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at     TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user_id    ON sessions (user_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX idx_sessions_client     ON sessions (user_id, client);

-- ============================================================
-- CATEGORIES
-- ============================================================
CREATE TABLE categories (
  category_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(160) NOT NULL,
  slug          VARCHAR(200) UNIQUE NOT NULL,
  description   TEXT,
  display_order INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_categories_order ON categories (display_order);

-- ============================================================
-- PRODUCTS — the general catalog entity
-- ============================================================
-- Books, bundles, subscriptions, courses and physical goods all live
-- here. Book-specific metadata sits in the 1:1 `books` extension
-- table so non-book products are not covered in NULL columns.
--
-- `price` is the regular price and `sale_price` the promotional one;
-- when sale_price is set and lower, the product is on sale. The CHECK
-- makes an inverted or pointless sale price impossible.
--
-- `visibility` controls catalog exposure independently of `status`:
--   PUBLIC   — listed everywhere
--   UNLISTED — reachable only by direct link
--   HIDDEN   — staff only
-- `inventory` NULL means unlimited, which is the normal case for
-- digital goods.
-- ============================================================
CREATE TABLE products (
  product_id        UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(255)   NOT NULL,
  subtitle          VARCHAR(255),
  slug              VARCHAR(255)   UNIQUE NOT NULL,
  sku               VARCHAR(50)    UNIQUE,
  description       TEXT           NOT NULL DEFAULT '',
  short_description VARCHAR(500)   NOT NULL DEFAULT '',
  product_type      VARCHAR(50)    NOT NULL
                      CHECK (product_type IN (
                        'EBOOK', 'SUBSCRIPTION', 'DIGITAL_PRODUCT',
                        'PHYSICAL_PRODUCT', 'BUNDLE', 'COURSE', 'PREMIUM_ACCESS'
                      )),
  price             NUMERIC(10,2)  NOT NULL CHECK (price >= 0),
  sale_price        NUMERIC(10,2)  CHECK (sale_price IS NULL OR (sale_price >= 0 AND sale_price < price)),
  currency          VARCHAR(3)     NOT NULL DEFAULT 'ILS',
  image_url         VARCHAR(1000),                 -- cover; additional shots live in product_images
  cover_colors      JSONB          NOT NULL DEFAULT '["#111827","#374151"]',  -- [from,to] gradient fallback
  content_asset_id  UUID           REFERENCES content_assets (asset_id) ON DELETE SET NULL,
  content_url       VARCHAR(1000),                 -- resolved URL the reader loads
  rating            NUMERIC(3,2)   CHECK (rating IS NULL OR rating BETWEEN 0 AND 5),
  reviews_count     INTEGER        NOT NULL DEFAULT 0 CHECK (reviews_count >= 0),
  tags              TEXT[]         NOT NULL DEFAULT '{}',
  metadata          JSONB          NOT NULL DEFAULT '{}',
  seo_title         VARCHAR(180),
  seo_description   VARCHAR(320),
  seo_keywords      VARCHAR(320),
  status            VARCHAR(50)    NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('ACTIVE', 'INACTIVE', 'DRAFT', 'ARCHIVED')),
  visibility        VARCHAR(20)    NOT NULL DEFAULT 'PUBLIC'
                      CHECK (visibility IN ('PUBLIC', 'UNLISTED', 'HIDDEN')),
  availability      VARCHAR(20)    NOT NULL DEFAULT 'AVAILABLE'
                      CHECK (availability IN ('AVAILABLE', 'OUT_OF_STOCK', 'PREORDER')),
  inventory         INTEGER        CHECK (inventory IS NULL OR inventory >= 0),
  featured          BOOLEAN        NOT NULL DEFAULT FALSE,
  position          INTEGER        NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  archived_at       TIMESTAMPTZ
);

CREATE INDEX idx_products_status     ON products (status);
CREATE INDEX idx_products_type       ON products (product_type);
CREATE INDEX idx_products_featured   ON products (featured) WHERE featured;
CREATE INDEX idx_products_catalog    ON products (position, created_at DESC);
-- Storefront catalog query: published, publicly listed, in stock.
CREATE INDEX idx_products_storefront ON products (status, visibility, availability)
  WHERE status = 'ACTIVE' AND visibility = 'PUBLIC';

-- ============================================================
-- BOOKS — 1:1 metadata extension for EBOOK products
-- ============================================================
CREATE TABLE books (
  product_id       UUID         PRIMARY KEY REFERENCES products (product_id) ON DELETE CASCADE,
  author_name      VARCHAR(255),
  isbn             VARCHAR(32),
  publisher        VARCHAR(255),
  language         VARCHAR(20),
  publication_date DATE,
  total_pages      INTEGER      CHECK (total_pages IS NULL OR total_pages > 0)
);

CREATE UNIQUE INDEX idx_books_isbn ON books (isbn) WHERE isbn IS NOT NULL;

-- A row here is only meaningful for an EBOOK product.
CREATE OR REPLACE FUNCTION assert_book_product_is_ebook()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  ptype VARCHAR(50);
BEGIN
  SELECT product_type INTO ptype FROM products WHERE product_id = NEW.product_id;
  IF ptype IS DISTINCT FROM 'EBOOK' THEN
    RAISE EXCEPTION 'books row % references a % product', NEW.product_id, COALESCE(ptype, 'missing');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_books_is_ebook
  BEFORE INSERT OR UPDATE OF product_id ON books
  FOR EACH ROW EXECUTE FUNCTION assert_book_product_is_ebook();

-- ============================================================
-- PRODUCT_CATEGORIES — many-to-many
-- ============================================================
CREATE TABLE product_categories (
  product_id  UUID NOT NULL REFERENCES products   (product_id)  ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories (category_id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);

CREATE INDEX idx_product_categories_category ON product_categories (category_id);

-- ============================================================
-- PRODUCT_IMAGES — gallery beyond the cover
-- ============================================================
-- The cover itself is products.image_url; this table holds the extra
-- shots. Each row points at either an uploaded asset or an external
-- URL.
-- ============================================================
CREATE TABLE product_images (
  image_id   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID          NOT NULL REFERENCES products (product_id) ON DELETE CASCADE,
  asset_id   UUID          REFERENCES content_assets (asset_id) ON DELETE SET NULL,
  image_url  VARCHAR(1000),
  alt_text   VARCHAR(255),
  sort_order INTEGER       NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_product_image_source CHECK (asset_id IS NOT NULL OR image_url IS NOT NULL)
);

CREATE INDEX idx_product_images_product ON product_images (product_id, sort_order);

-- ============================================================
-- PRODUCT_MEDIA_LINKS — external live-view links
-- ============================================================
CREATE TABLE product_media_links (
  media_link_id UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID         NOT NULL REFERENCES products (product_id) ON DELETE CASCADE,
  label         VARCHAR(160) NOT NULL,
  url           VARCHAR(1000) NOT NULL,
  platform      VARCHAR(20)  NOT NULL DEFAULT 'WEB'
                  CHECK (platform IN ('YOUTUBE', 'VIMEO', 'WEB')),
  sort_order    INTEGER      NOT NULL DEFAULT 0
);

CREATE INDEX idx_product_media_links_product ON product_media_links (product_id, sort_order);

-- ============================================================
-- PRODUCT_RELATIONS — bundles, related, upsells, cross-sells
-- ============================================================
-- One directed edge table replaces four parallel arrays. The source
-- product owns the relation; `relation_type` says what it means.
-- Self-references are rejected, and the pair+type combination is
-- unique so the CMS cannot store the same edge twice.
-- ============================================================
CREATE TABLE product_relations (
  relation_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_product_id UUID        NOT NULL REFERENCES products (product_id) ON DELETE CASCADE,
  target_product_id UUID        NOT NULL REFERENCES products (product_id) ON DELETE CASCADE,
  relation_type     VARCHAR(20) NOT NULL
                      CHECK (relation_type IN ('BUNDLE_ITEM', 'RELATED', 'UPSELL', 'CROSS_SELL')),
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  CONSTRAINT chk_product_relation_not_self CHECK (source_product_id <> target_product_id),
  UNIQUE (source_product_id, target_product_id, relation_type)
);

CREATE INDEX idx_product_relations_source ON product_relations (source_product_id, relation_type);
CREATE INDEX idx_product_relations_target ON product_relations (target_product_id, relation_type);

-- ============================================================
-- CMS SECTIONS — storefront content blocks
-- ============================================================
-- HERO, TESTIMONIALS, FAQ and CTA each own one fixed slot on the landing
-- page. TEXT, VIDEO, GALLERY and PRODUCTS are free-form: any number of them
-- can exist and they are rendered as a stream in display_order, which is how
-- an editor composes the middle of the page without a code change
-- (src/pages/LandingPage.tsx).
CREATE TABLE cms_sections (
  section_id    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  type          VARCHAR(50)  NOT NULL
                  CHECK (type IN ('HERO','TEXT','VIDEO','GALLERY','PRODUCTS',
                                  'TESTIMONIALS','FAQ','CTA')),
  title         VARCHAR(255) NOT NULL,
  content       TEXT         NOT NULL DEFAULT '',
  -- One asset: an embeddable video link, or a single hero/CTA image.
  media_url     VARCHAR(1000),
  -- Ordered image list for GALLERY rows. Kept in its own column rather than
  -- sharing media_url so a video section and a gallery never compete for the
  -- same field and a gallery can hold any number of assets in a fixed order.
  -- Blank entries are filtered out by the editor before saving, so only the
  -- shape is constrained here: a CHECK expression may not contain a
  -- subquery, which is what rejecting empty strings would require.
  media_urls    JSONB
                  CHECK (media_urls IS NULL OR jsonb_typeof(media_urls) = 'array'),
  active        BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cms_sections_order ON cms_sections (active, display_order);

-- ============================================================
-- TESTIMONIALS — CMS-managed, never hardcoded
-- ============================================================
CREATE TABLE testimonials (
  testimonial_id UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  quote          TEXT         NOT NULL,
  name           VARCHAR(120) NOT NULL,
  title          VARCHAR(160),
  avatar         VARCHAR(10),
  active         BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order  INTEGER      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_testimonials_active_order ON testimonials (active, display_order);

-- ============================================================
-- FAQS — CMS-managed
-- ============================================================
CREATE TABLE faqs (
  faq_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question      TEXT        NOT NULL,
  answer        TEXT        NOT NULL,
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  display_order INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_faqs_active_order ON faqs (active, display_order);

-- ============================================================
-- COUPONS
-- ============================================================
CREATE TABLE coupons (
  coupon_id      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(100)  UNIQUE NOT NULL,
  discount_type  VARCHAR(20)   NOT NULL
                   CHECK (discount_type IN ('PERCENTAGE', 'FIXED_AMOUNT')),
  discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  minimum_order  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (minimum_order >= 0),
  max_discount   NUMERIC(10,2) CHECK (max_discount IS NULL OR max_discount > 0),
  starts_at      TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  usage_limit    INTEGER       CHECK (usage_limit IS NULL OR usage_limit > 0),
  times_used     INTEGER       NOT NULL DEFAULT 0 CHECK (times_used >= 0),
  status         VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'INACTIVE', 'EXPIRED')),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_coupon_percentage_range
    CHECK (discount_type <> 'PERCENTAGE' OR (discount_value > 0 AND discount_value <= 100)),
  CONSTRAINT chk_coupon_window
    CHECK (starts_at IS NULL OR expires_at IS NULL OR starts_at < expires_at)
);

-- ============================================================
-- ORDERS
-- ============================================================
-- Stores only authoritative order facts. Provider details live on the
-- `payments` row that settled the charge, and refund figures are
-- derived from `refunds` — see v_orders. Nothing here duplicates a
-- total that can be recomputed from a source transaction.
--
-- `coupon_code` is a deliberate purchase-time snapshot: a coupon may
-- later be deleted, but the discount applied to this order must stay
-- explainable forever.
-- ============================================================
CREATE TABLE orders (
  order_id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        VARCHAR(40)   UNIQUE NOT NULL,   -- customer-facing, e.g. CNV-2026-0001
  user_id             UUID          NOT NULL REFERENCES users (user_id),
  order_status        VARCHAR(50)   NOT NULL DEFAULT 'PENDING'
                        CHECK (order_status IN ('PENDING','PAID','CANCELLED','REFUNDED','FAILED')),
  payment_status      VARCHAR(50)   NOT NULL DEFAULT 'PENDING'
                        CHECK (payment_status IN
                          ('PENDING','PAID','FAILED','PARTIALLY_REFUNDED','REFUNDED','CANCELLED')),
  subtotal            NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
  discount_amount     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount        NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  currency            VARCHAR(3)    NOT NULL DEFAULT 'ILS',
  coupon_id           UUID          REFERENCES coupons (coupon_id) ON DELETE SET NULL,
  coupon_code         VARCHAR(100),
  idempotency_key     VARCHAR(255)  UNIQUE,            -- prevents duplicate webhook processing
  customer_first_name VARCHAR(100)  NOT NULL,
  customer_last_name  VARCHAR(100)  NOT NULL,
  customer_email      VARCHAR(255)  NOT NULL,
  customer_phone      VARCHAR(50),
  billing_address     JSONB,
  notes               TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  paid_at             TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_order_discount_within_subtotal CHECK (discount_amount <= subtotal),
  CONSTRAINT chk_order_total_arithmetic         CHECK (total_amount = subtotal - discount_amount)
);

CREATE INDEX idx_orders_user_id        ON orders (user_id);
CREATE INDEX idx_orders_payment_status ON orders (payment_status);
CREATE INDEX idx_orders_order_status   ON orders (order_status);
CREATE INDEX idx_orders_created_at     ON orders (created_at DESC);
CREATE INDEX idx_orders_paid_at        ON orders (paid_at DESC) WHERE paid_at IS NOT NULL;
CREATE INDEX idx_orders_customer_email ON orders (LOWER(customer_email));

-- ============================================================
-- ORDER ITEMS — purchase-time snapshot per line
-- ============================================================
-- product_name, unit_price and discount_amount are frozen at checkout.
-- product_id stays for analytics and navigation, but no report may
-- join to `products` to price history: the numbers below are the
-- contract with the customer.
--
-- product_id is ON DELETE RESTRICT: a product that has been sold can
-- be archived but never removed, mirroring the service layer which
-- refuses the delete and answers CONFLICT. The snapshot columns stay
-- authoritative for every report, so historical revenue never depends
-- on the current product row or its current price.
-- ============================================================
CREATE TABLE order_items (
  order_item_id   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID          NOT NULL REFERENCES orders (order_id) ON DELETE CASCADE,
  product_id      UUID          NOT NULL REFERENCES products (product_id) ON DELETE RESTRICT,
  product_name    VARCHAR(255)  NOT NULL,
  product_slug    VARCHAR(255),
  quantity        INTEGER       NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  line_total      NUMERIC(10,2) NOT NULL CHECK (line_total >= 0),
  CONSTRAINT chk_order_item_arithmetic
    CHECK (line_total = (unit_price * quantity) - discount_amount)
);

CREATE INDEX idx_order_items_order_id   ON order_items (order_id);
CREATE INDEX idx_order_items_product_id ON order_items (product_id);

-- ============================================================
-- PAYMENTS — one row per charge attempt
-- ============================================================
-- The single source of truth for who the money went through, the
-- provider transaction reference and the card's last four digits.
-- Retries produce additional rows; the order's settled payment is the
-- CAPTURED one.
-- ============================================================
CREATE TABLE payments (
  payment_id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID          NOT NULL REFERENCES orders (order_id) ON DELETE CASCADE,
  provider              VARCHAR(100)  NOT NULL,
  status                VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','AUTHORIZED','CAPTURED','FAILED','CANCELLED')),
  amount                NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency              VARCHAR(3)    NOT NULL DEFAULT 'ILS',
  transaction_reference VARCHAR(255),
  card_last4            VARCHAR(4)    CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  failure_reason        TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  captured_at           TIMESTAMPTZ,
  CONSTRAINT chk_payment_captured_has_reference
    CHECK (status <> 'CAPTURED' OR transaction_reference IS NOT NULL)
);

CREATE INDEX idx_payments_order   ON payments (order_id, created_at DESC);
CREATE INDEX idx_payments_status  ON payments (status);
CREATE INDEX idx_payments_capture ON payments (order_id) WHERE status = 'CAPTURED';

-- ============================================================
-- REFUNDS — request, review and execution lifecycle
-- ============================================================
-- REQUESTED -> PENDING -> APPROVED | REJECTED
--                     -> PROCESSING -> REFUNDED | FAILED
--
-- A row may only reach REFUNDED when the provider returned a refund
-- id, which is what stops the system from claiming money moved that
-- never did. The trigger below additionally caps the cumulative
-- refunded amount at the order total.
-- ============================================================
CREATE TABLE refunds (
  refund_id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID          NOT NULL REFERENCES orders (order_id) ON DELETE RESTRICT,
  payment_id         UUID          REFERENCES payments (payment_id) ON DELETE SET NULL,
  original_amount    NUMERIC(10,2) NOT NULL CHECK (original_amount >= 0),
  amount             NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency           VARCHAR(3)    NOT NULL DEFAULT 'ILS',
  reason             TEXT          NOT NULL,
  status             VARCHAR(20)   NOT NULL DEFAULT 'REQUESTED'
                       CHECK (status IN
                         ('REQUESTED','PENDING','APPROVED','REJECTED','PROCESSING','REFUNDED','FAILED')),
  provider           VARCHAR(100),
  provider_refund_id VARCHAR(255),
  requested_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  reviewed_at        TIMESTAMPTZ,
  reviewed_by        UUID          REFERENCES users (user_id) ON DELETE SET NULL,
  review_note        TEXT,
  processed_at       TIMESTAMPTZ,
  failure_reason     TEXT,
  initiated_by_id    UUID          NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
  CONSTRAINT chk_refund_needs_provider_confirmation
    CHECK (status <> 'REFUNDED' OR provider_refund_id IS NOT NULL),
  CONSTRAINT chk_refund_within_original
    CHECK (amount <= original_amount),
  CONSTRAINT chk_refund_processed_timestamp
    CHECK (status <> 'REFUNDED' OR processed_at IS NOT NULL)
);

CREATE INDEX idx_refunds_order  ON refunds (order_id);
CREATE INDEX idx_refunds_status ON refunds (status);

-- Cumulative refunds on an order may never exceed what was charged.
CREATE OR REPLACE FUNCTION assert_refund_within_order_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  order_total NUMERIC(10,2);
  already     NUMERIC(10,2);
BEGIN
  IF NEW.status NOT IN ('REFUNDED', 'PROCESSING', 'APPROVED') THEN
    RETURN NEW;
  END IF;

  SELECT total_amount INTO order_total FROM orders WHERE order_id = NEW.order_id;
  IF order_total IS NULL THEN
    RAISE EXCEPTION 'refund % references a missing order', NEW.refund_id;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO already
  FROM refunds
  WHERE order_id = NEW.order_id
    AND refund_id <> NEW.refund_id
    AND status IN ('APPROVED', 'PROCESSING', 'REFUNDED');

  IF already + NEW.amount > order_total THEN
    RAISE EXCEPTION 'refunding % would exceed the order total of %', already + NEW.amount, order_total;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_refund_within_order_total
  BEFORE INSERT OR UPDATE OF amount, status ON refunds
  FOR EACH ROW EXECUTE FUNCTION assert_refund_within_order_total();

-- ============================================================
-- INVOICES / RECEIPTS
-- ============================================================
CREATE TABLE invoices (
  invoice_id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID          NOT NULL REFERENCES orders (order_id) ON DELETE RESTRICT,
  invoice_number      VARCHAR(100)  UNIQUE NOT NULL,
  receipt_number      VARCHAR(100),
  amount              NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  currency            VARCHAR(3)    NOT NULL DEFAULT 'ILS',
  issued_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  status              VARCHAR(50)   NOT NULL DEFAULT 'ISSUED'
                        CHECK (status IN ('ISSUED','VOID','REFUNDED')),
  pdf_asset_id        UUID          REFERENCES content_assets (asset_id) ON DELETE SET NULL,
  provider_reference  VARCHAR(255)
);

CREATE UNIQUE INDEX idx_invoices_order_id ON invoices (order_id);

-- ============================================================
-- COUPON USAGE — one redemption per coupon per order
-- ============================================================
CREATE TABLE coupon_usage (
  usage_id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id        UUID          NOT NULL REFERENCES coupons (coupon_id) ON DELETE RESTRICT,
  order_id         UUID          NOT NULL REFERENCES orders (order_id) ON DELETE CASCADE,
  user_id          UUID          NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  discount_applied NUMERIC(10,2) NOT NULL CHECK (discount_applied >= 0),
  used_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (coupon_id, order_id)
);

CREATE INDEX idx_coupon_usage_user ON coupon_usage (user_id);

-- ============================================================
-- USER_PRODUCTS — entitlements, the access-control source of truth
-- ============================================================
-- Before serving protected content, check this table. `product_snapshot`
-- is a bounded copy of the display fields captured at grant time, so
-- the library keeps rendering correctly after a product is renamed,
-- archived or deleted. It is a snapshot, never a live product copy.
-- `product_id` is ON DELETE RESTRICT for the same reason: an
-- entitlement that a customer paid for cannot be silently destroyed by
-- a catalog cleanup. Archive the product instead.
-- ============================================================
CREATE TABLE user_products (
  user_product_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  product_id       UUID        NOT NULL REFERENCES products (product_id) ON DELETE RESTRICT,
  product_snapshot JSONB       NOT NULL DEFAULT '{}',
  source_order_id  UUID        REFERENCES orders (order_id) ON DELETE SET NULL,
  access_status    VARCHAR(50) NOT NULL DEFAULT 'ACTIVE'
                     CHECK (access_status IN ('ACTIVE','EXPIRED','REVOKED','SUSPENDED')),
  granted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ,                  -- NULL = perpetual
  granted_by       UUID        REFERENCES users (user_id) ON DELETE SET NULL,
  revoked_by       UUID        REFERENCES users (user_id) ON DELETE SET NULL,
  revoked_at       TIMESTAMPTZ,
  revoke_reason    TEXT,
  UNIQUE (user_id, product_id),
  CONSTRAINT chk_user_product_revocation
    CHECK (access_status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);

CREATE INDEX idx_user_products_user    ON user_products (user_id);
CREATE INDEX idx_user_products_product ON user_products (product_id);
CREATE INDEX idx_user_products_active  ON user_products (user_id) WHERE access_status = 'ACTIVE';

-- ============================================================
-- READING PROGRESS
-- ============================================================
CREATE TABLE reading_progress (
  progress_id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  product_id       UUID         NOT NULL REFERENCES products (product_id) ON DELETE CASCADE,
  current_page     INTEGER      NOT NULL DEFAULT 1 CHECK (current_page >= 1),
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  bookmarks        JSONB        NOT NULL DEFAULT '[]',
  last_read_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id)
);

CREATE INDEX idx_reading_progress_user ON reading_progress (user_id, last_read_at DESC);

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
CREATE TABLE subscriptions (
  subscription_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  product_id               UUID        NOT NULL REFERENCES products (product_id) ON DELETE RESTRICT,
  status                   VARCHAR(50) NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','PAST_DUE','CANCELLED','EXPIRED')),
  billing_interval         VARCHAR(20) NOT NULL CHECK (billing_interval IN ('MONTHLY','YEARLY')),
  provider_subscription_id VARCHAR(255),
  start_date               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_billing_date        TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user   ON subscriptions (user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions (status);
CREATE INDEX idx_subscriptions_next   ON subscriptions (next_billing_date) WHERE status = 'ACTIVE';

-- ============================================================
-- INQUIRIES — customer support tickets
-- ============================================================
-- Created by the public support form, logged by staff over the phone,
-- or imported from email. `user_id` is matched automatically when the
-- sender address belongs to a known customer and stays NULL for guests.
-- `related_order_id` links a ticket to the order it is about.
-- ============================================================
CREATE TABLE inquiries (
  inquiry_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number    VARCHAR(40)  UNIQUE NOT NULL,   -- customer-facing, e.g. INQ-2026-0001
  customer_name    VARCHAR(200) NOT NULL,
  customer_email   VARCHAR(255) NOT NULL,
  customer_phone   VARCHAR(50),
  subject          VARCHAR(255) NOT NULL,
  message          TEXT         NOT NULL,
  topic            VARCHAR(30)  NOT NULL DEFAULT 'GENERAL'
                     CHECK (topic IN ('GENERAL','ORDER','REFUND','ACCESS','BILLING','TECHNICAL')),
  status           VARCHAR(30)  NOT NULL DEFAULT 'NEW'
                     CHECK (status IN
                       ('NEW','OPEN','IN_PROGRESS','WAITING_FOR_CUSTOMER','RESOLVED','CLOSED')),
  source           VARCHAR(20)  NOT NULL DEFAULT 'WEBSITE'
                     CHECK (source IN ('WEBSITE','CMS','EMAIL','MOBILE_APP')),
  user_id          UUID         REFERENCES users (user_id)  ON DELETE SET NULL,
  related_order_id UUID         REFERENCES orders (order_id) ON DELETE SET NULL,
  assigned_to      UUID         REFERENCES users (user_id)  ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  CONSTRAINT chk_inquiry_resolution
    CHECK (status NOT IN ('RESOLVED','CLOSED') OR resolved_at IS NOT NULL)
);

-- A ticket may only be assigned to a staff account. This cannot be a
-- CHECK constraint because those may not contain subqueries.
CREATE OR REPLACE FUNCTION assert_inquiry_assignee_is_staff()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  assignee_role VARCHAR(50);
BEGIN
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT role INTO assignee_role FROM users WHERE user_id = NEW.assigned_to;
  IF assignee_role NOT IN ('ADMIN', 'MODERATOR') THEN
    RAISE EXCEPTION 'inquiry % cannot be assigned to a non-staff account', NEW.inquiry_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inquiry_assignee_is_staff
  BEFORE INSERT OR UPDATE OF assigned_to ON inquiries
  FOR EACH ROW EXECUTE FUNCTION assert_inquiry_assignee_is_staff();

CREATE INDEX idx_inquiries_status   ON inquiries (status);
CREATE INDEX idx_inquiries_email    ON inquiries (LOWER(customer_email));
CREATE INDEX idx_inquiries_user     ON inquiries (user_id);
CREATE INDEX idx_inquiries_order    ON inquiries (related_order_id);
CREATE INDEX idx_inquiries_assigned ON inquiries (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_inquiries_created  ON inquiries (created_at DESC);

-- ============================================================
-- INQUIRY NOTES — internal or customer-visible replies
-- ============================================================
CREATE TABLE inquiry_notes (
  note_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id  UUID        NOT NULL REFERENCES inquiries (inquiry_id) ON DELETE CASCADE,
  author_id   UUID        NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
  content     TEXT        NOT NULL CHECK (length(btrim(content)) > 0),
  internal    BOOLEAN     NOT NULL DEFAULT TRUE,   -- TRUE = staff only, never shown to the customer
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inquiry_notes_inquiry ON inquiry_notes (inquiry_id, created_at DESC);

-- ============================================================
-- EMAIL LOGS — every outbound transactional message
-- ============================================================
-- A message stays QUEUED and carries failure_reason while no provider
-- is configured. Nothing may be marked SENT or DELIVERED without a
-- provider acknowledgement.
-- ============================================================
CREATE TABLE email_logs (
  email_log_id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient         VARCHAR(255) NOT NULL,
  recipient_name    VARCHAR(200),
  template          VARCHAR(100) NOT NULL,   -- 'PASSWORD_RESET', 'ORDER_CONFIRMATION', ...
  subject           VARCHAR(500) NOT NULL,
  status            VARCHAR(20)  NOT NULL DEFAULT 'QUEUED'
                      CHECK (status IN ('QUEUED','SENT','FAILED','DELIVERED')),
  related_type      VARCHAR(20)
                      CHECK (related_type IS NULL OR related_type IN ('ORDER','INQUIRY','USER','REFUND')),
  related_id        UUID,
  provider_message_id VARCHAR(255),
  failure_reason    TEXT,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_email_delivered_has_provider_id
    CHECK (status <> 'DELIVERED' OR provider_message_id IS NOT NULL)
);

CREATE INDEX idx_email_logs_status   ON email_logs (status);
CREATE INDEX idx_email_logs_related  ON email_logs (related_type, related_id);
CREATE INDEX idx_email_logs_created  ON email_logs (created_at DESC);

-- ============================================================
-- AUDIT LOGS — every privileged CMS operation
-- ============================================================
-- Actor name and role are snapshotted so the trail survives account
-- deletion. Never log passwords, tokens or card data here.
-- SECURITY covers protection configuration: DRM policy writes and the
-- revocation of a reader's device (src/lib/api-security.ts).
-- ============================================================
CREATE TABLE audit_logs (
  audit_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID         REFERENCES users (user_id) ON DELETE SET NULL,
  actor_name   VARCHAR(200) NOT NULL,
  actor_role   VARCHAR(50)  NOT NULL,
  category     VARCHAR(30)  NOT NULL
                 CHECK (category IN (
                   'PRICE_CHANGE','REFUND','ACCESS_CHANGE','USER_BLOCK','CONTENT_SWAP',
                   'PRODUCT_CREATE','PRODUCT_UPDATE','PRODUCT_DELETE','ROLE_CHANGE',
                   'EMAIL_RESEND','COUPON_CHANGE','ORDER_CHANGE','INQUIRY','SETTINGS',
                   'AUTH','SECURITY','OTHER'
                 )),
  action       VARCHAR(200) NOT NULL,
  target_type  VARCHAR(60)  NOT NULL DEFAULT '',
  target_id    VARCHAR(80)  NOT NULL DEFAULT '',
  target_label VARCHAR(255) NOT NULL DEFAULT '',
  details      TEXT         NOT NULL DEFAULT '',
  ip_address   INET,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_actor    ON audit_logs (actor_id);
CREATE INDEX idx_audit_logs_category ON audit_logs (category);
CREATE INDEX idx_audit_logs_target   ON audit_logs (target_type, target_id);
CREATE INDEX idx_audit_logs_created  ON audit_logs (created_at DESC);

-- ============================================================
-- WEBHOOK EVENTS — provider callbacks, idempotent by design
-- ============================================================
CREATE TABLE webhook_events (
  event_id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          VARCHAR(100) NOT NULL,
  event_type        VARCHAR(100) NOT NULL,
  provider_event_id VARCHAR(255) NOT NULL,
  payload           JSONB        NOT NULL,
  signature         VARCHAR(500),
  status            VARCHAR(50)  NOT NULL DEFAULT 'RECEIVED'
                      CHECK (status IN ('RECEIVED','PROCESSING','PROCESSED','FAILED','SKIPPED')),
  processed_at      TIMESTAMPTZ,
  error_message     TEXT,
  retry_count       INTEGER      NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX idx_webhook_events_status     ON webhook_events (status);
CREATE INDEX idx_webhook_events_created_at ON webhook_events (created_at DESC);

-- ============================================================
-- RATE LIMIT BUCKETS — in-database fallback (Redis preferred)
-- ============================================================
CREATE TABLE rate_limit_buckets (
  bucket_key VARCHAR(255) PRIMARY KEY,
  count      INTEGER      NOT NULL DEFAULT 0 CHECK (count >= 0),
  reset_at   TIMESTAMPTZ  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CRM LEADS / TASKS / NOTES — staff-only pipeline
-- ============================================================
CREATE TABLE crm_leads (
  lead_id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name             VARCHAR(255) NOT NULL,
  email                 VARCHAR(255) NOT NULL,
  phone                 VARCHAR(32),
  stage                 VARCHAR(20)  NOT NULL DEFAULT 'NEW'
                          CHECK (stage IN ('NEW','CONTACTED','INTERESTED','WON','LOST')),
  source                VARCHAR(30)  NOT NULL DEFAULT 'MANUAL'
                          CHECK (source IN ('LANDING_PAGE','STORE','REFERRAL','CAMPAIGN','MANUAL','MOBILE_APP')),
  interested_product_id UUID         REFERENCES products (product_id) ON DELETE SET NULL,
  tags                  TEXT[]       NOT NULL DEFAULT '{}',
  converted_user_id     UUID         REFERENCES users (user_id) ON DELETE SET NULL,
  last_contact_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crm_leads_stage   ON crm_leads (stage);
CREATE INDEX idx_crm_leads_email   ON crm_leads (LOWER(email));
CREATE INDEX idx_crm_leads_product ON crm_leads (interested_product_id);

CREATE TABLE crm_tasks (
  task_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR(255) NOT NULL,
  lead_id     UUID         REFERENCES crm_leads (lead_id) ON DELETE CASCADE,
  assigned_to UUID         REFERENCES users (user_id) ON DELETE SET NULL,
  due_date    TIMESTAMPTZ  NOT NULL,
  priority    VARCHAR(10)  NOT NULL DEFAULT 'MEDIUM'
                CHECK (priority IN ('HIGH','MEDIUM','LOW')),
  done        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crm_tasks_lead ON crm_tasks (lead_id);
CREATE INDEX idx_crm_tasks_due ON crm_tasks (due_date) WHERE done = FALSE;

CREATE TABLE crm_notes (
  note_id    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID         NOT NULL REFERENCES crm_leads (lead_id) ON DELETE CASCADE,
  author_id  UUID         REFERENCES users (user_id) ON DELETE SET NULL,
  category   VARCHAR(20)  NOT NULL DEFAULT 'GENERAL'
               CHECK (category IN ('CALL','EMAIL','MEETING','GENERAL')),
  content    TEXT         NOT NULL CHECK (length(btrim(content)) > 0),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crm_notes_lead ON crm_notes (lead_id, created_at DESC);

-- ============================================================
-- DRM & SCREEN PROTECTION
-- ============================================================
-- Policy is edited in the CMS (src/pages/admin/AdminSecurityPage.tsx) and
-- resolved per platform by src/lib/api-security.ts, which both the web
-- reader (src/pages/ReaderPage.tsx with src/lib/useScreenProtection.ts) and
-- the native reader (react-native/src/drm/ScreenShield.tsx, FLAG_SECURE /
-- capture detection) consume from this same table.
--
-- These columns buy deterrents and attribution, not encryption: a browser
-- that can render a page can be photographed and no client-side flag changes
-- that. The watermark makes a leaked capture traceable to the account it
-- came from; the device cap bounds how far one purchase can be spread; and
-- `content_access_grants` below is what stops either client from ever
-- learning the permanent address of a file.
-- ============================================================
CREATE TABLE drm_policies (
  policy_id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_name             VARCHAR(120) UNIQUE NOT NULL,
  applies_to              VARCHAR(20)  NOT NULL DEFAULT 'ALL'
                            CHECK (applies_to IN ('WEB','MOBILE','ALL')),
  block_screenshots       BOOLEAN      NOT NULL DEFAULT TRUE,
  block_screen_recording  BOOLEAN      NOT NULL DEFAULT TRUE,
  hide_content_on_blur    BOOLEAN      NOT NULL DEFAULT TRUE,
  block_copy              BOOLEAN      NOT NULL DEFAULT TRUE,
  block_print             BOOLEAN      NOT NULL DEFAULT TRUE,
  -- Covers saving, exporting, the share sheet and every "open in another
  -- app" path, because all of them are the same act: handing the bytes to
  -- something the platform no longer controls. The web reader can only
  -- refuse the paths it can see; the native reader refuses the act.
  block_download          BOOLEAN      NOT NULL DEFAULT TRUE,
  -- An offline copy is a file that outlives the session, so it is opt-in
  -- and always bounded by offline_ttl_hours. When the TTL passes the
  -- client must destroy the cache and request a new grant.
  allow_offline           BOOLEAN      NOT NULL DEFAULT FALSE,
  offline_ttl_hours       INTEGER
                            CHECK (offline_ttl_hours IS NULL
                                   OR (offline_ttl_hours > 0 AND offline_ttl_hours <= 720)),
  -- On a rooted or jailbroken device FLAG_SECURE and the app sandbox are
  -- both advisory, so the honest choices are to refuse the content or to
  -- pretend the protection is still standing.
  block_rooted_devices    BOOLEAN      NOT NULL DEFAULT TRUE,
  -- Defaults to TRUE so a fresh install is protected before anybody has to
  -- remember to switch it on; the FIRST RUN row states the same baseline the
  -- web client ships with.
  watermark_enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
  -- {name}, {email} and {date} are substituted per reader at render time.
  watermark_template      VARCHAR(200),
  -- 0.01-0.4: legible enough to attribute a capture, faint enough to read
  -- through. Out-of-band values are rejected rather than clamped, so a typo
  -- cannot silently make a page unreadable or the stamp invisible.
  watermark_opacity       NUMERIC(3,2)
                            CHECK (watermark_opacity IS NULL
                                   OR (watermark_opacity >= 0.01
                                       AND watermark_opacity <= 0.4)),
  max_devices_per_user    INTEGER      NOT NULL DEFAULT 3 CHECK (max_devices_per_user > 0),
  session_timeout_minutes INTEGER      NOT NULL DEFAULT 120 CHECK (session_timeout_minutes > 0),
  active                  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Mirrors the validation in src/lib/api-security.ts: a watermark switched
  -- on with no template would stamp nothing and quietly stop attributing
  -- copies, which is the one failure mode that cannot be seen on screen.
  -- COALESCE matters — a CHECK passes on NULL, so without it a NULL template
  -- would satisfy the constraint and defeat the rule entirely.
  CONSTRAINT chk_drm_watermark_template
    CHECK (NOT watermark_enabled
           OR COALESCE(length(btrim(watermark_template)), 0) > 0),
  -- An offline copy with no TTL is a permanent download wearing a
  -- costume. COALESCE matters here for the same reason as above: a CHECK
  -- passes on NULL, so without it an offline policy with no expiry would
  -- satisfy the constraint and the cache would never have to be deleted.
  CONSTRAINT chk_drm_offline_needs_ttl
    CHECK (NOT allow_offline OR COALESCE(offline_ttl_hours, 0) > 0)
);

CREATE TABLE device_sessions (
  session_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID         NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  device_fingerprint VARCHAR(256) NOT NULL,
  platform           VARCHAR(20)  NOT NULL DEFAULT 'WEB'
                       CHECK (platform IN ('WEB','ANDROID','IOS')),
  device_name        VARCHAR(160),
  -- Client identity, so support can tell an Android 9 phone from an iOS 18
  -- tablet and tell which build a leaked capture came from. device_name
  -- stays the human label; these are the machine-readable fields.
  device_model       VARCHAR(120),
  os_version         VARCHAR(60),
  app_version        VARCHAR(40),
  -- Verdict of the client's own integrity check. Reported by the device
  -- and therefore spoofable, exactly like device_fingerprint; it exists
  -- so block_rooted_devices has something to decide on and so a pattern
  -- of compromised devices shows up in one column instead of in prose.
  device_integrity   VARCHAR(20)  NOT NULL DEFAULT 'UNKNOWN'
                       CHECK (device_integrity IN
                         ('UNKNOWN','TRUSTED','ROOTED','JAILBROKEN',
                          'ATTESTATION_FAILED','EMULATOR')),
  secure_flag_active BOOLEAN      NOT NULL DEFAULT TRUE,
  started_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at           TIMESTAMPTZ,
  revoked            BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Revocation attribution lives on the row, not only in the audit trail:
  -- the reader that gets cut off has to be able to say why, and the
  -- device list has to show who cut it off and when.
  revoked_at         TIMESTAMPTZ,
  revoked_by         UUID         REFERENCES users (user_id) ON DELETE SET NULL,
  revoke_reason      TEXT,
  CONSTRAINT chk_device_session_revocation
    CHECK (revoked = FALSE OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);

CREATE INDEX idx_device_sessions_user ON device_sessions (user_id, revoked);
-- Idle sessions are swept by a job and a customer's own device list sorts
-- by recency; neither is served by the (user_id, revoked) pair.
CREATE INDEX idx_device_sessions_last_seen ON device_sessions (last_seen_at DESC);
CREATE INDEX idx_device_sessions_platform
  ON device_sessions (platform) WHERE ended_at IS NULL AND NOT revoked;

-- One live slot per device per account. registerDeviceSession() hands back
-- the existing open session instead of opening a second one, so the cap
-- counted in application code is the cap storage can actually hold; this
-- makes the rule impossible to break even from two concurrent requests.
CREATE UNIQUE INDEX uq_device_sessions_open_slot
  ON device_sessions (user_id, device_fingerprint)
  WHERE ended_at IS NULL AND NOT revoked;

CREATE TABLE security_events (
  event_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES users (user_id) ON DELETE SET NULL,
  session_id UUID        REFERENCES device_sessions (session_id) ON DELETE SET NULL,
  product_id UUID        REFERENCES products (product_id) ON DELETE SET NULL,
  event_type VARCHAR(40) NOT NULL
               CHECK (event_type IN (
                 -- Browser deterrents (web reader)
                 'SCREENSHOT_BLOCKED','RECORDING_DETECTED','COPY_BLOCKED',
                 'PRINT_BLOCKED','CONTEXT_MENU_BLOCKED','SOURCE_VIEW_BLOCKED',
                 'VISIBILITY_HIDDEN',
                 -- Session and device administration (both clients)
                 'SESSION_REVOKED','DEVICE_LIMIT_EXCEEDED',
                 -- Native reader
                 'DOWNLOAD_BLOCKED',      -- save / export / "open in" refused
                 'SHARE_BLOCKED',         -- share sheet refused for protected content
                 'MIRROR_DETECTED',       -- AirPlay, Chromecast or a wired display
                 'DEVICE_COMPROMISED',    -- root / jailbreak / emulator detected
                 'GRANT_REPLAY_BLOCKED',  -- a single-use content token reused
                 'OFFLINE_EXPIRED'        -- cached copy destroyed because its TTL passed
               )),
  platform   VARCHAR(20) CHECK (platform IS NULL
                                OR platform IN ('WEB','ANDROID','IOS')),
  metadata   JSONB       NOT NULL DEFAULT '{}',
  client_ip  INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_security_events_user_time ON security_events (user_id, created_at DESC);
CREATE INDEX idx_security_events_type      ON security_events (event_type);
CREATE INDEX idx_security_events_session   ON security_events (session_id, created_at DESC);

-- ============================================================
-- CONTENT ACCESS GRANTS — the download-proof delivery path
-- ============================================================
-- The rule both clients obey: nobody is ever given the address of a
-- protected file. They are given a grant — minted for one signed-in
-- account, one entitled product, one device session, with an expiry and
-- a use budget. The API resolves a grant to an asset only after
-- re-checking the entitlement, so revoking access in the CMS also kills
-- every URL already handed out.
--
-- Only token_hash is stored, never the token, so a leaked database
-- cannot be replayed into content — the same rule password_reset_tokens
-- follows.
--
-- watermark_text is frozen at mint time on purpose. The stamp on a
-- leaked page must keep naming the account it was issued to after that
-- account is renamed or deleted, which a live join to users could not
-- guarantee.
--
-- scope separates the two things a reader may do with a grant:
--   STREAM        — short-lived, may be reused inside one session, for
--                   the page the client is displaying right now.
--   OFFLINE_CACHE — single-use, issued only when the policy allows
--                   offline reading. The client keeps the bytes in its
--                   private vault and must destroy them at expires_at.
-- ============================================================
CREATE TABLE content_access_grants (
  grant_id        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  user_product_id UUID          NOT NULL REFERENCES user_products (user_product_id) ON DELETE CASCADE,
  product_id      UUID          NOT NULL REFERENCES products (product_id) ON DELETE RESTRICT,
  session_id      UUID          REFERENCES device_sessions (session_id) ON DELETE SET NULL,
  asset_id        UUID          REFERENCES content_assets (asset_id) ON DELETE SET NULL,
  platform        VARCHAR(20)   NOT NULL DEFAULT 'WEB'
                  CHECK (platform IN ('WEB','ANDROID','IOS')),
  scope           VARCHAR(20)   NOT NULL DEFAULT 'STREAM'
                  CHECK (scope IN ('STREAM','OFFLINE_CACHE')),
  token_hash      VARCHAR(255)  NOT NULL UNIQUE,
  watermark_text  VARCHAR(200),
  checksum        VARCHAR(64),
  file_size_bytes BIGINT        CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  max_uses        INTEGER       NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count       INTEGER       NOT NULL DEFAULT 0 CHECK (use_count >= 0 AND use_count <= max_uses),
  expires_at      TIMESTAMPTZ   NOT NULL,
  first_used_at   TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  revoked_by      UUID          REFERENCES users (user_id) ON DELETE SET NULL,
  revoke_reason   TEXT,
  client_ip       INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- An offline cache is a download by another name: one transfer, no
  -- retries, so a single file cannot be pulled down twice.
  CONSTRAINT chk_grant_offline_single_use
    CHECK (scope <> 'OFFLINE_CACHE' OR max_uses = 1),
  CONSTRAINT chk_grant_revocation
    CHECK (revoked_at IS NULL OR revoked_by IS NOT NULL),
  -- Anything that leaves the app and lives on disk must belong to a
  -- device slot that can be revoked; only an in-page stream may be
  -- session-less.
  CONSTRAINT chk_grant_bound_to_session
    CHECK (session_id IS NOT NULL OR scope = 'STREAM')
);

CREATE INDEX idx_content_grants_user_product ON content_access_grants (user_id, product_id);
CREATE INDEX idx_content_grants_expiry
  ON content_access_grants (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_content_grants_session
  ON content_access_grants (session_id) WHERE session_id IS NOT NULL;

-- ------------------------------------------------------------
-- Atomic redemption.
--
-- A single-use token checked with SELECT-then-UPDATE from application
-- code is a race: two concurrent readers both pass the check and both
-- receive the file. This function locks the row, re-verifies the
-- entitlement — which may have been revoked or have expired since the
-- grant was minted — and consumes one use in the same statement.
--
-- It raises rather than returning NULL on rejection so a caller cannot
-- forget to check the outcome.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION consume_content_grant(p_token_hash TEXT)
RETURNS TABLE (
  out_grant_id    UUID,
  out_user_id     UUID,
  out_product_id  UUID,
  out_scope       VARCHAR,
  out_watermark   VARCHAR,
  out_checksum    VARCHAR,
  out_storage_key VARCHAR
)
LANGUAGE plpgsql AS $$
DECLARE
  g           content_access_grants;
  entitlement user_products;
BEGIN
  SELECT * INTO g
  FROM content_access_grants
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF g.grant_id IS NULL THEN
    RAISE EXCEPTION 'content grant rejected: unknown token' USING ERRCODE = '42501';
  END IF;
  IF g.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'content grant rejected: revoked' USING ERRCODE = '42501';
  END IF;
  IF g.expires_at <= NOW() THEN
    RAISE EXCEPTION 'content grant rejected: expired' USING ERRCODE = '42501';
  END IF;
  IF g.use_count >= g.max_uses THEN
    RAISE EXCEPTION 'content grant rejected: already redeemed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO entitlement FROM user_products WHERE user_product_id = g.user_product_id;

  IF entitlement.user_product_id IS NULL
     OR entitlement.access_status <> 'ACTIVE'
     OR (entitlement.expires_at IS NOT NULL AND entitlement.expires_at <= NOW()) THEN
    RAISE EXCEPTION 'content grant rejected: entitlement no longer active'
      USING ERRCODE = '42501';
  END IF;

  UPDATE content_access_grants
     SET use_count     = use_count + 1,
         first_used_at = COALESCE(first_used_at, NOW()),
         last_used_at  = NOW()
   WHERE grant_id = g.grant_id;

  out_grant_id   := g.grant_id;
  out_user_id    := g.user_id;
  out_product_id := g.product_id;
  out_scope      := g.scope;
  out_watermark  := g.watermark_text;
  out_checksum   := g.checksum;

  SELECT ca.storage_key INTO out_storage_key
  FROM content_assets ca WHERE ca.asset_id = g.asset_id;

  RETURN NEXT;
END;
$$;

-- ------------------------------------------------------------
-- Cascading revocation.
--
-- Minting a grant is only half the promise. The other half is that
-- cutting a device off, or revoking an entitlement in the CMS, also
-- kills every URL already handed out — otherwise a revoked phone keeps
-- a live address to the file until the grant expires on its own, and
-- "revoke access" quietly means "revoke future access".
--
-- Enforced here rather than in application code because two clients
-- write to these rows and only one of them is ours.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION revoke_grants_for_device_session()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE content_access_grants
     SET revoked_at    = NOW(),
         revoke_reason = 'ההתקשרות ממכשיר זה נחסמה'
   WHERE session_id = NEW.session_id
     AND revoked_at IS NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_device_session_revokes_grants
  AFTER UPDATE OF revoked ON device_sessions
  FOR EACH ROW WHEN (NEW.revoked AND NOT OLD.revoked)
  EXECUTE FUNCTION revoke_grants_for_device_session();

CREATE OR REPLACE FUNCTION revoke_grants_for_entitlement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Still entitled: nothing to undo. Only a loss of access cascades.
  IF NEW.access_status = 'ACTIVE'
     AND (NEW.expires_at IS NULL OR NEW.expires_at > NOW()) THEN
    RETURN NEW;
  END IF;

  UPDATE content_access_grants
     SET revoked_at    = NOW(),
         revoke_reason = 'הגישה לתוכן זה בוטלה'
   WHERE user_product_id = NEW.user_product_id
     AND revoked_at IS NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_product_revokes_grants
  AFTER UPDATE OF access_status, expires_at ON user_products
  FOR EACH ROW
  WHEN (NEW.access_status IS DISTINCT FROM OLD.access_status
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at)
  EXECUTE FUNCTION revoke_grants_for_entitlement();


-- ============================================================
-- TRIGGERS — keep updated_at honest
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_crm_leads_updated_at
  BEFORE UPDATE ON crm_leads         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_inquiries_updated_at
  BEFORE UPDATE ON inquiries         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cms_sections_updated_at
  BEFORE UPDATE ON cms_sections      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_testimonials_updated_at
  BEFORE UPDATE ON testimonials      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_faqs_updated_at
  BEFORE UPDATE ON faqs              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_drm_policies_updated_at
  BEFORE UPDATE ON drm_policies      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON platform_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- JOBS — reader session and grant expiry
-- ============================================================
-- Closes device sessions that idled past the governing policy and
-- revokes grants that lapsed, in one call a scheduler can make. Returns
-- the number of sessions closed so the job can log it.
--
-- Idleness is measured against the policy that applies to the session's
-- own platform, which is why the timeout is resolved here instead of
-- being passed in: a MOBILE policy and a WEB policy are allowed to
-- disagree, and sweeping both with one number would cut somebody's
-- reading short.
-- ============================================================
CREATE OR REPLACE FUNCTION sweep_expired_reader_sessions()
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  closed INTEGER;
BEGIN
  WITH policy AS (
    SELECT COALESCE(
      (SELECT d.session_timeout_minutes FROM drm_policies d
        WHERE d.active AND d.applies_to = 'MOBILE'
        ORDER BY d.updated_at DESC LIMIT 1),
      (SELECT d.session_timeout_minutes FROM drm_policies d
        WHERE d.active AND d.applies_to = 'ALL'
        ORDER BY d.updated_at DESC LIMIT 1),
      (SELECT d.session_timeout_minutes FROM drm_policies d
        WHERE d.active
        ORDER BY d.updated_at DESC LIMIT 1),
      120
    ) AS idle_minutes
  ),
  swept AS (
    UPDATE device_sessions ds
       SET ended_at           = NOW(),
           secure_flag_active = FALSE
      FROM policy
     WHERE ds.ended_at IS NULL
       AND ds.revoked = FALSE
       AND ds.last_seen_at < NOW() - (policy.idle_minutes || ' minutes')::INTERVAL
    RETURNING ds.session_id
  )
  SELECT COUNT(*) INTO closed FROM swept;

  UPDATE content_access_grants
     SET revoked_at = COALESCE(revoked_at, NOW())
   WHERE revoked_at IS NULL AND expires_at <= NOW();

  RETURN closed;
END;
$$;

-- ============================================================
-- VIEWS — every derived figure is computed here, never stored
-- ============================================================

-- ------------------------------------------------------------
-- Refund roll-up per order. `orders` deliberately has no
-- refunded_amount or refund_status column: both are recomputed from
-- the `refunds` rows so the two can never disagree.
-- ------------------------------------------------------------
CREATE VIEW v_order_refunds AS
SELECT
  o.order_id,
  COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'REFUNDED'), 0)  AS refunded_amount,
  COUNT(r.refund_id)     FILTER (WHERE r.status IN ('REQUESTED','PENDING')) AS open_refund_requests,
  CASE
    WHEN COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'REFUNDED'), 0) <= 0
      THEN 'NONE'
    WHEN COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'REFUNDED'), 0) >= o.total_amount
      THEN 'FULL'
    ELSE 'PARTIAL'
  END AS refund_status
FROM orders o
LEFT JOIN refunds r ON r.order_id = o.order_id
GROUP BY o.order_id, o.total_amount;

-- ------------------------------------------------------------
-- Order detail as the CMS orders screen needs it: the order itself,
-- the refund roll-up, the settled payment and the invoice.
-- ------------------------------------------------------------
CREATE VIEW v_orders AS
SELECT
  o.*,
  f.refunded_amount,
  f.refund_status,
  f.open_refund_requests,
  p.payment_id,
  p.provider              AS payment_provider,
  p.transaction_reference,
  p.card_last4,
  i.invoice_number,
  i.receipt_number
FROM orders o
LEFT JOIN v_order_refunds f ON f.order_id = o.order_id
LEFT JOIN LATERAL (
  SELECT payment_id, provider, transaction_reference, card_last4
  FROM payments
  WHERE order_id = o.order_id AND status = 'CAPTURED'
  ORDER BY captured_at DESC NULLS LAST, created_at DESC
  LIMIT 1
) p ON TRUE
LEFT JOIN invoices i ON i.order_id = o.order_id;

-- ------------------------------------------------------------
-- Revenue by day: gross, discounts, refunds and net. Charts read
-- this view; no totals table exists to fall out of sync.
-- ------------------------------------------------------------
CREATE VIEW v_daily_revenue AS
SELECT
  s.day,
  s.currency,
  s.orders_count,
  s.gross_revenue,
  s.total_discounts,
  COALESCE(r.refunded_amount, 0)                          AS refunded_amount,
  s.gross_revenue - COALESCE(r.refunded_amount, 0)        AS net_revenue
FROM (
  SELECT
    DATE(paid_at)         AS day,
    currency,
    COUNT(*)              AS orders_count,
    SUM(total_amount)     AS gross_revenue,
    SUM(discount_amount)  AS total_discounts
  FROM orders
  WHERE paid_at IS NOT NULL
    AND payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
  GROUP BY DATE(paid_at), currency
) s
LEFT JOIN (
  SELECT DATE(processed_at) AS day, currency, SUM(amount) AS refunded_amount
  FROM refunds
  WHERE status = 'REFUNDED' AND processed_at IS NOT NULL
  GROUP BY DATE(processed_at), currency
) r ON r.day = s.day AND r.currency = s.currency;

-- ------------------------------------------------------------
-- Sales by product. Priced from the frozen order-item snapshot, so
-- re-pricing or renaming a product never rewrites past performance.
-- ------------------------------------------------------------
CREATE VIEW v_product_sales AS
SELECT
  oi.product_id,
  oi.product_name,
  COUNT(DISTINCT oi.order_id)     AS orders_count,
  SUM(oi.quantity)                AS units_sold,
  SUM(oi.line_total)              AS gross_revenue,
  SUM(oi.discount_amount)         AS discounts_given
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
WHERE o.payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
GROUP BY oi.product_id, oi.product_name;

-- ------------------------------------------------------------
-- Customer 360: the fields the CMS customer profile shows. No
-- credential column appears here.
-- ------------------------------------------------------------
CREATE VIEW v_customer_summary AS
SELECT
  u.user_id,
  u.first_name,
  u.last_name,
  u.email,
  u.phone,
  u.role,
  u.account_status,
  u.created_at,
  u.last_login_at,
  u.last_activity_at,
  COALESCE(o.orders_count, 0)     AS orders_count,
  COALESCE(o.total_spent, 0)      AS total_spent,
  o.last_purchase_at,
  COALESCE(o.currency, 'ILS')     AS currency,
  COALESCE(r.refunded_total, 0)   AS refunded_total,
  COALESCE(e.entitlements, 0)     AS entitlements_count,
  COALESCE(q.inquiries, 0)        AS inquiries_count
FROM users u
LEFT JOIN (
  SELECT user_id, COUNT(*) AS orders_count, SUM(total_amount) AS total_spent,
         MAX(paid_at) AS last_purchase_at, MIN(currency) AS currency
  FROM orders
  WHERE payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
  GROUP BY user_id
) o ON o.user_id = u.user_id
LEFT JOIN (
  SELECT o2.user_id, SUM(r2.amount) AS refunded_total
  FROM refunds r2 JOIN orders o2 ON o2.order_id = r2.order_id
  WHERE r2.status = 'REFUNDED'
  GROUP BY o2.user_id
) r ON r.user_id = u.user_id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS entitlements
  FROM user_products WHERE access_status = 'ACTIVE'
  GROUP BY user_id
) e ON e.user_id = u.user_id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS inquiries FROM inquiries GROUP BY user_id
) q ON q.user_id = u.user_id;

-- ------------------------------------------------------------
-- Entitlements with display data. The live product wins while it
-- exists; the snapshot is the fallback so the library never renders a
-- blank card.
-- ------------------------------------------------------------
CREATE VIEW v_active_user_products AS
SELECT
  up.user_product_id,
  up.user_id,
  up.product_id,
  COALESCE(p.name,         up.product_snapshot ->> 'name')          AS product_name,
  COALESCE(p.slug,         up.product_snapshot ->> 'slug')          AS product_slug,
  COALESCE(p.product_type, up.product_snapshot ->> 'product_type')  AS product_type,
  COALESCE(p.image_url,    up.product_snapshot ->> 'image_url')     AS image_url,
  up.product_snapshot,
  up.access_status,
  up.granted_at,
  up.expires_at,
  up.source_order_id
FROM user_products up
LEFT JOIN products p ON p.product_id = up.product_id
WHERE up.access_status = 'ACTIVE'
  AND (up.expires_at IS NULL OR up.expires_at > NOW());

-- ------------------------------------------------------------
-- Storefront catalog: one row per published, publicly listed product
-- with its book metadata, cover and categories already resolved. The
-- homepage, catalog, search, product page and checkout all read this.
-- Adding a product in the CMS makes it appear here with no code change.
-- ------------------------------------------------------------
CREATE VIEW v_storefront_catalog AS
SELECT
  p.product_id,
  p.name,
  p.slug,
  p.sku,
  p.subtitle,
  p.short_description,
  p.description,
  p.product_type,
  p.price,
  p.sale_price,
  p.currency,
  p.cover_colors,
  -- products.content_url and content_assets.public_url are deliberately
  -- NOT selected here. This is the view an anonymous visitor reads, so
  -- every column in it is a column the storefront hands out without an
  -- entitlement check. Display metadata stays; the address of the file
  -- does not, and is reachable only through v_entitled_content and a
  -- minted content_access_grants row.
  p.tags,
  p.status,
  p.visibility,
  p.availability,
  p.inventory,
  p.featured,
  p.position,
  p.rating,
  p.reviews_count,
  p.seo_title,
  p.seo_description,
  p.seo_keywords,
  b.author_name,
  b.isbn,
  b.publisher,
  b.language,
  b.publication_date,
  b.total_pages,
  ca.file_size_bytes AS content_size_bytes,
  ca.total_pages     AS content_pages,
  p.image_url        AS cover_image_url,
  COALESCE(gal.image_urls, '{}')      AS gallery_image_urls,
  COALESCE(cats.category_ids, '{}')   AS category_ids,
  COALESCE(cats.category_names, '{}') AS category_names
FROM products p
LEFT JOIN books b           ON b.product_id = p.product_id
LEFT JOIN content_assets ca ON ca.asset_id  = p.content_asset_id
LEFT JOIN LATERAL (
  SELECT array_agg(COALESCE(pi.image_url, a.public_url) ORDER BY pi.sort_order) AS image_urls
  FROM product_images pi
  LEFT JOIN content_assets a ON a.asset_id = pi.asset_id
  WHERE pi.product_id = p.product_id
) gal ON TRUE
LEFT JOIN LATERAL (
  SELECT array_agg(pc.category_id ORDER BY c.display_order)  AS category_ids,
         array_agg(c.name         ORDER BY c.display_order) AS category_names
  FROM product_categories pc
  JOIN categories c ON c.category_id = pc.category_id
  WHERE pc.product_id = p.product_id
) cats ON TRUE
WHERE p.status = 'ACTIVE'
  AND p.visibility = 'PUBLIC';

-- ------------------------------------------------------------
-- Entitled content, with the address of the file.
--
-- The only place in the schema where a content location is readable, and
-- it is readable for one account at a time. The grant-minting endpoint
-- joins this against the caller's user_id and returns a token, never the
-- columns below; storage_key must not reach a client on any path.
--
-- The live product wins while it exists and the purchase-time snapshot is
-- the fallback, so archiving or renaming a title never locks a paying
-- customer out of what they bought.
-- ------------------------------------------------------------
CREATE VIEW v_entitled_content AS
SELECT
  up.user_id,
  up.user_product_id,
  up.product_id,
  up.access_status,
  up.granted_at,
  up.expires_at,
  up.source_order_id,
  COALESCE(p.name, up.product_snapshot ->> 'name') AS product_name,
  COALESCE(p.slug, up.product_snapshot ->> 'slug') AS product_slug,
  p.product_type,
  p.content_url,
  ca.asset_id,
  ca.storage_key,
  ca.public_url,
  ca.file_name,
  ca.mime_type,
  ca.file_size_bytes,
  ca.checksum,
  COALESCE(ca.total_pages, b.total_pages) AS total_pages
FROM user_products up
LEFT JOIN products p        ON p.product_id = up.product_id
LEFT JOIN content_assets ca ON ca.asset_id  = p.content_asset_id
LEFT JOIN books b           ON b.product_id = p.product_id
WHERE up.access_status = 'ACTIVE'
  AND (up.expires_at IS NULL OR up.expires_at > NOW());

-- ------------------------------------------------------------
-- Live content grants with the reader and device resolved, for the
-- protection panel in the CMS: who is holding a file right now, on what,
-- and how much of its use budget is left.
-- ------------------------------------------------------------
CREATE VIEW v_active_content_grants AS
SELECT
  g.grant_id,
  g.user_id,
  u.first_name || ' ' || u.last_name AS user_name,
  g.product_id,
  COALESCE(p.name, g.watermark_text) AS product_name,
  g.session_id,
  ds.platform,
  ds.device_name,
  g.scope,
  g.max_uses,
  g.use_count,
  g.expires_at,
  g.created_at,
  g.revoked_at
FROM content_access_grants g
JOIN users u                 ON u.user_id = g.user_id
LEFT JOIN products p         ON p.product_id = g.product_id
LEFT JOIN device_sessions ds ON ds.session_id = g.session_id
WHERE g.revoked_at IS NULL AND g.expires_at > NOW();

-- ------------------------------------------------------------
-- Support queue, newest first, with the assignee resolved.
-- ------------------------------------------------------------
CREATE VIEW v_inquiry_queue AS
SELECT
  i.inquiry_id,
  i.ticket_number,
  i.customer_name,
  i.customer_email,
  i.customer_phone,
  i.subject,
  i.topic,
  i.status,
  i.source,
  i.user_id,
  i.related_order_id,
  o.order_number AS related_order_number,
  i.assigned_to,
  a.first_name || ' ' || a.last_name AS assigned_to_name,
  i.created_at,
  i.updated_at,
  i.resolved_at,
  COALESCE(n.notes_count, 0)   AS notes_count,
  COALESCE(n.internal_count,0) AS internal_notes_count
FROM inquiries i
LEFT JOIN users  a ON a.user_id  = i.assigned_to
LEFT JOIN orders o ON o.order_id = i.related_order_id
LEFT JOIN (
  SELECT inquiry_id,
         COUNT(*)                        AS notes_count,
         COUNT(*) FILTER (WHERE internal) AS internal_count
  FROM inquiry_notes GROUP BY inquiry_id
) n ON n.inquiry_id = i.inquiry_id;

-- ------------------------------------------------------------
-- Reading overview
-- ------------------------------------------------------------
CREATE VIEW v_user_reading_overview AS
SELECT
  rp.user_id,
  rp.product_id,
  p.name           AS product_name,
  rp.current_page,
  COALESCE(b.total_pages, ca.total_pages) AS total_pages,
  rp.progress_percent,
  rp.last_read_at
FROM reading_progress rp
JOIN products p          ON p.product_id = rp.product_id
LEFT JOIN books b        ON b.product_id = rp.product_id
LEFT JOIN content_assets ca ON ca.asset_id = p.content_asset_id;

-- ============================================================
-- ERD RELATIONSHIP SUMMARY
-- ============================================================
-- USERS            1:N  ORDERS
-- USERS            1:N  USER_PRODUCTS
-- USERS            1:N  READING_PROGRESS
-- USERS            1:N  SUBSCRIPTIONS
-- USERS            1:N  SESSIONS
-- USERS            1:N  DEVICE_SESSIONS
-- USERS            1:N  PASSWORD_RESET_TOKENS
-- USERS            1:N  AUDIT_LOGS            (actor_id)
-- USERS            1:N  REFUNDS               (initiated_by_id, reviewed_by)
-- USERS            1:N  INQUIRIES             (user_id, assigned_to)
-- USERS            1:N  INQUIRY_NOTES         (author_id)
-- USERS            1:N  CRM_TASKS             (assigned_to)
-- USERS            1:N  CRM_NOTES             (author_id)
-- USERS            1:1  CRM_LEADS             (converted_user_id)
--
-- PRODUCTS         1:1  BOOKS                 (EBOOK metadata extension)
-- PRODUCTS         N:M  CATEGORIES             (via product_categories)
-- PRODUCTS         1:N  PRODUCT_IMAGES
-- PRODUCTS         1:N  PRODUCT_MEDIA_LINKS
-- PRODUCTS         1:N  PRODUCT_RELATIONS      (source: bundle/related/upsell/cross-sell)
-- PRODUCTS         1:N  PRODUCT_RELATIONS      (target)
-- PRODUCTS         N:1  CONTENT_ASSETS         (content_asset_id)
-- PRODUCTS         1:N  ORDER_ITEMS            (RESTRICT — sold products cannot be deleted)
-- PRODUCTS         1:N  USER_PRODUCTS          (RESTRICT — entitlements cannot be destroyed)
-- PRODUCTS         1:N  SUBSCRIPTIONS
-- PRODUCTS         1:N  READING_PROGRESS
-- PRODUCTS         1:N  CRM_LEADS              (interested_product_id)
-- PRODUCTS         1:N  SECURITY_EVENTS
--
-- ORDERS           1:N  ORDER_ITEMS
-- ORDERS           1:N  PAYMENTS
-- ORDERS           1:N  REFUNDS                (RESTRICT — financial history is preserved)
-- ORDERS           1:1  INVOICES
-- ORDERS           1:N  USER_PRODUCTS          (source_order_id)
-- ORDERS           1:N  COUPON_USAGE
-- ORDERS           1:N  INQUIRIES              (related_order_id)
--
-- PAYMENTS         1:N  REFUNDS                (payment_id)
-- COUPONS          1:N  COUPON_USAGE
-- COUPONS          1:N  ORDERS                 (coupon_id)
-- INQUIRIES        1:N  INQUIRY_NOTES
-- CRM_LEADS        1:N  CRM_TASKS
-- CRM_LEADS        1:N  CRM_NOTES
-- DEVICE_SESSIONS  1:N  SECURITY_EVENTS
-- DEVICE_SESSIONS  1:N  CONTENT_ACCESS_GRANTS
-- USER_PRODUCTS    1:N  CONTENT_ACCESS_GRANTS  (CASCADE — losing the
--                                               entitlement loses every
--                                               URL minted from it)
-- PRODUCTS         1:N  CONTENT_ACCESS_GRANTS  (RESTRICT)
-- CONTENT_ASSETS   1:N  CONTENT_ACCESS_GRANTS
-- ============================================================

-- ============================================================
-- ACCESS CONTROL
-- ============================================================
-- Hiding a button in the UI is not authorization. Every read and write
-- below must be gated in the API layer against the caller's role and
-- admin_role, and the staff-only tables must additionally be protected
-- at the database:
--
--   customers  users (own row), orders (own), order_items (own orders),
--              payments (own orders), user_products (own),
--              reading_progress (own), subscriptions (own),
--              invoices (own orders), inquiries (own), inquiry_notes
--              (own inquiries, internal = FALSE only), products,
--              categories, books, product_images, cms_sections,
--              testimonials, faqs, device_sessions (own),
--              content_access_grants (own — and only as a redeemed
--              token, never as a readable row)
--
--   staff only platform_settings, refunds, audit_logs, email_logs,
--              coupon_usage, coupons, crm_leads, crm_tasks, crm_notes,
--              webhook_events, drm_policies, security_events, sessions,
--              password_reset_tokens, rate_limit_buckets
--
--   service role v_entitled_content and content_assets.storage_key.
--              Neither may reach a client on any path: the API reads them
--              to mint a content_access_grants row and returns the token
--              alone, so the location of a file stays server-side.
--
-- Credentials (users.password_hash / password_salt) and full card data
-- are never selectable by any API response; only card_last4 is stored.
-- Enable row-level security on the customer-visible tables and grant
-- the application role the minimum column set it needs. The mobile app
-- authenticates against these same tables with client = 'ANDROID' or
-- 'IOS' on its sessions row, so it gets no wider a column set than the
-- browser does.
-- ============================================================

-- ============================================================
-- FIRST RUN
-- ============================================================
-- These are the only INSERTs in the file, and both write configuration,
-- not content: one settings row with neutral empty defaults so the CMS has
-- something to read before anyone has logged in, and one protection policy
-- so purchased content is never exposed before an administrator remembers
-- to switch DRM on.
--
-- Nothing else is created. There are no demo users, products, orders,
-- transactions, refunds, inquiries, reviews, coupons or CMS sections.
-- An empty database must produce empty states in the UI, and the
-- first administrator is created interactively through the one-time
-- installation screen at /setup — never by a script.
-- ============================================================
-- The site-copy columns (tagline, trust_badges, catalogue_*, pricing_*,
-- footer_text) are deliberately absent from this list so that they take
-- their column defaults: NULL text and an empty array. Seeding them here
-- would mean the installation ships with marketing copy somebody invented
-- inside a migration, which is precisely what those columns exist to stop.
INSERT INTO platform_settings (
  brand_name, default_currency, invoice_prefix, order_prefix, inquiry_prefix,
  payment_provider, email_provider, refund_execution_enabled, max_upload_bytes,
  mobile_app_enabled, mobile_min_build
) VALUES (
  'Casanova', 'ILS', 'INV', 'CNV', 'INQ',
  NULL, NULL, FALSE, 10485760,
  TRUE, 0
)
ON CONFLICT (is_singleton) DO NOTHING;

-- The same baseline as defaultDrmPolicy() in src/lib/db.ts, so a browser
-- install and a server install start from identical protection. Addressed by
-- name rather than by a generated id, which lets this file be re-run without
-- stacking duplicate defaults.
INSERT INTO drm_policies (
  policy_name, applies_to, block_screenshots, block_screen_recording,
  hide_content_on_blur, block_copy, block_print, block_download,
  allow_offline, offline_ttl_hours, block_rooted_devices,
  watermark_enabled, watermark_template, watermark_opacity,
  max_devices_per_user, session_timeout_minutes, active
) VALUES (
  'מדיניות ברירת מחדל', 'ALL', TRUE, TRUE,
  TRUE, TRUE, TRUE, TRUE,
  FALSE, NULL, TRUE,
  TRUE, '{name} · {email}', 0.07,
  3, 120, TRUE
)
ON CONFLICT (policy_name) DO NOTHING;
