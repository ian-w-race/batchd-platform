// ocr.js: the scanner's sign-in warm-up must answer at once, without the
// auth check and without calling Anthropic (2026-10-24).
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

const require = createRequire(import.meta.url);

function load(authCalls) {
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (req === '../lib/auth') {
      return {
        requireAi: async (event, orgId) => { authCalls.push(orgId); return { error: 'org_id required.', status: 400 }; },
        json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      };
    }
    return orig.call(this, req, ...rest);
  };
  const p = require.resolve('../netlify/functions/ocr.js');
  delete require.cache[p];
  try { return require(p).handler; } finally { Module._load = orig; }
}

test('warmup answers 204 without auth and without Anthropic', async () => {
  const authCalls = [];
  let anthropicCalls = 0;
  global.fetch = async () => { anthropicCalls++; return { ok: true, json: async () => ({}) }; };
  const handler = load(authCalls);
  const r = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ task: 'warmup' }) });
  assert.equal(r.statusCode, 204);
  assert.equal(authCalls.length, 0);
  assert.equal(anthropicCalls, 0);
});

test('every other task still goes through the auth gate first', async () => {
  const authCalls = [];
  let anthropicCalls = 0;
  global.fetch = async () => { anthropicCalls++; return { ok: true, json: async () => ({}) }; };
  const handler = load(authCalls);
  const r = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ task: 'identify_product', image: 'abc', org_id: null }) });
  assert.equal(r.statusCode, 400);
  assert.equal(authCalls.length, 1);
  assert.equal(anthropicCalls, 0);
});

test('GET is still refused', async () => {
  const handler = load([]);
  const r = await handler({ httpMethod: 'GET', headers: {}, body: '' });
  assert.equal(r.statusCode, 405);
});
