// fetch-recall-feeds.js: the daily FDA import writes each entry once into
// recall_catalog and sweeps matches for the new ones (B4 stage 2,
// 2026-11-08), and, until B4 stage 6, still adds the per-organization copies
// the screens read, once per US org and never duplicated (rewritten
// 2026-10-24). Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

const require = createRequire(import.meta.url);
process.env.BATCHD_JOB_LOG = 'off'; // job_runs logging is tested in health-check.test.mjs

// A small in-memory stand-in for the supabase-js builder, enough for the
// queries this function makes. It counts round trips and sweep calls.
function makeDb({ orgs, recalls = [], catalog = [] }) {
  const db = { orgs, recalls: recalls.map((r) => ({ ...r })), catalog: catalog.map((r) => ({ ...r })), calls: 0, sweeps: [] };
  let seq = 0;
  db.rpc = (name, args) => Promise.resolve().then(() => { db.calls++; db.sweeps.push({ name, ...args }); return { data: 2, error: null }; });
  db.from = (table) => {
    const st = { table, filters: [], op: 'select', rows: null, opts: null, limit: null };
    const b = {
      select() { return b; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return b; },
      in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return b; },
      gte(c, v) { st.filters.push((r) => String(r[c]) >= v); return b; },
      limit(n) { st.limit = n; return b; },
      upsert(rows, opts) { st.op = 'upsert'; st.rows = rows; st.opts = opts; return b; },
      then(res, rej) {
        return Promise.resolve().then(() => {
          db.calls++;
          if (st.table === 'organisations') return { data: db.orgs.filter((r) => st.filters.every((f) => f(r))), error: null };
          const store = st.table === 'recall_catalog' ? db.catalog : db.recalls;
          if (st.op === 'upsert') {
            const keys = String(st.opts?.onConflict || 'id').split(',');
            const added = [];
            for (const row of st.rows) {
              if (store.some((r) => keys.every((k) => r[k] === row[k]))) continue; // ON CONFLICT DO NOTHING
              const saved = { id: row.id || 'cat-' + (++seq), ...row };
              store.push(saved);
              added.push({ id: saved.id });
            }
            return { data: added, error: null };
          }
          let out = store.filter((r) => st.filters.every((f) => f(r)));
          if (st.limit) out = out.slice(0, st.limit);
          return { data: out, error: null };
        }).then(res, rej);
      },
    };
    return b;
  };
  return db;
}

function load(db) {
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (req === '@supabase/supabase-js') return { createClient: () => db };
    return orig.call(this, req, ...rest);
  };
  const p = require.resolve('../netlify/functions/fetch-recall-feeds.js');
  delete require.cache[p];
  try { return require(p); } finally { Module._load = orig; }
}

const fda = (items) => async (url) => {
  if (String(url).includes('api.fda.gov')) return { ok: true, json: async () => ({ results: items }) };
  throw new Error('unexpected fetch of ' + url);
};
const item = (n, product, date = '20261020', reason = 'Possible Listeria contamination', extra = {}) =>
  ({ recall_number: `F-${String(n).padStart(4, '0')}-2026`, product_description: product, code_info: 'Lot L' + n + '00', reason_for_recall: reason,
     report_date: date, classification: 'Class I', status: 'Ongoing', recalling_firm: 'Example Foods', ...extra });

const US = [{ id: 'us-1', region: 'us', type: 'retailer' }, { id: 'us-2', region: 'us', type: 'retailer' }];
const NO = [{ id: 'no-1', region: 'no', type: 'retailer' }];

test('fresh import writes each entry once to the catalog, sweeps it, and still adds the per-org copies', async () => {
  delete process.env.SCHEDULED_FUNCTIONS_DISABLED;
  global.fetch = fda([item(1, 'Romaine hearts'), item(2, 'Peanut butter'), item(3, 'Spinach')]);
  const db = makeDb({ orgs: [...US, ...NO] });
  const r = JSON.parse((await load(db).handler({})).body);
  assert.equal(r.catalog_added, 3);
  assert.equal(db.catalog.length, 3, 'one catalog row per entry, no organization');
  assert.equal(db.sweeps.length, 3, 'one sweep per new entry');
  assert.equal(r.catalog_matches, 6, 'the stub reports 2 matches per sweep');
  assert.equal(r.fda_added, 6, 'per-org copies: 3 entries x 2 US orgs, none for the NO org');
  assert.equal(db.recalls.filter((x) => x.source === 'fda').length, 6);
  assert.ok(db.recalls.every((x) => /\[F-\d{4}-2026\]$/.test(x.description)));
  assert.equal(r.errors, undefined, 'the Mattilsynet leg is gone, so no 404 error');
  const c = db.catalog[0];
  assert.equal(c.source, 'fda'); assert.equal(c.recall_number, 'F-0001-2026'); assert.equal(c.classification, 'Class I');
  assert.deepEqual(c.lots, ['L100']); assert.equal(c.report_date, '2026-10-20'); assert.equal(c.raw.product_description, 'Romaine hearts');
});

test('a second run adds nothing to the catalog or the copies, and sweeps nothing', async () => {
  global.fetch = fda([item(1, 'Romaine hearts'), item(2, 'Peanut butter')]);
  const db = makeDb({ orgs: US });
  const mod = load(db);
  await mod.handler({});
  const second = JSON.parse((await mod.handler({})).body);
  assert.equal(second.catalog_added, 0);
  assert.equal(second.fda_added, 0);
  assert.equal(db.catalog.length, 2);
  assert.equal(db.recalls.length, 4);
  assert.equal(db.sweeps.length, 2, 'only the first run swept');
});

