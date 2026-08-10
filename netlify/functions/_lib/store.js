// ---------------------------------------------------------------------------
// Persistence layer.
//
// This site has no existing database — it's a static page on Netlify. Rather
// than bolt on a new external database service, this uses Netlify Blobs
// (built into the same Netlify account/deploy, zero extra infra to run)
// for three things: caching the Zoho access token between invocations,
// best-effort rate limiting, and an append-only registration audit log
// (the closest equivalent to the "event-registration table" requirement).
//
// IMPORTANT: every call here is wrapped so a Blobs outage NEVER blocks a
// real registration. Rate limiting and audit logging fail OPEN — if the
// store is unavailable, registrations still go through against Zoho; only
// the secondary bookkeeping is skipped. See README "Assumptions &
// limitations" for the tradeoff and how to swap in a real database later.
// ---------------------------------------------------------------------------

let getStoreFn = null;
try {
  ({ getStore: getStoreFn } = require('@netlify/blobs'));
} catch (_) {
  getStoreFn = null; // package not installed / not resolvable — degrade gracefully
}

function store(name) {
  if (!getStoreFn) return null;
  try {
    return getStoreFn(name);
  } catch (_) {
    return null; // e.g. running outside a Netlify runtime context
  }
}

async function safeGetJSON(storeName, key) {
  const s = store(storeName);
  if (!s) return null;
  try {
    return await s.get(key, { type: 'json' });
  } catch (_) {
    return null;
  }
}

async function safeSetJSON(storeName, key, value) {
  const s = store(storeName);
  if (!s) return false;
  try {
    await s.setJSON(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

// ---- Zoho access token cache -----------------------------------------------

async function getCachedAccessToken() {
  const cached = await safeGetJSON('zoho-oauth', 'access_token');
  if (cached && typeof cached.expiresAt === 'number' && Date.now() < cached.expiresAt - 60_000) {
    return cached.accessToken;
  }
  return null;
}

async function setCachedAccessToken(accessToken, expiresInSeconds) {
  await safeSetJSON('zoho-oauth', 'access_token', {
    accessToken,
    expiresAt: Date.now() + Number(expiresInSeconds || 3600) * 1000,
  });
}

// ---- Best-effort rate limiting ---------------------------------------------

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 5; // registrations per IP per window

async function checkRateLimit(ip) {
  if (!ip) return { allowed: true, degraded: true }; // unknown IP: fail open, can't key on it

  const key = `rl:${ip}`;
  const now = Date.now();
  const existing = (await safeGetJSON('rate-limits', key)) || { windowStart: now, count: 0 };

  if (now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    existing.windowStart = now;
    existing.count = 0;
  }
  existing.count += 1;

  const wrote = await safeSetJSON('rate-limits', key, existing);
  if (!wrote) return { allowed: true, degraded: true }; // store unavailable: fail open

  return { allowed: existing.count <= RATE_LIMIT_MAX, count: existing.count };
}

// ---- Registration audit log -------------------------------------------------

async function logRegistration(record) {
  const safeEmailKey = String(record.email || 'unknown').replace(/[^a-z0-9@._-]/gi, '_');
  const key = `${record.eventId || 'unknown'}/${safeEmailKey}/${Date.now()}`;
  await safeSetJSON('registrations', key, record);
}

module.exports = {
  getCachedAccessToken,
  setCachedAccessToken,
  checkRateLimit,
  logRegistration,
  RATE_LIMIT_MAX,
};
