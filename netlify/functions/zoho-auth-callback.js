// ---------------------------------------------------------------------------
// GET /api/auth/zoho/callback
//
// Production OAuth redirect URI (must match exactly what's registered in
// the Zoho API Console): https://events.revapex.ai/api/auth/zoho/callback
//
// Zoho redirects here once, right after the site owner approves consent at
// /api/auth/zoho/start. This exchanges the authorization code for tokens,
// shows the refresh token ONCE (nothing is persisted here — it must be
// copied into Netlify's environment variables by hand), and best-effort
// discovers the account's zsoid + webinar list to save manual digging.
//
// This is an internal setup utility, not a user-facing page — it renders
// plain server-side HTML with no external resources.
// ---------------------------------------------------------------------------

function redirectUri() {
  const base = (process.env.PUBLIC_BASE_URL || 'https://events.revapex.ai').replace(/\/+$/, '');
  return `${base}/api/auth/zoho/callback`;
}

function html(body, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body: `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<title>Zoho Webinar — OAuth setup</title>
<style>
  body{font:15px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#0f1e3a}
  h1{font-size:1.3rem} h2{font-size:1.05rem;margin-top:28px}
  code,pre{background:#f2f4f8;border:1px solid #dde3ee;border-radius:6px;padding:2px 6px;word-break:break-all}
  pre{padding:14px;overflow:auto}
  .warn{background:#fff7e6;border:1px solid #f3c969;border-radius:8px;padding:14px 16px;margin:16px 0}
  .err{background:#fdeceb;border:1px solid #f3a6a0;border-radius:8px;padding:14px 16px}
  table{border-collapse:collapse;width:100%} td,th{border:1px solid #dde3ee;padding:6px 10px;text-align:left;font-size:.92rem}
</style></head><body>${body}</body></html>`,
  };
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const setupSecret = process.env.ZOHO_SETUP_SECRET;

  if (!setupSecret || qs.state !== setupSecret) {
    return html('<h1>Forbidden</h1><p>Missing or invalid state. Start over from <code>/api/auth/zoho/start?key=...</code>.</p>', 403);
  }

  if (qs.error) {
    return html(`<h1>Zoho declined authorization</h1><p><code>${qs.error}</code></p>`, 400);
  }
  if (!qs.code) {
    return html('<h1>Missing authorization code</h1><p>Start over from <code>/api/auth/zoho/start?key=...</code>.</p>', 400);
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const accountsUrl = (process.env.ZOHO_ACCOUNTS_URL || '').replace(/\/+$/, '');
  const webinarApiUrl = (process.env.ZOHO_WEBINAR_API_URL || '').replace(/\/+$/, '');

  if (!clientId || !clientSecret || !accountsUrl) {
    return html('<h1>Server not configured</h1><p>ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_ACCOUNTS_URL must be set in Netlify env vars.</p>', 500);
  }

  // -- Exchange the authorization code for tokens --------------------------
  let tokenJson;
  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      code: qs.code,
    });
    const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    tokenJson = await res.json();
    if (!res.ok || !tokenJson.refresh_token) {
      console.error('Zoho token exchange failed', { status: res.status, error: tokenJson.error || 'unknown' });
      return html(`<div class="err"><h1>Token exchange failed</h1><p>Zoho error: <code>${tokenJson.error || res.status}</code></p>
        <p>Common cause: the redirect URI Zoho has on file for this client doesn't exactly match
        <code>${redirectUri()}</code>. Check the Zoho API Console.</p></div>`, 502);
    }
  } catch (err) {
    console.error('Zoho token exchange errored', { message: err.message });
    return html('<div class="err"><h1>Token exchange errored</h1><p>See function logs for details.</p></div>', 500);
  }

  const accessToken = tokenJson.access_token;

  // -- Best-effort discovery: zsoid + webinar list --------------------------
  // Not fully confirmed against Zoho's public docs for this exact product —
  // shown as a convenience; falls back to manual instructions if it 404s.
  let zsoId = null;
  let discoveryNote = '';
  let webinarRows = '';

  if (webinarApiUrl) {
    for (const candidate of ['/user.json', '/users/me.json', '/currentuser.json']) {
      try {
        const r = await fetch(`${webinarApiUrl}${candidate}`, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'X-ZSOURCE': process.env.ZOHO_X_ZSOURCE || 'RevApexAI' },
        });
        if (r.ok) {
          const j = await r.json();
          zsoId = j.zsoid || j.zsoId || (j.user && (j.user.zsoid || j.user.zsoId)) || null;
          if (zsoId) break;
        }
      } catch (_) { /* try next candidate */ }
    }

    if (zsoId) {
      try {
        const r = await fetch(`${webinarApiUrl}/${zsoId}/webinar.json`, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'X-ZSOURCE': process.env.ZOHO_X_ZSOURCE || 'RevApexAI' },
        });
        if (r.ok) {
          const j = await r.json();
          const list = Array.isArray(j.webinar) ? j.webinar : Array.isArray(j.webinars) ? j.webinars : [];
          webinarRows = list
            .map((w) => `<tr><td>${w.topic || w.title || ''}</td><td><code>${w.webinarKey || w.webinarId || ''}</code></td></tr>`)
            .join('');
        }
      } catch (_) { /* best effort only */ }
    } else {
      discoveryNote = '<p><em>Could not auto-discover your zsoid from any known endpoint — this is unverified against Zoho\'s docs for this product. Find it manually: log into webinar.zoho.in, open DevTools → Network while browsing your webinar list, and look for the numeric zsoid segment in any <code>/api/v2/&lt;zsoid&gt;/...</code> request URL.</em></p>';
    }
  }

  return html(`
    <h1>Zoho Webinar — OAuth setup complete</h1>
    <div class="warn"><strong>Copy the values below into Netlify now.</strong> This page is not saved anywhere and won't show the refresh token again.</div>

    <h2>1. ZOHO_REFRESH_TOKEN</h2>
    <pre>${tokenJson.refresh_token}</pre>

    <h2>2. Granted scope</h2>
    <pre>${tokenJson.scope || '(not returned)'}</pre>

    <h2>3. ZOHO_ZSOID</h2>
    ${zsoId ? `<pre>${zsoId}</pre>` : discoveryNote}

    <h2>4. Webinars found in this account (confirm your webinarKey)</h2>
    ${webinarRows ? `<table><tr><th>Topic</th><th>webinarKey</th></tr>${webinarRows}</table>` : '<p><em>None discovered automatically. Check the webinar\'s settings page in webinar.zoho.in for its ID, or the API docs for the list-webinars endpoint.</em></p>'}

    <h2>Next steps</h2>
    <ol>
      <li>Netlify → Site configuration → Environment variables → set <code>ZOHO_REFRESH_TOKEN</code> (and <code>ZOHO_ZSOID</code> if shown above).</li>
      <li>Confirm <code>eventsConfig.json</code>'s <code>zohoWebinarKey</code> matches a row in the table above.</li>
      <li><strong>Remove or rotate <code>ZOHO_SETUP_SECRET</code></strong> so this bootstrap flow can't be re-triggered.</li>
      <li>Redeploy the site.</li>
    </ol>
  `);
};
