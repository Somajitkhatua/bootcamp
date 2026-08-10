# RevApex AI — AI App Bootcamp Landing Page

Marketing landing page for the free live **"Build a Real Mobile App With AI in 90 Minutes"**
bootcamp, hosted by Mahabahu Behera (Bahu), founder of RevApex AI. Deployed on Netlify at
[events.revapex.ai](https://events.revapex.ai).

## Contents

- `index.html` — the page Netlify actually serves at the site root.
- `marketing/AI App Bootcamp Landing.html` — source copy of the same page (keep both in sync; see
  "Editing the page" below).
- `assets/`, `marketing/assets/` — instructor photo, mirrored the same way.
- `netlify/functions/` — the backend: Zoho Webinar OAuth + registration API (see below).

## Editing the page

`index.html` is what Netlify serves at `/`. `marketing/AI App Bootcamp Landing.html` is kept as an
identical copy for reference. After editing one, copy it onto the other before committing:

```bash
cp "marketing/AI App Bootcamp Landing.html" index.html
```

## Registration flow

Every "Reserve your free spot" CTA opens a Russell Brunson–style two-step opt-in modal that
captures: **first name, last name, email, phone, city, profession** (student / working professional
/ businessman / entrepreneur).

On submit, the form `POST`s directly to this site's own backend — **no third-party automation
platform** (no n8n, Zapier, or Make) is in the loop:

```
Frontend form → POST /api/webinar/register → Zoho OAuth 2.0 → Zoho Webinar Registration API
```

The backend looks up the submitted `eventId` against a server-side config file, gets a fresh Zoho
access token using a stored refresh token, and registers the attendee directly with Zoho. The
browser never sees a Zoho credential, webinar key, or organization id.

---

## Zoho Webinar Integration

### Architecture

This site is a static page with no prior backend or database. Rather than introduce a new
framework or a separate hosting platform, the integration is built as **Netlify Functions** —
served from the same repo, deployed by the same `git push`, using the same Netlify account that
already hosts the page. `netlify.toml` maps the documented `/api/...` paths onto them:

| Route | Function | Purpose |
| --- | --- | --- |
| `POST /api/webinar/register` | `netlify/functions/webinar-register.js` | Runtime registration endpoint the frontend calls. |
| `GET /api/auth/zoho/start` | `netlify/functions/zoho-auth-start.js` | One-time: redirects to Zoho's OAuth consent screen. |
| `GET /api/auth/zoho/callback` | `netlify/functions/zoho-auth-callback.js` | One-time: exchanges the code for tokens, shows the refresh token to copy into Netlify. |

Shared logic lives under `netlify/functions/_lib/`:

- `zoho.js` — OAuth token refresh (cached), attendee registration, duplicate-registration lookup.
- `eventsConfig.js` + `eventsConfig.json` — server-side `eventId` → Zoho webinar mapping.
- `validate.js` — input validation, normalization, honeypot + submit-timing anti-spam checks.
- `store.js` — [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
  wrapper used for the access-token cache, best-effort rate limiting, and a registration audit
  log (see "Assumptions & limitations" — this site has no other database).
- `http.js` — CORS + JSON response helpers.

### Files changed / added

```
package.json                                    (new — declares @netlify/blobs)
netlify.toml                                     (new — functions dir + /api/* redirects)
netlify/functions/webinar-register.js            (new)
netlify/functions/zoho-auth-start.js             (new)
netlify/functions/zoho-auth-callback.js          (new)
netlify/functions/_lib/zoho.js                   (new)
netlify/functions/_lib/eventsConfig.js           (new)
netlify/functions/_lib/eventsConfig.json         (new)
netlify/functions/_lib/validate.js               (new)
netlify/functions/_lib/store.js                  (new)
netlify/functions/_lib/http.js                   (new)
.env.example                                     (new)
.gitignore                                        (updated — .env, .netlify/)
index.html, marketing/AI App Bootcamp Landing.html (updated — form now posts to /api/webinar/register)
```

### Environment variables required

Set these in **Netlify → Site configuration → Environment variables** (never in a committed file).
See `.env.example` for the same list with inline notes.

| Variable | Notes |
| --- | --- |
| `ZOHO_CLIENT_ID` | From the Zoho API Console (Self Client). |
| `ZOHO_CLIENT_SECRET` | Same. **Never** commit or log this. |
| `ZOHO_REFRESH_TOKEN` | Obtained once via the bootstrap flow below. Doesn't expire unless revoked. |
| `ZOHO_ACCOUNTS_URL` | `https://accounts.zoho.in` (this account is on the India data center). |
| `ZOHO_WEBINAR_API_URL` | `https://webinar.zoho.in/api/v2` |
| `ZOHO_ZSOID` | Shared org id, used unless an event in `eventsConfig.json` overrides it. |
| `ZOHO_X_ZSOURCE` | Value sent in the required `X-ZSOURCE` header. Default: `RevApexAI`. |
| `ZOHO_SETUP_SECRET` | Guards the one-time OAuth bootstrap routes. Set only while bootstrapping, then remove/rotate. |
| `PUBLIC_BASE_URL` | `https://events.revapex.ai` — used to build the exact OAuth redirect URI. |
| `ALLOWED_ORIGINS` | `https://events.revapex.ai` — CORS allow-list for the register endpoint. |

### Zoho configuration required

1. **API Console app** — a Self Client (or Server-based Application) in the
   [Zoho API Console](https://api-console.zoho.in/) on the **.in** data center, with a redirect URI
   of exactly:
   ```
   https://events.revapex.ai/api/auth/zoho/callback
   ```
   (Not `/rest/oauth2-credential/callback` — that's n8n's path and isn't used here.)
2. **A Zoho Webinar** with registration enabled. `eventsConfig.json` currently maps the event id
   `ai-app-bootcamp` to `zohoWebinarKey: "1375301932"` — **please confirm this is actually the
   webinarKey** (see "Assumptions & limitations" below) via the callback page's auto-discovery, or
   the webinar's own settings in `webinar.zoho.in`.
3. **One-time OAuth bootstrap** — after deploying with `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`,
   `ZOHO_ACCOUNTS_URL`, and a `ZOHO_SETUP_SECRET` of your choosing set in Netlify:
   - Visit `https://events.revapex.ai/api/auth/zoho/start?key=<ZOHO_SETUP_SECRET>`.
   - Log into Zoho and approve consent.
   - You'll land on a page showing the refresh token, granted scopes, and (best-effort) your
     `zsoid` and webinar list.
   - Copy `ZOHO_REFRESH_TOKEN` (and `ZOHO_ZSOID` if discovered) into Netlify's env vars.
   - **Remove or rotate `ZOHO_SETUP_SECRET`** so the bootstrap route can't be re-triggered.
   - Redeploy.

### Adding a new event

Add an entry to `netlify/functions/_lib/eventsConfig.json`:

```json
{
  "eventId": "revenue-cloud-masterclass",
  "eventName": "Revenue Cloud Masterclass",
  "zohoZsoId": "",
  "zohoWebinarKey": "<numeric webinar id from Zoho>",
  "zohoInstanceId": "",
  "active": true
}
```

Leave `zohoZsoId` blank to reuse the shared `ZOHO_ZSOID` env var. Set `active: false` to retire an
event without deleting it. No code changes needed — just point the relevant form's `eventId` at
the new id and redeploy.

### Test procedure

**Without live Zoho credentials** (logic-only, run anytime):

```bash
npm install
npm test
```

Runs `tests/` — pure unit tests of validation and anti-spam logic with no network calls.

**End-to-end, after deploying with real credentials:**

1. Complete the OAuth bootstrap above; confirm `ZOHO_REFRESH_TOKEN`/`ZOHO_ZSOID` are set and the
   site has redeployed.
2. Open `https://events.revapex.ai`, click "Reserve your free spot," submit the form with a real
   (or disposable) email you control.
3. Confirm the button shows "Registering you..." while the request is in flight and is disabled
   (no double-submit).
4. Confirm the success screen reads *"Registration successful! Your webinar confirmation and
   joining details have been sent to your email."* and shows a join link if Zoho returned one.
5. Check the inbox for Zoho's registration confirmation email.
6. Submit the **same email again** — confirm the friendly duplicate message appears ("You're
   already registered for this webinar...") instead of an error.
7. Check Netlify function logs (`webinar-register`) for the request — confirm no secret values
   (`ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, access tokens) appear anywhere in the log output.
8. Optional: inspect the audit trail via `netlify blobs:list registrations` (Netlify CLI) if you
   want to confirm what got recorded.

### Assumptions & limitations

- **`zohoWebinarKey: "1375301932"`** was provided as "the Webinar ID" — Zoho's docs show
  `webinarKey` as a numeric identifier matching this shape, so it's used as given, but this
  **could not be verified against your live account** from here (that requires your Zoho login).
  The OAuth callback page's webinar-list diagnostic is there specifically to confirm or correct it
  on first bootstrap.
- **`zsoid` discovery is best-effort.** Zoho's public docs for the Webinar product don't document
  a "current user" endpoint as clearly as they do for the registration/bulk-registration APIs
  themselves. The callback page tries a few candidate endpoints; if none work, it tells you how to
  find your `zsoid` manually from the browser network tab.
- **Duplicate-registration detection** uses the documented GET registration-list endpoint to check
  for an existing registrant by email before calling the register endpoint — Zoho's docs don't
  enumerate a specific "already registered" error code for the register call itself, so that path
  also has a heuristic string-match fallback. If real-world testing turns up a cleaner signal,
  tighten `_lib/zoho.js`'s duplicate detection.
- **No pre-existing database** — this site had none. Rate limiting, the access-token cache, and the
  registration audit log all use **Netlify Blobs**, included in the same Netlify account with no
  extra infrastructure. They're all wired to **fail open**: if Blobs is ever unavailable, real
  registrations against Zoho still succeed; only the secondary bookkeeping (rate limit counting,
  audit logging) is skipped for that request. Swap `_lib/store.js` for a real database later if
  you want hard rate-limit enforcement or queryable registration records.
- **Zoho's registrant schema** (per public docs) only accepts `email`, `firstName`, `lastName`.
  `phone`, `city`, `profession`, and `company` are captured and written to the audit log for your
  own records but are not sent to Zoho.
- **This build could not be tested against your live Zoho account** — no interactive Zoho login is
  available here, and the OAuth consent step must be completed by the account owner. Logic-level
  tests run locally (see `npm test`); the true end-to-end path needs the manual test procedure
  above after your first deploy with real credentials.
- **"Zoom" copy elsewhere on the page** (CTA band, footer, FAQ) wasn't changed — this task was
  scoped to the registration backend. If the event is now actually hosted on Zoho Webinar rather
  than Zoom, that copy should be swept too; if Zoho Webinar is only the registration/reminder layer
  while the call itself stays on Zoom, no further change is needed. Confirm which is true.

## Local preview (static page only)

```bash
python3 -m http.server 8000
# then visit http://localhost:8000/
```

For the backend, use the [Netlify CLI](https://docs.netlify.com/cli/get-started/) (`netlify dev`)
to run the Functions locally against a `.env` file copied from `.env.example`.
