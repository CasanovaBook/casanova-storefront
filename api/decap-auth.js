/**
 * Vercel function: OAuth handshake for Decap CMS (same-origin /api/decap-auth).
 *
 * GET without ?code -> 302 to GitHub's authorize URL (CSRF state cookie set).
 * GET with ?code    -> state check, server-side token exchange, then a page
 *                      that postMessages the token to the Decap opener window
 *                      and closes. The token never appears in a URL.
 *
 * Required Vercel env vars (never committed):
 *   DECAP_GITHUB_CLIENT_ID
 *   DECAP_GITHUB_CLIENT_SECRET
 *   DECAP_OAUTH_REDIRECT_URI  (https://casanova-books.com/api/decap-auth)
 *
 * Scope is minimal on purpose: repo (content commits) + read:user. Editors
 * must already have push access to the repository.
 */

import { randomBytes } from "node:crypto";

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const SCOPE = "repo,read:user";

/** Exact-origin CSP for the tiny response pages. */
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'";

function html(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", CSP);
  res.end(body);
}

function errorPage(message) {
  const safe = String(message).replace(/[<>&"]/g, "");
  return `<!doctype html>
<html dir="rtl" lang="he"><body style="font-family:system-ui;padding:2rem;text-align:center">
<p>שגיאת התחברות ל-CMS: ${safe}</p>
<p><a href="javascript:window.close()">סגור</a></p>
</body></html>`;
}

/** The postMessage page Decap's github backend listens for. */
function successPage(token, siteOrigin) {
  const safe = String(token).replace(/[<>&"]/g, "");
  return `<!doctype html>
<html><body><script>
(function () {
  window.opener.postMessage(
    "authorization:github:success:" + JSON.stringify({ token: "${safe}", provider: "github" }),
    "${siteOrigin}"
  );
  window.close();
})();
</script></body></html>`;
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export default async function handler(req, res) {
  const clientId = process.env.DECAP_GITHUB_CLIENT_ID;
  const clientSecret = process.env.DECAP_GITHUB_CLIENT_SECRET;
  const redirectUri = process.env.DECAP_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return html(res, 500, errorPage("Missing DECAP_GITHUB_CLIENT_ID / DECAP_GITHUB_CLIENT_SECRET / DECAP_OAUTH_REDIRECT_URI"));
  }

  // The window that opened the OAuth popup lives on the same origin as the
  // callback, so deriving it from the redirect URI (instead of hardcoding
  // production) makes preview deployments work too.
  const siteOrigin = new URL(redirectUri).origin;

  const url = new URL(req.url, siteOrigin);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  /* ---- Step 1: begin the flow -------------------------------------- */
  if (!code) {
    const nonce = randomBytes(16).toString("hex");
    res.setHeader(
      "Set-Cookie",
      `decap_oauth_state=${nonce}; Path=/api/decap-auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    );
    const authorize = new URL(GITHUB_AUTHORIZE);
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("scope", SCOPE);
    authorize.searchParams.set("state", nonce);
    res.statusCode = 302;
    res.setHeader("Location", authorize.toString());
    return res.end();
  }

  /* ---- Step 2: complete the flow ------------------------------------ */
  if (!state || state !== getCookie(req, "decap_oauth_state")) {
    return html(res, 400, errorPage("state mismatch (CSRF)"));
  }

  try {
    const tokenRes = await fetch(GITHUB_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });
    if (!tokenRes.ok) throw new Error("GitHub token endpoint " + tokenRes.status);
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;
    if (!token) throw new Error(tokenData.error_description || tokenData.error || "no token returned");
    return html(res, 200, successPage(token, siteOrigin));
  } catch (e) {
    return html(res, 502, errorPage((e && e.message) || "token exchange failed"));
  }
}
