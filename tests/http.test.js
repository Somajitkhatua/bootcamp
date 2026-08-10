const test = require('node:test');
const assert = require('node:assert/strict');
const { jsonResponse, handlePreflight, readJsonBody, getClientIp, corsHeaders } = require('../netlify/functions/_lib/http');

function fakeEvent(overrides) {
  return { httpMethod: 'POST', headers: {}, body: null, ...overrides };
}

test('corsHeaders allows the configured production origin', () => {
  const headers = corsHeaders(fakeEvent({ headers: { origin: 'https://events.revapex.ai' } }));
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://events.revapex.ai');
});

test('corsHeaders falls back to the default allow-list origin for unknown origins', () => {
  const headers = corsHeaders(fakeEvent({ headers: { origin: 'https://evil.example.com' } }));
  assert.notEqual(headers['Access-Control-Allow-Origin'], 'https://evil.example.com');
});

test('handlePreflight responds to OPTIONS and ignores other methods', () => {
  const res = handlePreflight(fakeEvent({ httpMethod: 'OPTIONS' }));
  assert.equal(res.statusCode, 204);
  assert.equal(handlePreflight(fakeEvent({ httpMethod: 'POST' })), null);
});

test('jsonResponse sets content-type and serializes the body', () => {
  const res = jsonResponse(fakeEvent(), 200, { ok: true, message: 'hi' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(res.body), { ok: true, message: 'hi' });
});

test('readJsonBody parses a valid JSON body', () => {
  const body = readJsonBody(fakeEvent({ body: JSON.stringify({ a: 1 }) }));
  assert.deepEqual(body, { a: 1 });
});

test('readJsonBody returns {} for an empty body (not an error)', () => {
  assert.deepEqual(readJsonBody(fakeEvent({ body: null })), {});
});

test('readJsonBody returns null for malformed JSON (signals a 400)', () => {
  assert.equal(readJsonBody(fakeEvent({ body: '{not json' })), null);
});

test('getClientIp reads the Netlify client-connection-ip header', () => {
  const ip = getClientIp(fakeEvent({ headers: { 'x-nf-client-connection-ip': '203.0.113.5' } }));
  assert.equal(ip, '203.0.113.5');
});

test('getClientIp returns null when no IP header is present', () => {
  assert.equal(getClientIp(fakeEvent()), null);
});
