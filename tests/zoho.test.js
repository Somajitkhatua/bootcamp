// Verifies request-building/response-parsing logic against a MOCKED fetch —
// no real network calls, no real Zoho credentials. This cannot verify the
// live Zoho account (webinarKey, zsoid, actual API behavior) — see README
// "Assumptions & limitations" and the manual end-to-end test procedure.

const test = require('node:test');
const assert = require('node:assert/strict');

async function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; process.env[k] = vars[k]; }
  try {
    return await fn(); // must await here — returning the bare promise would let `finally` restore env vars before fn's body actually runs
  } finally {
    for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}

function freshZoho() {
  delete require.cache[require.resolve('../netlify/functions/_lib/zoho')];
  delete require.cache[require.resolve('../netlify/functions/_lib/store')];
  return require('../netlify/functions/_lib/zoho');
}

test('getAccessToken POSTs the refresh_token grant to the correct token endpoint', async () => {
  await withEnv(
    {
      ZOHO_CLIENT_ID: 'test-client-id',
      ZOHO_CLIENT_SECRET: 'test-secret',
      ZOHO_REFRESH_TOKEN: 'test-refresh',
      ZOHO_ACCOUNTS_URL: 'https://accounts.zoho.in',
      ZOHO_WEBINAR_API_URL: 'https://webinar.zoho.in/api/v2',
    },
    async () => {
      const zoho = freshZoho();
      const calls = [];
      const originalFetch = global.fetch;
      global.fetch = async (url, opts) => {
        calls.push({ url: String(url), opts });
        return { ok: true, json: async () => ({ access_token: 'fake-access-token', expires_in: 3600 }) };
      };
      try {
        const token = await zoho.getAccessToken();
        assert.equal(token, 'fake-access-token');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'https://accounts.zoho.in/oauth/v2/token');
        assert.equal(calls[0].opts.method, 'POST');
        const body = calls[0].opts.body;
        assert.ok(body.includes('grant_type=refresh_token'));
        assert.ok(body.includes('client_id=test-client-id'));
        assert.ok(body.includes('refresh_token=test-refresh'));
      } finally {
        global.fetch = originalFetch;
      }
    }
  );
});

test('registerAttendee calls the documented bulk-registration endpoint with the right shape', async () => {
  await withEnv(
    {
      ZOHO_CLIENT_ID: 'id',
      ZOHO_CLIENT_SECRET: 'secret',
      ZOHO_REFRESH_TOKEN: 'refresh',
      ZOHO_ACCOUNTS_URL: 'https://accounts.zoho.in',
      ZOHO_WEBINAR_API_URL: 'https://webinar.zoho.in/api/v2',
    },
    async () => {
      const zoho = freshZoho();
      const calls = [];
      const originalFetch = global.fetch;
      global.fetch = async (url, opts) => {
        calls.push({ url: String(url), opts });
        if (String(url).includes('/oauth/v2/token')) {
          return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              registrant: [{ email: 'riya@example.com', joinLink: 'https://webinar.zoho.in/join/abc' }],
              successCount: 1,
              failedCount: 0,
              totalCount: 1,
              registeredCount: 1,
            }),
        };
      };
      try {
        const eventConfig = { zohoZsoId: '12345', zohoWebinarKey: '1375301932' };
        const result = await zoho.registerAttendee(eventConfig, { email: 'riya@example.com', firstName: 'Riya', lastName: 'Sharma' });

        const registerCall = calls.find((c) => c.url.includes('/register/'));
        assert.ok(registerCall, 'expected a call to the register endpoint');
        assert.equal(registerCall.url.startsWith('https://webinar.zoho.in/api/v2/12345/register/1375301932.json'), true);
        assert.equal(registerCall.opts.method, 'POST');
        assert.equal(registerCall.opts.headers.Authorization, 'Zoho-oauthtoken tok');
        assert.equal(registerCall.opts.headers['X-ZSOURCE'], 'RevApexAI');
        const sentBody = JSON.parse(registerCall.opts.body);
        assert.deepEqual(sentBody, { registrant: [{ email: 'riya@example.com', firstName: 'Riya', lastName: 'Sharma' }] });

        assert.equal(result.ok, true);
        assert.equal(result.json.successCount, 1);
        assert.equal(result.json.registrant[0].joinLink, 'https://webinar.zoho.in/join/abc');
      } finally {
        global.fetch = originalFetch;
      }
    }
  );
});

test('findExistingRegistration returns null (not throw) when the list endpoint 404s', async () => {
  await withEnv(
    {
      ZOHO_CLIENT_ID: 'id',
      ZOHO_CLIENT_SECRET: 'secret',
      ZOHO_REFRESH_TOKEN: 'refresh',
      ZOHO_ACCOUNTS_URL: 'https://accounts.zoho.in',
      ZOHO_WEBINAR_API_URL: 'https://webinar.zoho.in/api/v2',
    },
    async () => {
      const zoho = freshZoho();
      const originalFetch = global.fetch;
      global.fetch = async (url) => {
        if (String(url).includes('/oauth/v2/token')) {
          return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
        }
        return { ok: false, status: 404, text: async () => '' };
      };
      try {
        const result = await zoho.findExistingRegistration({ zohoZsoId: '1', zohoWebinarKey: '2' }, 'riya@example.com');
        assert.equal(result, null);
      } finally {
        global.fetch = originalFetch;
      }
    }
  );
});
