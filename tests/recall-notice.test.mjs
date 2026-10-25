// Recall notice intake (improvement plan B1): the clean-up of Claude's answer,
// how the notice is passed in, and the background function's outcomes.
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../netlify/lib/recall-notice.js');

test('codes are cleaned, labels stripped, dates checked, ranges kept', () => {
  const n = lib.normalizeExtraction({
    recalling_firm: ' Example Nut Co ', notice_date: '2026-10-21', classification: 'class_i',
    reason: 'Possible Salmonella', products: [{
      description: 'Creamy Peanut Butter 16 oz', brand: 'Example', size: '16 oz',
      gtins: ['UPC: 0-81234-50001-6', '12'], lots: ['Lot: PB24105', 'PB24105', 'x'],
      lot_ranges: [{ from: 'PB24100', to: 'PB24150' }, { from: '', to: 'A' }],
      best_by_from: '2027-03-31', best_by_to: '2027-02-01', match_terms: ['Peanut', 'butter', 'pb', 'a', 'jar', 'extra'],
    }],
    uncertainties: ['', 'Second page is faint'],
  });
  const p = n.products[0];
  assert.equal(n.recalling_firm, 'Example Nut Co');
  assert.deepEqual(p.gtins, ['081234500016']);
  assert.deepEqual(p.lots, ['PB24105']);
  assert.deepEqual(p.lot_ranges, [{ from: 'PB24100', to: 'PB24150' }]);
  assert.equal(p.best_by_from, '2027-02-01'); // swapped into order
  assert.equal(p.best_by_to, '2027-03-31');
  assert.deepEqual(p.match_terms, ['peanut', 'butter', 'jar']);
  assert.deepEqual(n.uncertainties, ['Second page is faint']);
});

test('unknown classification and impossible dates fall back safely', () => {
  const n = lib.normalizeExtraction({ classification: 'Class 1', notice_date: '2026-02-31', products: 'nope' });
  assert.equal(n.classification, 'unknown');
  assert.equal(n.notice_date, null);
  assert.deepEqual(n.products, []);
  assert.equal(n.is_recall_notice, true);
});

test('PDF, image, text file and pasted text become the right content blocks', () => {
  assert.equal(lib.buildContent({ fileBase64: 'AAA', fileType: 'application/pdf' })[0].type, 'document');
  assert.equal(lib.buildContent({ fileBase64: 'AAA', fileType: 'image/png' })[0].source.media_type, 'image/png');
  const t = lib.buildContent({ fileBase64: Buffer.from('Lot PB24105').toString('base64'), fileType: 'text/plain', fileName: 'n.txt' });
  assert.match(t[0].text, /Lot PB24105/);
  assert.match(lib.buildContent({ text: 'Recall of romaine' })[0].text, /<notice source="pasted text">/);
  assert.throws(() => lib.buildContent({}), /no file and no text/);
  assert.throws(() => lib.buildContent({ fileBase64: 'AAA', fileType: 'application/zip' }), /Unsupported/);
});

test('the schema requires every property so the answer shape never varies', () => {
  const s = lib.NOTICE_SCHEMA;
  assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
  const ps = s.properties.products.items;
  assert.deepEqual([...ps.required].sort(), Object.keys(ps.properties).sort());
  assert.equal(lib.MODEL, 'claude-opus-5-5');
});

// ── Background function, with Supabase and Anthropic stood in ──────────────
const ORG = '44444444-4444-4444-8444-444444444444';
const NOTICE = '55555555-5555-4555-8555-555555555555';

