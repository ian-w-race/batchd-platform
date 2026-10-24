// recall-escalation.js: two crons running at the same minute must send each
// escalation email once (claim-before-send, 2026-10-24).
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

const require = createRequire(import.meta.url);

const get = (r, c) => c.split('.').reduce((o, k) => (o == null ? undefined : o[k]), r);

function makeDb(acks) {
  const rows = new Map(acks.map((a) => [a.id, { ...a }]));
  // A tiny stand-in for the supabase-js query builder: enough for the
  // select of notified acks, the conditional claim and the release.
  return {
    rows,
    from() {
      const st = { op: 'select', filters: [], patch: null, returning: false };
      const b = {
        select() { if (st.op === 'update') st.returning = true; return b; },
        update(p) { st.op = 'update'; st.patch = p; return b; },
        // Dotted names filter on the embedded row, as PostgREST does with !inner.
        eq(c, v) { st.filters.push((r) => get(r, c) === v); return b; },
        is(c, v) { st.filters.push((r) => (get(r, c) ?? null) === v); return b; },
        then(res, rej) {
          return Promise.resolve().then(async () => {
            // Random delay so the two simultaneous runs interleave.
            await new Promise((r) => setTimeout(r, Math.random() * 5));
            const hit = [...rows.values()].filter((r) => st.filters.every((f) => f(r)));
            if (st.op === 'update') {
              hit.forEach((r) => Object.assign(r, st.patch));
              return { data: st.returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
            }
            return { data: hit.filter((r) => r.status === 'notified').map((r) => ({ ...r })), error: null };
          }).then(res, rej);
        },
      };
      return b;
    },
  };
}

function loadHandler(db) {
  const origLoad = Module._load;
  Module._load = function (req, ...rest) {
    if (req === '@supabase/supabase-js') return { createClient: () => db };
    return origLoad.call(this, req, ...rest);
  };
  const path = require.resolve('../netlify/functions/recall-escalation.js');
  delete require.cache[path];
  try { return require(path).handler; } finally { Module._load = origLoad; }
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const ack = (id, publishedHoursAgo, extra = {}) => ({
  id, status: 'notified', created_at: hoursAgo(publishedHoursAgo), organisation_id: 'org',
  escalation_2h_sent_at: null, escalation_24h_sent_at: null,
  stores: { name: 'Store ' + id },
  recall_events: { id: 'ev', product_name: 'Romaine', lot_number: 'L1', severity: 'class_i',
                   published_at: hoursAgo(publishedHoursAgo), is_drill: false, closed_at: null },
  organisations: { name: 'Grocer', contact_email: 'ops@example.com' },
  ...extra,
});

test('two simultaneous runs send each escalation once', async () => {
  process.env.SUPABASE_SERVICE_KEY = 'test';
  delete process.env.SCHEDULED_FUNCTIONS_DISABLED;
  const db = makeDb([ack('a', 3), ack('b', 30)]);
  const sent = [];
  global.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body).subject); return { ok: true, json: async () => ({}) }; };
  const handler = loadHandler(db);
  const [r1, r2] = await Promise.all([handler({}), handler({})]);
  const b1 = JSON.parse(r1.body), b2 = JSON.parse(r2.body);
  assert.equal(sent.filter((s) => s.startsWith('[2h')).length, 2, 'one 2h email per ack (a and b)');
  assert.equal(sent.filter((s) => s.startsWith('[URGENT 24h')).length, 1, 'one 24h email (b only)');
  assert.equal(b1.sent2h + b2.sent2h, 2);
  assert.equal(b1.sent24h + b2.sent24h, 1);
  assert.ok(db.rows.get('a').escalation_2h_sent_at && !db.rows.get('a').escalation_24h_sent_at);
  assert.ok(db.rows.get('b').escalation_2h_sent_at && db.rows.get('b').escalation_24h_sent_at);
});

test('a failed send releases the claim so the next run retries', async () => {
  const db = makeDb([ack('c', 3)]);
  let fail = true;
  const sent = [];
  global.fetch = async (url, opts) => {
    if (fail) return { ok: false, status: 500, json: async () => ({ message: 'boom' }) };
    sent.push(JSON.parse(opts.body).subject);
    return { ok: true, json: async () => ({}) };
  };
  const handler = loadHandler(db);
  await handler({});
  assert.equal(db.rows.get('c').escalation_2h_sent_at, null, 'claim released after failure');
  fail = false;
  await handler({});
  assert.equal(sent.length, 1);
  assert.ok(db.rows.get('c').escalation_2h_sent_at);
});

test('already escalated rows are not emailed again', async () => {
  const db = makeDb([ack('d', 30, { escalation_2h_sent_at: hoursAgo(28), escalation_24h_sent_at: hoursAgo(5) })]);
  const sent = [];
  global.fetch = async () => { sent.push(1); return { ok: true, json: async () => ({}) }; };
  await loadHandler(db)({});
  assert.equal(sent.length, 0);
});

test('the disabled flag still skips the whole run', async () => {
  process.env.SCHEDULED_FUNCTIONS_DISABLED = 'true';
  const db = makeDb([ack('e', 3)]);
  const sent = [];
  global.fetch = async () => { sent.push(1); return { ok: true, json: async () => ({}) }; };
  const r = await loadHandler(db)({});
  delete process.env.SCHEDULED_FUNCTIONS_DISABLED;
  assert.match(r.body, /skipped/);
  assert.equal(sent.length, 0);
});

test('closed recalls and drills get no escalation email', async () => {
  delete process.env.SCHEDULED_FUNCTIONS_DISABLED;
  const base = ack('f', 30);
  const closed = ack('f', 30, { recall_events: { ...base.recall_events, closed_at: hoursAgo(1) } });
  const drill = ack('g', 30, { recall_events: { ...base.recall_events, is_drill: true } });
  const db = makeDb([closed, drill]);
  const sent = [];
  global.fetch = async () => { sent.push(1); return { ok: true, json: async () => ({}) }; };
  await loadHandler(db)({});
  assert.equal(sent.length, 0);
});
