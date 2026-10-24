/* ─────────────────────────────────────────────────────────────
 * Local GoTrue + PostgREST stand-in for the storefront's auth and
 * purchase flows.  NODE ONLY, NO DEPENDENCIES.
 *
 * WHY THIS EXISTS
 *
 * The registration flow cannot be exercised end to end without a
 * confirmation email, and sending real mail during testing is not
 * acceptable.  So the transport is removed from the picture entirely:
 * the app is pointed at THIS origin, which answers the handful of
 * endpoints it actually calls and has no mail capability whatsoever.
 * Every outcome a real GoTrue can return - confirmation pending, mail
 * delivery failing, an address already registered, the same answer
 * phrased so a client cannot tell - is replayed here on demand.
 *
 * Nothing here touches the real project: the URL and the key are both
 * local test values, the "tokens" are fixed fake strings that no server
 * accepts, and every request is recorded so a test can assert what the
 * browser actually sent.
 *
 *   node scripts/mock-supabase.cjs 9300
 *
 * Control plane (used by the driver, never by the app):
 *   GET  /__/state              current scenario
 *   POST /__/scenario           {"signup":"mail_failed", ...}
 *   GET  /__/log                every recorded request
 *   POST /__/log                clears the log
 * ───────────────────────────────────────────────────────────── */

const http = require("node:http")

const PORT = Number(process.argv[2] || 9300)

const NOW = new Date("2026-10-14T09:00:00Z").toISOString()
const LATER = new Date("2026-10-14T09:05:00Z").toISOString()

const USER_ID = "11111111-2222-3333-4444-555555555555"
const PRODUCT_ID = "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
const ORDER_ID = "77777777-8888-9999-aaaa-000000000001"

/** Fixed, meaningless strings - they are never sent anywhere real. */
const ACCESS_TOKEN = "mock-unsigned-access-token"
const REFRESH_TOKEN = "mock-unsigned-refresh-token"

/* supabase-js decodes the implicit-flow access token to learn who the user
 * is, without verifying anything. So the token has to at least LOOK like a
 * JWT: header.payload.signature with an unsigned, base64url payload. It is a
 * local fixture that no server on earth accepts. */
