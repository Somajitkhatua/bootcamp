// ---------------------------------------------------------------------------
// Server-side event → Zoho Webinar mapping.
//
// The browser only ever sends an `eventId` string. This file resolves that
// id to the actual Zoho identifiers needed to call the Webinar API. None of
// this data reaches frontend JavaScript.
//
// TO ADD A NEW EVENT: add an object to eventsConfig.json with a new eventId,
// the Zoho webinarKey (visible in the Zoho Webinar dashboard / API), and
// zohoInstanceId if it's a recurring webinar occurrence. Leave zohoZsoId
// blank to fall back to the shared ZOHO_ZSOID env var (one Zoho org usually
// hosts every webinar, so most setups never need to override it per event).
// Set "active": false to retire an event without deleting its config.
// ---------------------------------------------------------------------------

const events = require('./eventsConfig.json');

if (!Array.isArray(events)) {
  throw new Error('eventsConfig.json must be a JSON array of event objects');
}

/**
 * Resolve an eventId (as sent by the browser) to its full Zoho config.
 * Returns null if the event doesn't exist, is inactive, or is missing a
 * required identifier (webinarKey, or a resolvable zsoid) — callers must
 * treat null as "reject the request", never fall back to a default event.
 */
function getEvent(eventId) {
  if (!eventId || typeof eventId !== 'string') return null;

  const found = events.find((e) => e.eventId === eventId);
  if (!found) return null;
  if (found.active === false) return null;

  const zohoZsoId = (found.zohoZsoId && String(found.zohoZsoId).trim()) || process.env.ZOHO_ZSOID || '';
  const zohoWebinarKey = found.zohoWebinarKey ? String(found.zohoWebinarKey).trim() : '';

  if (!zohoZsoId || !zohoWebinarKey) return null; // misconfigured — fail closed

  return {
    eventId: found.eventId,
    eventName: found.eventName || found.eventId,
    zohoZsoId,
    zohoWebinarKey,
    zohoInstanceId: found.zohoInstanceId ? String(found.zohoInstanceId).trim() : undefined,
  };
}

function listActiveEventIds() {
  return events.filter((e) => e.active !== false).map((e) => e.eventId);
}

module.exports = { getEvent, listActiveEventIds };
