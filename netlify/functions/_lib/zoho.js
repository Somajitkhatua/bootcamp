// ---------------------------------------------------------------------------
// Zoho OAuth 2.0 + Webinar API client.
//
// Docs consulted (Aug 2026):
//   https://www.zoho.com/webinar/api/authentication.html
//   https://www.zoho.com/webinar/api/getting-started.html
//   https://www.zoho.com/webinar/api/webinar-api/bulk-registration.html
//   https://www.zoho.com/webinar/api/webinar-api/registration.html
//   https://www.zoho.com/webinar/api/webinar-api/get-webinar-details.html
//
// SECURITY: never log accessToken, ZOHO_CLIENT_SECRET, or ZOHO_REFRESH_TOKEN.
// Every catch block below logs only status codes / short messages.
// ---------------------------------------------------------------------------

const { getCachedAccessToken, setCachedAccessToken } = require('./store');

function env(name, required = true) {
  const v = process.env[name];
  if (required && !v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function accountsUrl() {
  return (env('ZOHO_ACCOUNTS_URL') || '').replace(/\/+$/, '');
}

function webinarApiUrl() {
  return (env('ZOHO_WEBINAR_API_URL') || '').replace(/\/+$/, '');
}

function xZsource() {
  return process.env.ZOHO_X_ZSOURCE || 'RevApexAI';
}

/**
 * Returns a valid Zoho access token, refreshing it via the stored refresh
 * token when the cached one is missing or near expiry. This is the only
 * place the refresh token or client secret touch the network.
 */
async function getAccessToken() {
  const cached = await getCachedAccessToken();
  if (cached) return cached;

  const clientId = env('ZOHO_CLIENT_ID');
  const clientSecret = env('ZOHO_CLIENT_SECRET');
  const refreshToken = env('ZOHO_REFRESH_TOKEN');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(`${accountsUrl()}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || !json.access_token) {
    // json.error is a short Zoho error code (e.g. "invalid_client") — safe to log.
    console.error('Zoho token refresh failed', { status: res.status, error: json.error || 'unknown' });
    throw new Error('Unable to obtain a Zoho access token.');
  }

  await setCachedAccessToken(json.access_token, json.expires_in);
  return json.access_token;
}

async function zohoRequest(pathname, { method = 'GET', query, body, accessToken } = {}) {
  const url = new URL(`${webinarApiUrl()}${pathname}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'X-ZSOURCE': xZsource(),
      'Content-Type': 'application/json;charset=UTF-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    // non-JSON response — leave json as {} and let caller inspect res.ok/status
  }

  return { ok: res.ok, status: res.status, json };
}

/**
 * Registers a single attendee via the Bulk Registration API (used for
 * both single and bulk registrant calls — one registrant is a valid call).
 * https://www.zoho.com/webinar/api/webinar-api/bulk-registration.html
 */
async function registerAttendee(eventConfig, registrant, { sendMail = true } = {}) {
  const accessToken = await getAccessToken();
  const { zohoZsoId, zohoWebinarKey, zohoInstanceId } = eventConfig;

  const result = await zohoRequest(`/${zohoZsoId}/register/${zohoWebinarKey}.json`, {
    method: 'POST',
    accessToken,
    query: {
      sendMail: sendMail ? 'true' : 'false',
      instanceId: zohoInstanceId,
    },
    body: {
      registrant: [
        {
          email: registrant.email,
          firstName: registrant.firstName,
          lastName: registrant.lastName || undefined,
        },
      ],
    },
  });

  return result;
}

/**
 * Best-effort lookup of an existing registration by email, used to avoid
 * creating duplicate registrations and to hand back the attendee's existing
 * joinLink when they submit the form a second time.
 *
 * Zoho's public docs for the list-registrations endpoint (GET
 * /{zsoid}/registration/{webinarKey}) don't document an email filter or
 * the exact response envelope, so this pages through results defensively
 * and normalizes whatever shape comes back. If anything about this call
 * fails or looks unrecognized, it returns null (caller falls through to a
 * normal registration attempt) rather than blocking the request.
 */
async function findExistingRegistration(eventConfig, email) {
  const accessToken = await getAccessToken();
  const { zohoZsoId, zohoWebinarKey } = eventConfig;
  const pageSize = 200;
  const maxPages = 10; // safety cap: ~2000 registrants scanned, bounded latency

  for (let page = 0; page < maxPages; page++) {
    let result;
    try {
      result = await zohoRequest(`/${zohoZsoId}/registration/${zohoWebinarKey}`, {
        method: 'GET',
        accessToken,
        query: { index: String(page * pageSize + 1), count: String(pageSize) },
      });
    } catch (err) {
      console.error('Zoho registration-list lookup errored', { message: err.message });
      return null;
    }

    if (!result.ok) return null;

    const list = extractRegistrantList(result.json);
    if (!Array.isArray(list) || list.length === 0) return null; // end of list / unrecognized shape

    const match = list.find((r) => String(r.email || '').toLowerCase() === email.toLowerCase());
    if (match) {
      return {
        joinLink: match.joinLink || match.joinlink || null,
        registerId: match.registerId || match.registerKey || null,
      };
    }

    if (list.length < pageSize) return null; // last page, no match
  }

  return null; // hit the safety cap without finding a match
}

function extractRegistrantList(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.registrant)) return json.registrant;
  if (Array.isArray(json.registrants)) return json.registrants;
  if (Array.isArray(json.registrationList)) return json.registrationList;
  if (Array.isArray(json.list)) return json.list;
  return null;
}

module.exports = {
  getAccessToken,
  zohoRequest,
  registerAttendee,
  findExistingRegistration,
  accountsUrl,
  webinarApiUrl,
};