function b64url(value) {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function mockJwt(extra) {
  const iat = Math.floor(Date.now() / 1000)
  const payload = {
    aud: "authenticated",
    exp: iat + 3600,
    iat,
    iss: "mock",
    sub: USER_ID,
    id: USER_ID,
    email: "shopper@test.invalid",
    phone: null,
    role: "authenticated",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    ...extra,
  }
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(payload)}.mock-signature`
}

/** Reads back the claims of a token this mock handed out. */
function decodeClaims(token) {
  const parts = String(token || "").split(".")
  if (parts.length !== 3) return null
  try {
    return JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    )
  } catch {
    return null
  }
}

const state = {
  /* signup: what POST /auth/v1/signup answers */
  signup: "confirm_required",
  /* login: what POST /auth/v1/token?grant_type=password answers */
  login: "confirmed",
  /* profile: whether public.users holds a row for the signed-in account */
  profile: true,
  profilePhone: null,
  /* userUpdate: whether PUT /auth/v1/user accepts the metadata write */
  userUpdate: "ok",
  /* order: whether rpc/create_storefront_order succeeds */
  order: "ok",
  /* content: what GET /functions/v1/get-content-url answers for the reader.
   * ok | missing | forbidden | expired | outage | throw | delay */
  content: "ok",
  /* entitlement: whether public.user_products holds an ACTIVE row for the
   * signed-in account. Opt-in, and it must stay that way: a row here also
   * makes the storefront treat the visitor as an owner, which changes the
   * buy button into a read button and breaks the checkout scenarios. */
  entitlement: false,
}

const log = []

/** A genuinely parseable one-page PDF, xref offsets computed rather than
 *  guessed, so the reader's "content available" case renders instead of
 *  failing on a malformed file. */
function tinyPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>",
  ]
  let out = "%PDF-1.4\n"
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefAt = Buffer.byteLength(out, "latin1")
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += String(off).padStart(10, "0") + " 00000 n \n"
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(out, "latin1")
}

function authUser(extra) {
  return {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "shopper@test.invalid",
    phone: null,
    confirmed_at: null,
    email_confirmed_at: null,
    phone_confirmed_at: null,
    last_sign_in_at: null,
    created_at: NOW,
    updated_at: NOW,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    factors: [],
    ...extra,
  }
}

function session(user) {
  return {
    access_token: ACCESS_TOKEN,
    id_token: "",
    refresh_token: REFRESH_TOKEN,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  }
}

/** The profile row `fetchProfile` reads back from public.users. */
function profileRow() {
  if (!state.profile) return null
  return {
    user_id: USER_ID,
    first_name: "Shir",
    last_name: "Natan",
    email: "shopper@test.invalid",
    phone: state.profilePhone,
    role: "CUSTOMER",
    admin_role: null,
    account_status: "ACTIVE",
    must_change_password: false,
    created_at: NOW,
    updated_at: NOW,
    last_login_at: LATER,
    last_activity_at: null,
    greeted_at: NOW,
  }
}

function productRow() {
  return {
    product_id: PRODUCT_ID,
    name: "היא קודם",
    subtitle: null,
    slug: "hi-kodem",
    sku: "HI-KODEM",
    description: "תיאור לבדיקה",
    short_description: "תיאור קצר לבדיקה",
    product_type: "EBOOK",
    price: 99,
    sale_price: 59,
    currency: "ILS",
    image_url: null,
    cover_colors: ["#1A1A2E", "#2A2A3E"],
    rating: 5,
    reviews_count: 0,
    tags: null,
    metadata: null,
    seo_title: null,
    seo_description: null,
    seo_keywords: null,
    status: "ACTIVE",
    visibility: "PUBLIC",
    availability: "IN_STOCK",
    inventory: 100,
    featured: true,
    position: 1,
    created_at: NOW,
    updated_at: NOW,
    archived_at: null,
    book: { book_id: "b1", author_name: "רותי לוי", total_pages: 120, storage_path: null },
    categories: [],
    images: [],
    media_links: [],
    relations: [],
  }
}

function signupResponse(send) {
  switch (state.signup) {
    case "mail_failed":
      /* Mirrors what the live project returned, byte for byte. */
      return send(500, {
        code: "unexpected_failure",
        message: "Error sending confirmation email",
      })
    case "already_exists":
      return send(422, {
        code: "user_already_exists",
        error_code: "user_already_exists",
        msg: "User already registered",
        message: "User already registered",
      })
    case "autoconfirmed": {
      const user = authUser({
        email_confirmed_at: NOW,
        confirmed_at: NOW,
        last_sign_in_at: NOW,
      })
      return send(200, { user, session: session(user) })
    }
    case "silent_duplicate":
      /* GoTrue's privacy mode: a taken address gets the same answer as a new
       * one, so a client cannot enumerate accounts. */
      return send(200, {
        user: authUser({ confirmation_sent_at: NOW }),
        session: null,
      })
    default:
      /* Confirm-email ON: the user exists but no session is handed out. */
      return send(200, {
        user: authUser({ confirmation_sent_at: NOW }),
        session: null,
      })
  }
}

function loginResponse(send) {
  switch (state.login) {
    case "unconfirmed":
      return send(400, {
        code: "email_not_confirmed",
        error_code: "email_not_confirmed",
        msg: "Email not confirmed",
        message: "Email not confirmed",
      })
    case "invalid":
      return send(400, {
        code: "invalid_credentials",
        message: "Invalid login credentials",
      })
    case "rate_limited":
      return send(429, {
        code: "over_email_sent_rate_limit",
        message: "Too many requests",
      })
    case "ok_unconfirmed_session":
      /* Signed in with confirmation still outstanding - the state the
       * checkout gate exists for. */
      return send(200, session(authUser({ last_sign_in_at: NOW })))
    default:
      return send(
        200,
        session(
          authUser({
            email_confirmed_at: NOW,
            confirmed_at: NOW,
            last_sign_in_at: NOW,
            user_metadata: { first_name: "Shir", last_name: "Natan" },
          }),
        ),
      )
  }
}

function restHandler(req, url, send, body) {
  const table = decodeURIComponent(url.pathname.replace("/rest/v1/", ""))

  /* One read the app issues as `maybeSingle` on products by id, and the same
   * path used for the whole list. The filter in the query tells them apart. */
  if (table === "products") {
    if (url.searchParams.has("product_id")) return send(200, productRow())
    return send(200, [productRow()])
  }

  if (table === "categories") return send(200, [])

  if (table.startsWith("rpc/create_storefront_order")) {
    /* Behave like the function after migration 0026: the contact rules the
     * storefront states are refused here too, with the same bare tokens, so a
     * test can prove the client maps a server refusal into a Hebrew message
     * instead of showing a success screen. A scenario may also force any
     * single refusal directly through `order`. */
    const refusal =
      state.order !== "ok"
        ? state.order
        : String(body?.p_phone ?? "").trim() === ""
          ? "phone_required"
          : String(body?.p_email ?? "").trim() === ""
            ? "email_invalid"
            : null

    if (refusal) {
      return send(500, {
        code: refusal === "gateway_configured" ? "P0001" : "22023",
        message: refusal,
      })
    }
    return send(201, {
      order: {
        order_id: ORDER_ID,
        order_number: "ORD-2026-000042",
        user_id: USER_ID,
        order_status: "PAID",
        payment_status: "PAID",
        subtotal: 99,
        discount_amount: 0,
        total_amount: 59,
        currency: "ILS",
        coupon_code: null,
        customer_first_name: "Shir",
        customer_last_name: "Natan",
        customer_email: "shopper@test.invalid",
        customer_phone: req.__phone || null,
        created_at: LATER,
        paid_at: LATER,
      },
      item: {
        order_item_id: "88888888-0000-0000-0000-000000000001",
        order_id: ORDER_ID,
        product_id: PRODUCT_ID,
        product_name: "היא קודם",
        quantity: 1,
        unit_price: 99,
        discount_amount: 0,
        line_total: 59,
      },
      entitlement: {
        user_product_id: "99999999-0000-0000-0000-000000000001",
        granted_at: LATER,
      },
      customer: {
        user_id: USER_ID,
        first_name: "Shir",
        last_name: "Natan",
        email: "shopper@test.invalid",
        /* Deliberately the PROFILE value, exactly like the real function:
         * it returns users.phone, not the number just typed. */
        phone: state.profilePhone,
        role: "CUSTOMER",
        admin_role: null,
      },
    })
  }

  if (table.startsWith("users")) {
    const row = profileRow()
    if (!row) {
      /* What PostgREST answers when maybeSingle() matches no row. */
      return send(406, {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
        details: "Results contain 0 rows",
      })
    }
    return send(200, row)
  }

  /* The reader's access check reads this table through RLS; the harness needs
   * a row so the route guard lets an entitled customer in at all. */
  if (table.startsWith("user_products")) {
    if (!state.entitlement) return send(200, [])
    return send(200, [
      {
        user_product_id: "up-1111-2222",
        user_id: USER_ID,
        product_id: PRODUCT_ID,
        product_snapshot: {
          product_id: PRODUCT_ID,
          name: "היא קודם",
          slug: "hi-kodem",
          product_type: "EBOOK",
          cover_colors: ["#1A1A2E", "#2A2A3E"],
          image_url: null,
          author_name: "רותי לוי",
          total_pages: 4,
        },
        source_order_id: ORDER_ID,
        access_status: "ACTIVE",
        granted_at: NOW,
        expires_at: null,
      },
    ])
  }

  /* Everything else the app polls (inquiries, settings …). */
  return send(200, [])
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)

  const send = (status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Expose-Headers": "x-total-count,content-range",
      "Content-Length": body === undefined ? 0 : Buffer.byteLength(JSON.stringify(body)),
    })
    res.end(body === undefined ? "" : JSON.stringify(body))
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Max-Age": "86400",
    })
    return res.end()
  }

  const chunks = []
  req.on("data", (c) => chunks.push(c))
  req.on("end", () => {
    /* A mock that dies on a bad branch is worse than a mock that answers 500:
     * the driver would report a transport failure instead of its own bug. */
    try {
      handle(req, res, url)
    } catch (err) {
      console.log("mock handler error:", err && err.message)
      send(500, { code: "mock_internal", message: String(err && err.message) })
    }
  })

  function handle(req, res, url) {
    const raw = Buffer.concat(chunks).toString("utf8")
    let body = null
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      body = raw
    }

    req.__body = body

    if (!url.pathname.startsWith("/__/")) {
      log.push({
        at: new Date().toISOString(),
        method: req.method,
        path: url.pathname + (url.search || ""),
        body,
        bearer: Boolean(req.headers.authorization),
      })
    }

    /* ── control plane ─────────────────────────────────────── */
    if (url.pathname === "/__/state") return send(200, state)

    /* The driver builds a verification-link URL with this token, which is how
     * the app receives a real link: an access token in the URL fragment. */
    if (url.pathname === "/__/token") {
      const confirmed = url.searchParams.get("confirmed") === "true"
      const metadata = url.searchParams.get("metadata") === "names"
        ? { first_name: "Shir", last_name: "Natan", phone: "0547654321" }
        : { phone: "0547654321" }
      return send(200, {
        access_token: mockJwt({
          user_metadata: metadata,
          email_confirmed_at: confirmed ? NOW : null,
          confirmed_at: confirmed ? NOW : null,
          last_sign_in_at: confirmed ? NOW : null,
        }),
        refresh_token: REFRESH_TOKEN,
        token_type: "bearer",
        expires_in: 3600,
      })
    }

    if (url.pathname === "/__/scenario") {
      Object.assign(state, body || {})
      return send(200, state)
    }

    if (url.pathname === "/__/log") {
      if (req.method === "POST") {
        log.length = 0
        return send(200, { cleared: true })
      }
      return send(200, log)
    }

    /* ── GoTrue ────────────────────────────────────────────── */
    if (url.pathname === "/auth/v1/signup") return signupResponse(send)

    if (url.pathname === "/auth/v1/token") {
      return loginResponse(send)
    }

    if (url.pathname === "/auth/v1/resend") return send(200, { message_id: "mock" })

    if (url.pathname === "/auth/v1/user") {
      if (req.method === "PUT") {
        if (state.userUpdate !== "ok") {
          return send(400, {
            code: "validation_failed",
            message: "Mock refuses the profile write",
          })
        }
        /* Echo the merged metadata back the way GoTrue does. */
        return send(200, {
          ...authUser({
            email_confirmed_at: NOW,
            confirmed_at: NOW,
            user_metadata: (body && body.data) || {},
          }),
        })
      }
      /* supabase-js re-reads the user after an implicit (URL) session, and whatever
       * this returns REPLACES the token's claims. So read them off the bearer
       * token it arrived with - otherwise a link-click session would come back
       * looking unconfirmed and with empty metadata, and the test would be
       * measuring the mock instead of the app. */
      const bearer = String(req.headers.authorization || "").replace(/^Bearer /i, "")
      const claims = decodeClaims(bearer)
      return send(200, {
        ...authUser(claims
          ? {
              email_confirmed_at: claims.email_confirmed_at || null,
              confirmed_at: claims.confirmed_at || null,
              last_sign_in_at: claims.last_sign_in_at || NOW,
              user_metadata: claims.user_metadata || {},
            }
          : { email_confirmed_at: NOW, confirmed_at: NOW }),
      })
    }

    if (url.pathname === "/auth/v1/logout") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*" })
      return res.end()
    }

    if (url.pathname === "/auth/v1/verify") {
      return send(400, { code: "bad_request", msg: "Mock does not verify tokens" })
    }

    if (url.pathname === "/auth/v1/settings" || url.pathname === "/health") {
      return send(200, {
        mock: true,
        mailer_autoconfirm: false,
        disable_signup: false,
        external: { email: true },
      })
    }

    /* The object the signed URL points at. Bytes, not JSON - the reader's
     * parser must be able to open it. */
    if (url.pathname === "/fake-book.pdf") {
      const pdf = tinyPdf()
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": pdf.length,
        "Access-Control-Allow-Origin": "*",
      })
      return res.end(pdf)
    }

    /* ── Edge Functions ────────────────────────────────────── */
    if (url.pathname === "/functions/v1/get-content-url") {
      const signed = {
        signedUrl: `http://127.0.0.1:${PORT}/fake-book.pdf`,
        expiresAt: new Date(Date.now() + 1800_000).toISOString(),
      }

      /* "delay" holds the answer back so the reader's in-flight state can be
       * observed: that window is where it used to claim the file was never
       * uploaded, before any answer existed. */
      if (state.content === "delay") {
        return setTimeout(() => send(200, signed), 4000)
      }

      switch (state.content) {
        case "missing":
          /* What get-content-url answers when Storage reports the object
           * absent - the only answer that entitles the UI to speak of a
           * missing file. */
          return send(404, { error: "No content file is attached to this product" })
        case "forbidden":
          return send(403, { error: "אין לך הרשאת גישה פעילה לספר זה." })
        case "expired":
          return send(401, { error: "משתמש אינו מורשה או שתוקף ההתחברות פג." })
        case "outage":
          /* English on purpose: it is what the function really returns, and the
           * point of the test is that the customer never sees it. */
          return send(500, { error: "Could not sign the content URL" })
        case "throw":
          /* Not JSON at all - the transport path, where supabase-js has no
           * status to read. */
          res.writeHead(502, {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
          })
          return res.end("upstream send timeout")
        default:
          return send(200, signed)
      }
    }

    /* ── PostgREST ─────────────────────────────────────────── */
    if (url.pathname.startsWith("/rest/v1/")) {
      return restHandler(req, url, send, body)
    }

    return send(404, { error: "unhandled", path: url.pathname })
  }
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock supabase listening on http://127.0.0.1:${PORT}`)
})
