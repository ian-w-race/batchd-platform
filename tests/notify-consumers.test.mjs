// notify-consumers.js: consumer recall notices (fixed 2026-10-24). A call
// stays inside Netlify's time limit, batches are paced for Resend, and a
// retried batch carries the same idempotency key so nobody is emailed twice.
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ORG = '22222222-2222-4222-8222-222222222222';
const REC = '33333333-3333-4333-8333-333333333333';

function world({ batchStatus = () => 200 } = {}) {
  const w = { batches: [] };
  global.fetch = async (url, opts = {}) => {
    url = String(url);
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => '' });
    if (url.includes('/auth/v1/user')) return reply(200, { id: 'u1' });
    if (url.includes('organisation_members')) return reply(200, [{ role: 'corp_admin' }]);
    if (url.includes('/rest/v1/organisations')) return reply(200, [{ name: 'Test Grocer' }]);
    if (url.includes('/rest/v1/recalls')) return reply(200, [{ product_name: 'Romaine', lot_number: 'L1', description: 'E. coli' }]);
    if (url.startsWith('https://api.resend.com/emails/batch')) {
      const sends = JSON.parse(opts.body);
      const status = batchStatus(w.batches.length);
      w.batches.push({ at: Date.now(), key: opts.headers['Idempotency-Key'], n: sends.length, status, subject: sends[0].subject });
      return reply(status, status < 300 ? { data: sends.map((_, i) => ({ id: 'e' + i })) } : { message: 'refused' });
    }
    if (url.startsWith('https://api.resend.com/emails')) throw new Error('single sends must not be used');
    return reply(404, {});
  };
  return w;
}

function load() {
  process.env.SUPABASE_SERVICE_KEY = 'svc';
  process.env.RESEND_API_KEY = 'rk';
  for (const p of ['../netlify/functions/notify-consumers.js', '../netlify/lib/auth.js']) delete require.cache[require.resolve(p)];
  return require('../netlify/functions/notify-consumers.js');
}
const call = (n, offset = 0) => ({
  httpMethod: 'POST', headers: { authorization: 'Bearer jwt' },
  body: JSON.stringify({ recall_event_id: REC, org_id: ORG,
    customers: Array.from({ length: n }, (_, i) => ({ email: `c${i + offset}@example.com`, name: 'C' })) }),
});

test('250 customers go out in 3 paced batches of up to 100', async () => {
  const w = world();
  const r = await load().handler(call(250));
  const b = JSON.parse(r.body);
  assert.equal(r.statusCode, 200);
  assert.deepEqual([b.sent, b.failed], [250, 0]);
  assert.deepEqual(w.batches.map((x) => x.n), [100, 100, 50]);
  for (let i = 1; i < w.batches.length; i++) assert.ok(w.batches[i].at - w.batches[i - 1].at >= 500, 'paced');
  assert.ok(!w.batches[0].subject.includes('—'), 'no em dash in the subject');
});

test('more than 500 customers in one call is refused', async () => {
  world();
  const r = await load().handler(call(501));
  assert.equal(r.statusCode, 413);
});

test('a retry sends the same idempotency keys', async () => {
  const w = world();
  const mod = load();
  await mod.handler(call(150));
  await mod.handler(call(150));
  const keys = w.batches.map((x) => x.key);
  assert.equal(keys.length, 4);
  assert.equal(keys[0], keys[2]);
  assert.equal(keys[1], keys[3]);
  assert.notEqual(keys[0], keys[1]);
});

test('a refused batch is counted as failed without single-send fallback', async () => {
  const w = world({ batchStatus: (i) => (i === 1 ? 422 : 200) });
  const r = await load().handler(call(200));
  const b = JSON.parse(r.body);
  assert.deepEqual([b.sent, b.failed], [100, 100]);
  assert.equal(w.batches.length, 2);
});

test('a rate-limited batch is retried once with the same key', async () => {
  const w = world({ batchStatus: (i) => (i === 0 ? 429 : 200) });
  const r = await load().handler(call(10));
  assert.equal(JSON.parse(r.body).sent, 10);
  assert.equal(w.batches.length, 2);
  assert.equal(w.batches[0].key, w.batches[1].key);
});

test('a null body is refused cleanly', async () => {
  world();
  const r = await load().handler({ httpMethod: 'POST', headers: {}, body: 'null' });
  assert.equal(r.statusCode, 400);
});
