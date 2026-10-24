// triage-complaint.js: the public and staff complaint intake (fixed 2026-10-24).
// Every form field reaches its column, an odd AI answer cannot break the save,
// a failed email is not logged as sent, and the critical alert goes first.
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ORG = '11111111-1111-4111-8111-111111111111';
const LEVELS = ['critical', 'serious', 'monitor', 'pending'];

// One fake fetch for Supabase REST, Anthropic, Resend and notify-event.
function world({ ai, resendOk = true } = {}) {
  const w = { inserts: [], updates: [], emails: [], order: [] };
  global.fetch = async (url, opts = {}) => {
    url = String(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
    if (url.startsWith('https://api.anthropic.com')) {
      w.order.push('anthropic');
      if (ai === 'http-error') return reply(529, { type: 'error' });
      return reply(200, { content: [{ text: typeof ai === 'string' ? ai : JSON.stringify(ai) }] });
    }
    if (url.startsWith('https://api.resend.com')) {
      w.order.push('email:' + body.subject);
      w.emails.push(body);
      return resendOk ? reply(200, { id: 'e1' }) : reply(422, { message: 'domain not verified' });
    }
    if (url.includes('/.netlify/functions/notify-event')) { w.order.push('notify-event'); return reply(200, { ok: true }); }
    const m = url.match(/\/rest\/v1\/([a-z_]+)/);
    const table = m && m[1];
    if (method === 'POST') {
      w.inserts.push({ table, row: body });
      if (table === 'complaints') return reply(201, [{ id: 'c1', complaint_number: 'CMP-TEST', ...body }]);
      return reply(201, [{ id: 'x' }]);
    }
    if (method === 'PATCH') {
      // The complaints CHECK on triage_level, as the database enforces it.
      if (table === 'complaints' && 'triage_level' in body && !LEVELS.includes(body.triage_level)) {
        return reply(400, { code: '23514', message: 'violates check constraint' });
      }
      w.updates.push({ table, patch: body });
      return reply(204, null);
    }
    if (table === 'organisations') {
      if (url.includes('select=plan')) return reply(200, [{ plan: 'pov' }]);
      return reply(200, [{ id: ORG, name: 'Test Grocer', type: 'retailer', contact_email: 'ops@example.com' }]);
    }
    return reply(200, []);
  };
  return w;
}

function load() {
  process.env.SUPABASE_SERVICE_KEY = 'svc';
  process.env.ANTHROPIC_API_KEY = 'ak';
  process.env.RESEND_API_KEY = 'rk';
  process.env.INTERNAL_NOTIFY_SECRET = 's'.repeat(32);
  for (const p of ['../netlify/functions/triage-complaint.js', '../netlify/lib/auth.js']) delete require.cache[require.resolve(p)];
  return require('../netlify/functions/triage-complaint.js');
}

const post = (extra = {}) => ({
  httpMethod: 'POST',
  headers: { 'x-nf-client-connection-ip': '203.0.113.' + Math.floor(Math.random() * 200) },
  body: JSON.stringify({
    receiving_org_id: ORG, complaint_text: 'My child vomited after eating this spinach.',
    product_name: 'Baby spinach 5 oz', lot_number: 'L123', customer_email: 'shopper@example.com',
    customer_name: 'Pat Doe', store_name: 'Main St', purchase_city: 'Austin', purchase_state: 'TX',
    country: 'US', best_before_date: '2026-11-02', purchase_date: '2026-10-20',
    people_affected: '2', medical_attention: 'doctor_visit', storage_method: 'refrigerated',
    still_has_product: true, lang: 'en', ...extra,
  }),
});
const AI_CRITICAL = { triage_level: 'critical', triage_category: 'Illness/Injury', triage_summary: 'Illness reported.',
  keywords_detected: ['vomited'], follow_up_type: 'illness', recall_flag: false, severity_factors: ['illness'] };

test('every form field reaches its complaints column', async () => {
  const w = world({ ai: AI_CRITICAL });
  const r = await load().handler(post());
  assert.equal(r.statusCode, 200, r.body);
  const row = w.inserts.find((i) => i.table === 'complaints').row;
  for (const [k, v] of Object.entries({ store_name: 'Main St', purchase_store: 'Main St', purchase_city: 'Austin',
    purchase_state: 'TX', country: 'US', best_before_date: '2026-11-02', purchase_date: '2026-10-20',
    people_affected: '2', medical_attention: 'doctor_visit', storage_method: 'refrigerated', lang: 'en' })) {
    assert.equal(row[k], v, k);
  }
  const triaged = w.updates.find((u) => u.patch.status === 'triaged').patch;
  assert.ok(triaged.smart_matches && Array.isArray(triaged.smart_matches.products), 'matches saved');
});

test('a date that is not a real calendar date is dropped, not sent to the date column', async () => {
  const w = world({ ai: AI_CRITICAL });
  const r = await load().handler(post({ best_before_date: '2026-02-31', purchase_date: 'last week' }));
  assert.equal(r.statusCode, 200, r.body);
  const row = w.inserts.find((i) => i.table === 'complaints').row;
  assert.equal(row.best_before_date, null);
  assert.equal(row.purchase_date, null);
  const { D } = load()._test;
  assert.equal(D('2028-02-29'), '2028-02-29');
  assert.equal(D('2027-02-29'), null);
});

test('an AI level outside the allowed list falls back instead of failing the save', async () => {
  const w = world({ ai: { ...AI_CRITICAL, triage_level: 'High' } });
  const r = await load().handler(post());
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(JSON.parse(r.body).triage_level, 'serious');
  assert.equal(w.updates.find((u) => u.patch.status === 'triaged').patch.triage_level, 'serious');
});

test('an upper-case AI level and prose around the JSON are accepted', async () => {
  world({ ai: 'Here is the assessment:\n' + JSON.stringify({ ...AI_CRITICAL, triage_level: 'CRITICAL' }) });
  const r = await load().handler(post());
  assert.equal(JSON.parse(r.body).triage_level, 'critical');
});

test('an Anthropic error status uses the manual-review fallback', async () => {
  world({ ai: 'http-error' });
  const r = await load().handler(post());
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(JSON.parse(r.body).triage_summary, 'Manual review required.');
});

test('the critical alert is sent before the follow-up email', async () => {
  const w = world({ ai: AI_CRITICAL });
  await load().handler(post());
  const alert = w.order.findIndex((o) => o.startsWith('email:CRITICAL'));
  const followUp = w.order.findIndex((o) => o.startsWith('email:Important'));
  const notify = w.order.indexOf('notify-event');
  assert.ok(alert >= 0 && followUp >= 0, w.order.join(', '));
  assert.ok(alert < followUp && alert < notify, w.order.join(', '));
});

test('a refused email is not logged as sent', async () => {
  const w = world({ ai: AI_CRITICAL, resendOk: false });
  const r = await load().handler(post());
  assert.equal(r.statusCode, 200, r.body);
  const actions = w.inserts.filter((i) => i.table === 'complaint_audit_log').map((i) => i.row.action);
  assert.ok(!actions.includes('follow_up_email_sent'), actions.join(', '));
  assert.ok(!actions.includes('critical_alert_sent'), actions.join(', '));
  assert.ok(!w.updates.some((u) => u.patch.status === 'follow_up_sent'));
});
