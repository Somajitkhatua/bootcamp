const test = require('node:test');
const assert = require('node:assert/strict');

test('getEvent resolves the configured event using ZOHO_ZSOID fallback', () => {
  process.env.ZOHO_ZSOID = '999999';
  delete require.cache[require.resolve('../netlify/functions/_lib/eventsConfig')];
  const { getEvent } = require('../netlify/functions/_lib/eventsConfig');

  const cfg = getEvent('ai-app-bootcamp');
  assert.ok(cfg, 'expected ai-app-bootcamp to resolve');
  assert.equal(cfg.zohoWebinarKey, '1375301932');
  assert.equal(cfg.zohoZsoId, '999999');

  delete process.env.ZOHO_ZSOID;
});

test('getEvent returns null for an unknown eventId', () => {
  delete require.cache[require.resolve('../netlify/functions/_lib/eventsConfig')];
  const { getEvent } = require('../netlify/functions/_lib/eventsConfig');
  assert.equal(getEvent('does-not-exist'), null);
});

test('getEvent fails closed when no zsoid is resolvable (misconfiguration)', () => {
  delete process.env.ZOHO_ZSOID;
  delete require.cache[require.resolve('../netlify/functions/_lib/eventsConfig')];
  const { getEvent } = require('../netlify/functions/_lib/eventsConfig');
  assert.equal(getEvent('ai-app-bootcamp'), null);
});

test('getEvent rejects a non-string eventId without throwing', () => {
  delete require.cache[require.resolve('../netlify/functions/_lib/eventsConfig')];
  const { getEvent } = require('../netlify/functions/_lib/eventsConfig');
  assert.equal(getEvent(undefined), null);
  assert.equal(getEvent({}), null);
});