test('one recall number with several product lines is several catalog entries', async () => {
  const a = item(5, 'Creamy peanut butter 16 oz'), b = item(5, 'Crunchy peanut butter 16 oz');
  global.fetch = fda([a, b, { ...a }]);   // the report repeats the first line
  const db = makeDb({ orgs: [US[0]] });
  const r = JSON.parse((await load(db).handler({})).body);
  assert.equal(r.catalog_added, 2);
  assert.notEqual(db.catalog[0].external_key, db.catalog[1].external_key);
  assert.ok(db.catalog.every((c) => c.external_key.startsWith('F-0005-2026|')));
});

test('two runs at the same moment cannot duplicate (stable ids and the unique key)', async () => {
  global.fetch = fda([item(1, 'Romaine hearts'), item(2, 'Peanut butter')]);
  const db = makeDb({ orgs: US });
  const mod = load(db);
  await Promise.all([mod.handler({}), mod.handler({})]);
  assert.equal(db.recalls.length, 4);
  assert.equal(db.catalog.length, 2);
});

test('existing per-org rows are respected, including old rows whose recall number was cut off', async () => {
  global.fetch = fda([item(1, 'Romaine hearts'), item(2, 'Peanut butter')]);
  const db = makeDb({ orgs: US, recalls: [
    { id: 'old-a', organisation_id: 'us-1', source: 'fda', product_name: 'Romaine hearts', description: 'Listeria [F-0001-2026]', created_at: '2026-10-20T00:00:00.000Z' },
    { id: 'old-b', organisation_id: 'us-1', source: 'fda', product_name: 'Peanut butter', description: 'A very long reason that lost its number at 200 characters', created_at: '2026-10-20T00:00:00.000Z' },
  ] });
  const r = JSON.parse((await load(db).handler({})).body);
  assert.equal(r.fda_added, 2, 'only us-2 needed both recalls');
  assert.equal(db.recalls.filter((x) => x.organisation_id === 'us-1').length, 2);
  assert.equal(db.recalls.filter((x) => x.organisation_id === 'us-2').length, 2);
});

test('a long reason keeps the whole recall number in the per-org copy, and the catalog keeps the full text', async () => {
  global.fetch = fda([item(9, 'Kale', '20261020', 'x'.repeat(500))]);
  const db = makeDb({ orgs: [US[0]] });
  await load(db).handler({});
  const d = db.recalls[0].description;
  assert.equal(d.length, 200);
  assert.ok(d.endsWith(' [F-0009-2026]'));
  assert.equal(db.catalog[0].reason.length, 500);
});

test('the disabled flag skips the run', async () => {
  process.env.SCHEDULED_FUNCTIONS_DISABLED = 'true';
  global.fetch = fda([item(1, 'Romaine hearts')]);
  const db = makeDb({ orgs: US });
  const r = await load(db).handler({});
  delete process.env.SCHEDULED_FUNCTIONS_DISABLED;
  assert.match(r.body, /skipped/);
  assert.equal(db.calls, 0);
});

test('"N/A" and missing recall numbers are keyed on product and day, in the catalog too', async () => {
  const a = { recall_number: 'N/A', product_description: 'Raw milk cheddar', code_info: '', reason_for_recall: 'E. coli', report_date: '20261014' };
  const b = { recall_number: 'N/A', product_description: 'Almond Joy bar', code_info: '', reason_for_recall: 'Undeclared nuts', report_date: '20261014' };
  const c = { recall_number: '', product_description: 'Ice cream bar', code_info: '', reason_for_recall: 'Listeria', report_date: '20260930' };
  global.fetch = fda([a, b, c]);
  const db = makeDb({ orgs: [US[0]] });
  const mod = load(db);
  const r = JSON.parse((await mod.handler({})).body);
  assert.equal(r.fda_added, 3, 'three different recalls, three rows');
  assert.equal(r.catalog_added, 3);
  assert.ok(db.catalog.every((x) => x.recall_number === null && x.external_key.startsWith('pd|')));
  assert.equal(db.sweeps.length, 3, 'a sweep is asked for each new entry; the database function returns 0 when there is nothing to match');
  const again = JSON.parse((await mod.handler({})).body);
  assert.equal(again.catalog_added, 0);
  assert.equal(again.fda_added, 0, 'and none repeated on the next run');
});

const { parseCodeInfo } = (() => { const db = makeDb({ orgs: [] }); return load(db)._test; })();

test('code_info parsing keeps lot codes, finds UPCs, and skips dates and labels', () => {
  assert.deepEqual(parseCodeInfo('Lot #: L24201, L24202; Best By 12/15/2026'), { lots: ['L24201', 'L24202'], gtins: [] });
  assert.deepEqual(parseCodeInfo('UPC 0 41497 03611 9, Lot codes 2024-07 and 2024-08'), { lots: ['2024-07', '2024-08'], gtins: ['041497036119'] });
  assert.deepEqual(parseCodeInfo('All lots. Exp 01/2027'), { lots: [], gtins: [] });
  assert.deepEqual(parseCodeInfo('Item 00812345000016 lot PB24105 through PB24150'), { lots: ['PB24105', 'PB24150'], gtins: ['00812345000016'] });
  assert.deepEqual(parseCodeInfo(''), { lots: [], gtins: [] });
  assert.deepEqual(parseCodeInfo(null), { lots: [], gtins: [] });
  const many = parseCodeInfo(Array.from({ length: 80 }, (_, i) => 'LOT' + (1000 + i)).join(', '));
  assert.equal(many.lots.length, 50, 'capped at 50');
});
