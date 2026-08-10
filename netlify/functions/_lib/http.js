// ---------------------------------------------------------------------------
// Small HTTP helpers shared by every function: CORS, JSON responses, safe
// body parsing, client IP extraction. No Zoho-specific logic lives here.
// ---------------------------------------------------------------------------

// Same-origin in production (frontend and functions both serve from
// events.revapex.ai via netlify.toml redirects), but we still set an
// explicit CORS allow-list rather than "*" — defense in depth, and it lets
// the site be previewed from a Netlify deploy-preview subdomain too.
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || 'https://events.revapex.ai'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function resolveOrigin(event) {
  const requestOrigin = event.headers && (event.headers.origin || event.headers.Origin);
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  // Allow Netlify deploy previews (*.netlify.app) for staging/testing.
  if (requestOrigin && /^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/i.test(requestOrigin)) {
    return requestOrigin;
  }
  return ALLOWED_ORIGINS[0];
}

function corsHeaders(event) {
  return {
    'Access-Control-Allow-Origin': resolveOrigin(event),
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonResponse(event, statusCode, bodyObj, extraHeaders) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(event),
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(bodyObj),
  };
}

function handlePreflight(event) {
  if (event.httpMethod !== 'OPTIONS') return null;
  return { statusCode: 204, headers: corsHeaders(event), body: '' };
}

function readJsonBody(event) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return null; // signals "malformed JSON" to the caller
  }
}

function getClientIp(event) {
  const h = event.headers || {};
  const fwd = h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || h['client-ip'];
  if (!fwd) return null;
  return String(fwd).split(',')[0].trim();
}

module.exports = { jsonResponse, handlePreflight, readJsonBody, getClientIp, corsHeaders };
