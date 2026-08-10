const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidEmail, normalizeEmail, sanitizeString, validateRegistration, isLikelyBot } = require('../netlify/functions/_lib/validate');

test('isValidEmail accepts well-formed addresses', () => {
  assert.equal(isValidEmail('riya@example.com'), true);
  assert.equal(isValidEmail('a.b+c@sub.example.co.in'), true);
});

test('isValidEmail rejects malformed addresses', () => {
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('missing@tld'), false);
  assert.equal(isValidEmail('@example.com'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(null), false);
});

test('normalizeEmail lowercases and trims', () => {
  assert.equal(normalizeEmail('  RiYa@Example.COM  '), 'riya@example.com');
});

test('sanitizeString strips control chars and angle brackets, caps length', () => {
  assert.equal(sanitizeString('  <script>hi</script>  ', 50), 'scripthi/script');
  assert.equal(sanitizeString('a'.repeat(200), 10), 'a'.repeat(10));
});

test('validateRegistration accepts a full valid payload', () => {
  const res = validateRegistration({
    eventId: 'ai-app-bootcamp',
    firstName: 'Riya',
    lastName: 'Sharma',
    email: 'Riya@Example.com',
    phone: '+919876543210',
    city: 'Bengaluru',
    profession: 'student',
  });
  assert.equal(res.ok, true);
  assert.equal(res.data.email, 'riya@example.com');
  assert.equal(res.data.firstName, 'Riya');
});

test('validateRegistration allows missing lastName (optional)', () => {
  const res = validateRegistration({ eventId: 'x', firstName: 'Riya', email: 'riya@example.com' });
  assert.equal(res.ok, true);
  assert.equal(res.data.lastName, '');
});

test('validateRegistration rejects missing firstName', () => {
  const res = validateRegistration({ eventId: 'x', email: 'riya@example.com' });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /first name/i.test(e)));
});

test('validateRegistration rejects invalid email', () => {
  const res = validateRegistration({ eventId: 'x', firstName: 'Riya', email: 'not-an-email' });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /valid email/i.test(e)));
});

test('validateRegistration rejects missing eventId', () => {
  const res = validateRegistration({ firstName: 'Riya', email: 'riya@example.com' });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /eventId/i.test(e)));
});

test('validateRegistration rejects obvious spam content in name fields', () => {
  const res = validateRegistration({
    eventId: 'x',
    firstName: 'Buy now http://spam.example.com',
    email: 'spam@example.com',
  });
  assert.equal(res.ok, false);
});

test('isLikelyBot flags a filled honeypot', () => {
  assert.equal(isLikelyBot({ honeypot: 'http://spam.com', renderedAt: Date.now() - 5000 }), true);
});

test('isLikelyBot flags an implausibly fast submit', () => {
  assert.equal(isLikelyBot({ honeypot: '', renderedAt: Date.now() - 10 }), true);
});

test('isLikelyBot allows a normal human-paced submit', () => {
  assert.equal(isLikelyBot({ honeypot: '', renderedAt: Date.now() - 8000 }), false);
});

test('isLikelyBot tolerates a missing renderedAt (doesn\'t false-positive)', () => {
  assert.equal(isLikelyBot({ honeypot: '' }), false);
});
