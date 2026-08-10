// ---------------------------------------------------------------------------
// GET /api/auth/zoho/start?key=<ZOHO_SETUP_SECRET>
//
// One-time bootstrap route: redirects the site owner into Zoho's OAuth
// consent screen so we can obtain a refresh token (access_type=offline).
// This is NOT part of the runtime registration flow — once ZOHO_REFRESH_TOKEN
// is set in Netlify's environment variables, this route is never needed
// again. Guarded by ZOHO_SETUP_SECRET so it isn't a public, permanently
// discoverable "start OAuth" endpoint; unset ZOHO_SETUP_SECRET after
// bootstrapping to close it.
// ---------------------------------------------------------------------------

const SCOPES = [
  'ZohoWebinar.webinar.CREATE',
  'ZohoWebinar.webinar.READ',
  'ZohoWebinar.manageOrg.READ', // used once, by the callback, to discover zsoid
].join(',');

function redirectUri() {
  const base = (process.env.PUBLIC_BASE_URL || 'https://events.revapex.ai').replace(/\/+$/, '');
  return `${base}/api/auth/zoho/callback`;
}

exports.handler = async (event) => {
  const setupSecret = process.env.ZOHO_SETUP_SECRET;
  const key = (event.queryStringParameters || {}).key;

  if (!setupSecret) {
    return { statusCode: 404, body: 'Not found.' };
  }
  if (!key || key !== setupSecret) {
    return { statusCode: 403, body: 'Forbidden.' };
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const accountsUrl = (process.env.ZOHO_ACCOUNTS_URL || '').replace(/\/+$/, '');
  if (!clientId || !accountsUrl) {
    return { statusCode: 500, body: 'ZOHO_CLIENT_ID / ZOHO_ACCOUNTS_URL are not configured.' };
  }

  const authUrl = new URL(`${accountsUrl}/oauth/v2/auth`);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri());
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', setupSecret); // verified again on callback

  return {
    statusCode: 302,
    headers: { Location: authUrl.toString(), 'Cache-Control': 'no-store' },
    body: '',
  };
};
