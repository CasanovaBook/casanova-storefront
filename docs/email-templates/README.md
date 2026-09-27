# Authentication email templates

## Who owns these templates

**Supabase Auth, in the dashboard.** Not this repository.

`supabase/config.toml` contains only Edge Function settings (`get-content-url`,
`create-upload-url`) and deliberately has **no** `[auth.email.template.*]` block
and no `content_path`. Supabase Auth renders authentication e-mails on its own
servers from the template stored in the dashboard, so no file here is imported,
bundled or deployed. The file next to this README is a **paste-ready copy kept
under version control** so the template can be reviewed and diffed like the rest
of the product.

`src/lib/supabase-auth.ts` is the only application code in the flow, and it does
nothing but ask Auth to send the mail:

```ts
// requestPasswordReset() — src/lib/supabase-auth.ts:255
await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
  redirectTo: `${window.location.origin}/setup-password`,
})
```

The link, the token, its expiry and its one-time use are all generated
server-side by Supabase Auth. Nothing in the application mints or stores them.

## Applying a template

1. Supabase dashboard → **Authentication** → **Emails**.
2. Select the **Reset password** template.
3. Paste the contents of `reset-password.html` into the **Source** pane.
4. **Save**.
5. Run the test in "Testing" below.

The subject line is intentionally left alone. See "Why not change the subject".

## Why the body is ordered this way

Gmail groups a repeated password-reset request into the existing conversation
and then hides the part of the new body that matches the earlier message behind
its `...` control. The previous body was identical on every request, so Gmail
classified **the entire message — button included —** as repeated content and
collapsed all of it. That is the screenshot: a second reset e-mail showing
nothing but `...`.

The fix is to make each message contain genuinely new visible text. Two facts
shape how that is done.

**1. No template variable can produce a timestamp.** Supabase's templating
exposes exactly these:

| Variable | Note |
|---|---|
| `{{ .ConfirmationURL }}` | The verification link. **Unique per request** (fresh token hash). |
| `{{ .Token }}` | 6-digit OTP. Unique per request. **Never put this in the body.** |
| `{{ .TokenHash }}` | Hashed token, credential-equivalent. `{{ .ConfirmationURL }}` already contains it. |
| `{{ .SiteURL }}` | Constant. |
| `{{ .RedirectTo }}` | Whatever the app passes. Currently the constant `/setup-password`. |
| `{{ .Data }}` | `auth.users.user_metadata`. Identical on every request. |
| `{{ .Email }}` | The recipient. Identical on every request. |

`{{ .NewEmail }}`, `{{ .OldEmail }}`, `{{ .Phone }}`, `{{ .Provider }}` and
`{{ .FactorType }}` exist but belong to other templates.

None is time-derived, and Go's `text/template` provides no clock function, so a
literal *"This request was generated on …"* line **cannot be produced from a
template**. A `{{REQUEST_TIME}}`-style variable does not exist and would render
as `<no value>` or fail validation. That is why the timestamp idea needs the
Send Email Hook below rather than a template edit.

**2. Therefore the confirmation URL is the only per-request content
available.** The body puts a large block of genuinely new visible text — the
copy-and-paste link — directly beneath the button, with only static prose after
it. Gmail meets a body that differs substantially from the previous one instead
of an identical one, and the static tail is the part it is free to trim. The
button sits above that block so the CTA and the new content travel together.

### Why the OTP and the token hash are excluded

Putting either in the body would weaken the account, not just the e-mail:

- `{{ .ConfirmationURL }}` is **already** in the message, as the button's `href`.
  Rendering it as visible fallback text adds **no** new exposure — it is the same
  string — and a copy-and-paste fallback is what keeps the flow usable in the
  clients that refuse to render the button.
- `{{ .Token }}` appears **nowhere** in the message by default. Publishing a short
  numeric code that resets an account turns "click this link" into "read me the
  code", which is trivially social-engineered. Do not add it.
- `{{ .TokenHash }}` is the raw ingredient of the link. Do not add it.
- Never add passwords, refresh tokens, service-role keys, internal database ids
  or any secret.

Note that the template engine substitutes `{{ … }}` anywhere in the file,
**including inside HTML comments**. Keep explanatory prose out of
`reset-password.html` and in this README instead, or a variable mentioned in a
comment gets substituted into every message.

## Why not change the subject

Gmail decides conversation grouping itself, and a different subject is what
actually separates two messages into two conversations. But the subject cannot
be varied per request either — Supabase templates the subject with the same
variable set, which contains no per-request non-secret value. Appending a
per-send timestamp to the subject would work around threading, at the cost of a
visibly unprofessional inbox line, and it does not fix the body problem. Keep
the professional subject.

## Testing

Request a reset, then immediately re-request, and check a third request too:

1. `/forgot-password` → submit a known address.
2. Open the e-mail: heading, body and the gold **איפוס הסיסמה** button visible.
3. Click the button → lands on `/setup-password` with an active recovery session
   (the page detects `type=recovery` in the hash, or the `PASSWORD_RECOVERY`
   auth event).
4. Set a new password → sign in with it.
5. Request a reset **again** in the same Gmail conversation. The new message must
   show the button and the link block **without** expanding `...`.
6. Repeat once more.

Acceptance criterion: the Reset Password button is visible and clickable in a
subsequent reset e-mail without manually expanding Gmail's quoted-content
section. Confirm the signup/verification e-mail is untouched — this change
touches the recovery template only.

## Optional: a real timestamp (Send Email Hook)

The only way to put an actual *"requested at"* time in the body is to stop using
templates and send the mail yourself. Supabase's **Send Email Hook** replaces
Auth's built-in sending with an HTTP call to your own function, which can put
`new Date()` in the body and gives full HTML control.

Caveats, which is why this is not the default fix:

- The hook takes over **all** authentication e-mails, not just recovery, so the
  function has to implement every action type or notification e-mails break.
- It needs `RESEND_API_KEY` and `SEND_EMAIL_HOOK_SECRET` as project secrets, and
  the function must verify the webhook signature.
- It is a real deployment, not a dashboard edit.

Steps if you want it:

1. `supabase functions new send-email` — the repo already uses
   `supabase/functions/` with a shared `deno.json`.
2. Verify the webhook and send via Resend. The payload is `{ user, email_data }`
   where `email_data` is `{ token, token_hash, redirect_to, email_action_type,
   site_url, token_new, token_hash_new, old_email, old_phone, provider,
   factor_type }`. Note there is **no** timestamp in the payload either — the
   function generates it.
3. Build the link from `token_hash` + `redirect_to` + `email_action_type` and
   send it through Resend.
4. `supabase functions deploy send-email --no-verify-jwt`
5. Dashboard → **Authentication** → **Hooks** → enable **Send Email**, pointing
   at the function with the generated secret.
6. Re-test every authentication e-mail, not just recovery.

## Related

Resend is configured as Supabase's custom SMTP (`smtp.resend.com:465`, user
`resend`) under **Authentication → Emails → SMTP Settings**. That setting
controls *how* Auth sends; the template controls *what* it sends. Supabase's
docs warn that provider-side "email tracking" rewrites the links inside these
templates and can break them — if click tracking is enabled on the Resend
domain, turn it off before testing.