function world({ role = 'corp_admin', plan = 'pov', status = 'processing' } = {}) {
  const w = { patches: [] };
  global.fetch = async (url, opts = {}) => {
    url = String(url);
    const reply = (st, data) => ({ ok: st < 300, status: st, json: async () => data, text: async () => JSON.stringify(data),
      arrayBuffer: async () => Buffer.from('%PDF-1.4 fake') });
    if (url.includes('/auth/v1/user')) return reply(200, { id: '66666666-6666-4666-8666-666666666666', email: 'a@example.com' });
    if (url.includes('/rest/v1/recall_notices') && (opts.method || 'GET') === 'GET')
      return reply(200, [{ id: NOTICE, organisation_id: ORG, status, file_path: 'orgs/44444444/recall-notices/n.pdf', file_type: 'application/pdf', raw_text: null }]);
    if (url.includes('/rest/v1/recall_notices') && opts.method === 'PATCH') { w.patches.push(JSON.parse(opts.body)); return reply(204, null); }
    if (url.includes('organisation_members')) return reply(200, role ? [{ role }] : []);
    if (url.includes('/rest/v1/organisations')) return reply(200, [{ plan }]);
    if (url.includes('/storage/v1/object/')) return reply(200, null);
    return reply(404, {});
  };
  return w;
}
function load() {
  process.env.SUPABASE_SERVICE_KEY = 'svc';
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (req === '@anthropic-ai/sdk') { class APIError extends Error {} const A = function () {}; A.APIError = APIError; return A; }
    return orig.call(this, req, ...rest);
  };
  for (const p of ['../netlify/functions/parse-recall-notice-background.js', '../netlify/lib/auth.js']) delete require.cache[require.resolve(p)];
  try { return require('../netlify/functions/parse-recall-notice-background.js')._test; } finally { Module._load = orig; }
}
const ev = { httpMethod: 'POST', headers: { authorization: 'Bearer jwt' }, body: JSON.stringify({ notice_id: NOTICE }) };
const fakeClient = (resp) => ({ calls: [], beta: { messages: { create: async function (req) { this.calls = (this.calls || []); fakeClient.last = req; return resp; } } } });

test('a readable notice is stored as ready with cleaned fields', async () => {
  const w = world();
  const resp = { stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify({
    is_recall_notice: true, recalling_firm: 'Example Nut Co', notice_date: '2026-10-21', classification: 'class_i',
    reason: 'Possible Salmonella', hazard: 'Salmonella', instructions: 'Remove from sale', contact: null, uncertainties: [],
    products: [{ description: 'Creamy Peanut Butter', brand: null, size: '16 oz', gtins: ['081234500016'], lots: ['PB24105'],
      lot_ranges: [], best_by_from: null, best_by_to: null, match_terms: ['peanut', 'butter'] }] }) }] };
  const r = await load().handler(ev, { client: fakeClient(resp) });
  assert.equal(r.statusCode, 200);
  const last = w.patches.at(-1);
  assert.equal(last.status, 'ready');
  assert.equal(last.extracted.products[0].lots[0], 'PB24105');
  const req = fakeClient.last;
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.fallbacks, 'default');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.messages[0].content[0].type, 'document');
});

test('a refusal, a non-admin and an org without AI each end as failed with a reason', async () => {
  let w = world();
  await load().handler(ev, { client: fakeClient({ stop_reason: 'refusal', content: [] }) });
  assert.equal(w.patches.at(-1).status, 'failed');
  assert.match(w.patches.at(-1).error, /declined/);

  w = world({ role: 'store_manager' });
  let r = await load().handler(ev, { client: fakeClient({}) });
  assert.equal(r.statusCode, 403);
  assert.match(w.patches.at(-1).error, /corporate admin/);

  w = world({ plan: 'trial' });
  r = await load().handler(ev, { client: fakeClient({}) });
  assert.equal(r.statusCode, 403);
  assert.match(w.patches.at(-1).error, /pilot or paid plan/);
});

test('a notice that is not processing is left alone', async () => {
  const w = world({ status: 'ready' });
  const r = await load().handler(ev, { client: fakeClient({}) });
  assert.equal(r.statusCode, 404);
  assert.equal(w.patches.length, 0);
});
