// ---------------------------------------------------------------------------
// POST /api/webinar/register
//
// Frontend → this function → Zoho OAuth (via _lib/zoho.js) → Zoho Webinar
// Bulk Registration API → clean JSON response back to the frontend.
//
// Request body: { eventId, firstName, lastName, email, phone, city, company, profession, honeypot, renderedAt }
// Only eventId, firstName, and email are required; everything else is optional.
// The browser never sends (or sees) any Zoho identifier — eventId is looked
// up server-side against _lib/eventsConfig.json.
// ---------------------------------------------------------------------------

const { jsonResponse, handlePreflight, readJsonBody, getClientIp } = require('./_lib/http');
const { validateRegistration, isLikelyBot } = require('./_lib/validate');
const { getEvent } = require('./_lib/eventsConfig');
const { registerAttendee, findExistingRegistration } = require('./_lib/zoho');
const { checkRateLimit, logRegistration } = require('./_lib/store');

const MSG = {
  success: "Registration successful! Your webinar confirmation and joining details have been sent to your email.",
  duplicate: "You're already registered for this webinar. Please check your email for the webinar joining details.",
  failure: "We couldn't complete your registration right now. Please try again or contact support.",
  rateLimited: "Too many attempts. Please wait a few minutes and try again.",
  invalid: "Please check your details and try again.",
};

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'POST') {
    return jsonResponse(event, 405, { ok: false, message: MSG.invalid });
  }

  const ip = getClientIp(event);

  // -- Rate limit (best-effort; fails open if the store is unavailable) -----
  const rl = await checkRateLimit(ip);
  if (!rl.allowed) {
    return jsonResponse(event, 429, { ok: false, message: MSG.rateLimited });
  }

  // -- Parse + validate body --------------------------------------------------
  const body = readJsonBody(event);
  if (body === null) {
    return jsonResponse(event, 400, { ok: false, message: MSG.invalid });
  }

  if (isLikelyBot({ honeypot: body.honeypot, renderedAt: body.renderedAt })) {
    console.warn('Registration blocked by anti-spam heuristic', { ip: ip ? ip.slice(0, 7) + '…' : 'unknown' });
    return jsonResponse(event, 400, { ok: false, message: MSG.failure });
  }

  const validation = validateRegistration(body);
  if (!validation.ok) {
    return jsonResponse(event, 400, { ok: false, message: MSG.invalid, errors: validation.errors });
  }

  const { eventId, firstName, lastName, email, phone, city, company, profession } = validation.data;

  // -- Resolve event → Zoho identifiers (server-side only) --------------------
  const eventConfig = getEvent(eventId);
  if (!eventConfig) {
    console.error('Registration rejected: unknown or misconfigured eventId', { eventId });
    return jsonResponse(event, 400, { ok: false, message: MSG.invalid });
  }

  const auditBase = {
    eventId,
    firstName,
    lastName,
    email,
    phone,
    city,
    company,
    profession,
    createdAt: new Date().toISOString(),
  };

  try {
    // -- Duplicate check: avoid re-registering, return their existing link ----
    const existing = await findExistingRegistration(eventConfig, email).catch((err) => {
      console.error('Duplicate check failed, proceeding to register', { message: err.message });
      return null;
    });

    if (existing) {
      await logRegistration({ ...auditBase, status: 'duplicate', zoho_join_link: existing.joinLink, zoho_registration_id: existing.registerId });
      return jsonResponse(event, 200, {
        ok: true,
        duplicate: true,
        message: MSG.duplicate,
        joinLink: existing.joinLink || undefined,
      });
    }

    // -- Register with Zoho -----------------------------------------------------
    const result = await registerAttendee(eventConfig, { email, firstName, lastName }, { sendMail: true });

    if (result.ok) {
      const registrants = Array.isArray(result.json.registrant) ? result.json.registrant : [];
      const mine = registrants.find((r) => String(r.email || '').toLowerCase() === email) || registrants[0];
      const successCount = Number(result.json.successCount ?? result.json.registeredCount ?? 0);
      const failedCount = Number(result.json.failedCount ?? 0);

      if (successCount > 0 || (registrants.length > 0 && failedCount === 0)) {
        await logRegistration({
          ...auditBase,
          status: 'registered',
          zoho_join_link: mine && mine.joinLink,
          zoho_response: result.json,
        });
        return jsonResponse(event, 200, {
          ok: true,
          message: MSG.success,
          joinLink: (mine && mine.joinLink) || undefined,
        });
      }

      // failedCount > 0 with no explicit duplicate error code documented by
      // Zoho — heuristically detect "already registered" style messages.
      const raw = JSON.stringify(result.json).toLowerCase();
      const looksDuplicate = raw.includes('already') || raw.includes('duplicate');

      await logRegistration({ ...auditBase, status: looksDuplicate ? 'duplicate' : 'failed', zoho_response: result.json });

      return jsonResponse(event, looksDuplicate ? 200 : 502, {
        ok: looksDuplicate,
        duplicate: looksDuplicate,
        message: looksDuplicate ? MSG.duplicate : MSG.failure,
      });
    }

    // Non-2xx from Zoho — log status + safe error code only, never raw body to client.
    console.error('Zoho registration call failed', { status: result.status, eventId });
    await logRegistration({ ...auditBase, status: 'failed', zoho_response: result.json });
    return jsonResponse(event, 502, { ok: false, message: MSG.failure });
  } catch (err) {
    console.error('Registration handler error', { message: err.message, eventId });
    await logRegistration({ ...auditBase, status: 'error', error_message: err.message }).catch(() => {});
    return jsonResponse(event, 500, { ok: false, message: MSG.failure });
  }
};
