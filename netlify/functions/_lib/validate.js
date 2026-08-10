// ---------------------------------------------------------------------------
// Input validation, normalization, and basic bot/spam heuristics for the
// registration endpoint. Pure functions — no network, no Zoho knowledge.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const MAX_NAME_LEN = 80;
const MAX_EMAIL_LEN = 254;
const MAX_FREEFORM_LEN = 120;
const MIN_FORM_FILL_MS = 1500; // reject submissions faster than a human could plausibly type

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function stripControlChars(v) {
  // Strip ASCII control chars and angle brackets (blocks trivial HTML/script injection
  // into fields that later get echoed into emails, logs, or an admin UI).
  return v.replace(/[\x00-\x1F\x7F<>]/g, '');
}

function sanitizeString(v, maxLen) {
  const cleaned = stripControlChars(trim(v)).slice(0, maxLen);
  return cleaned;
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= MAX_EMAIL_LEN && EMAIL_RE.test(email);
}

function normalizeEmail(email) {
  return trim(email).toLowerCase();
}

/** Very cheap spam signal: URLs or repeated field content in name-ish fields. */
function looksLikeSpamText(v) {
  if (!v) return false;
  return /https?:\/\//i.test(v) || /\[url=/i.test(v) || /<a\s/i.test(v);
}

/**
 * Validates and normalizes a registration payload.
 * Returns { ok: true, data } or { ok: false, errors: string[] }.
 */
function validateRegistration(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['Malformed request body.'] };
  }

  const eventId = trim(body.eventId);
  if (!eventId) errors.push('eventId is required.');

  const firstName = sanitizeString(body.firstName, MAX_NAME_LEN);
  if (!firstName) errors.push('First name is required.');

  const lastName = sanitizeString(body.lastName, MAX_NAME_LEN); // optional

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) errors.push('A valid email address is required.');

  const phone = sanitizeString(body.phone, MAX_FREEFORM_LEN); // optional
  const city = sanitizeString(body.city, MAX_FREEFORM_LEN); // optional
  const company = sanitizeString(body.company, MAX_FREEFORM_LEN); // optional
  const profession = sanitizeString(body.profession, 40); // optional

  if (looksLikeSpamText(firstName) || looksLikeSpamText(lastName) || looksLikeSpamText(company)) {
    errors.push('Submission rejected.');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    data: { eventId, firstName, lastName, email, phone, city, company, profession },
  };
}

/**
 * Honeypot + time-to-submit check. `honeypot` must be a hidden form field
 * that's empty for humans and irresistible for naive bots to fill.
 * `renderedAt` is a client-supplied epoch-ms timestamp of when the form
 * appeared; missing it is tolerated (some privacy tooling strips fields),
 * but an implausibly fast submit with a present, valid timestamp is rejected.
 */
function isLikelyBot({ honeypot, renderedAt }) {
  if (honeypot && String(honeypot).trim().length > 0) return true;

  const ts = Number(renderedAt);
  if (Number.isFinite(ts) && ts > 0) {
    const elapsed = Date.now() - ts;
    if (elapsed >= 0 && elapsed < MIN_FORM_FILL_MS) return true;
  }

  return false;
}

module.exports = {
  isValidEmail,
  normalizeEmail,
  sanitizeString,
  validateRegistration,
  isLikelyBot,
  MIN_FORM_FILL_MS,
};
