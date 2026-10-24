// fetch-recall-feeds.js: the daily FDA import must finish in a handful of
// database calls, add each recall once per US org, and never duplicate
// (rewritten 2026-10-24). Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

const require = createRequire(import.meta.url);

// A small in-memory stand-in for the supabase-js builder, enough for the
// queries this function makes. It counts round trips.
function makeDb({ orgs, recalls = [] }) {
  const db = { orgs, recalls: recalls.map((r) => ({ ...r })), calls: 0 };
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
          if (st.op === 'upsert') {
            const added = [];
            for (const row of st.rows) {
              if (db.recalls.some((r) => r.id === row.id)) continue; // ON CONFLICT (id) DO NOTHING
              db.recalls.push({ ...row });
              added.push({ id: row.id });
            }
            return { data: added, error: null };
          }
          let out = db.recalls.filter((r) => st.filters.every((f) => f(r)));
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
  return { ok: false, status: 404, text: async () => '' }; // Mattilsynet RSS is gone
};
const item = (n, product, date = '20261020', reason = 'Possible Listeria contamination') =>
  ({ recall_number: `F-${String(n).padStart(4, '0')}-2026`, product_description: product, code_info: 'Lot L' + n, reason_for_recall: reason, report_date: date });

const US = [{ id: 'us-1', region: 'us', type: 'retailer' }, { id: 'us-2', region: 'us', type: 'retailer' }];
const NO = [{ id: 'no-1', region: 'no', type: 'retailer' }];

test('fresh import adds each recall once per US org in three database calls', async () => {
  delete process.env.SCHEDULED_FUNCTIONS_DISABLED;
  global.fetch = fda([item(1, 'Romaine hearts'), item(2, 'Peanut butter'), item(3, 'Spinach')]);
  const db = makeDb({ orgs: [...US, ...NO] });
  const r = JSON.parse((await load(db).handler({})).body);
  assert.equal(r.fda_added, 6);
  assert.equal(db.recalls.filter((x) => x.source === 'fda').length, 6);
  assert.equal(db.calls, 3, 'organisations, existing FDA rows, one bulk insert');
  assert.ok(db.recalls.every((x) => /\[F-\d{4}-2026\]$/.test(x.description)));
});

test('a second run adds nothing', async () => {
  global.fetch = fda([item(1, 'Romaine hearts'), item(2, 'Peanut butter')]);
  const db = makeDb({ orgs: US });
  const mod = load(db);
  await mod.handler({});
  const second = JSON.parse((await mod.handler({})).body);
  assert.equal(second.fda_added, 0);
  assert.equal(db.recalls.length, 4);
});

test('two runs at the same moment cannot duplicate (stable ids)', async () => {
  global.fetch = fda([item(1, 'Romaine hearts'), item(2, 'Peanut butter')]);
  const db = makeDb({ orgs: US });
  const mod = load(db);
  await Promise.all([mod.handler({}), mod.handler({})]);
  assert.equal(db.recalls.length, 4);
});

test('existing rows are respected, including old rows whose recall number was cut off', async () => {
  global.fetch = fda([item(1, 'Romaine hearts'), item(2, 'Peanut butter')]);
  const db = makeDb({ orgs: US, recalls: [
    { id: 'old-a', organisation_id: 'us-1', source: 'fda', product_name: 'Romaine hearts', description: 'Listeria [F-0001-2026]', created_at: '2026-10-20T00:00:00.000Z' },
    { id: 'old-b', organisation_id: 'us-1', source: 'fda', product_name: 'Peanut butter', description: 'A very long reason that lost its number at 200 char', created_at: '2026-10-20T00:00:00.000Z' },
  ] });
  const r = JSON.parse((await load(db).handler({})).body);
  assert.equal(r.fda_added, 2, 'only us-2 needed both recalls');
  assert.equal(db.recalls.filter((x) => x.organisation_id === 'us-1').length, 2);
  assert.equal(db.recalls.filter((x) => x.organisation_id === 'us-2').length, 2);
});

test('an org created later still receives recalls another org already has', async () => {
  global.fetch = fda([item(7, 'Almond butter')]);
  const db = makeDb({ orgs: US, recalls: [
    { id: 'x', organisation_id: 'us-1', source: 'fda', product_name: 'Almond butter', description: 'Salmonella [F-0007-2026]', created_at: '2026-10-20T00:00:00.000Z' },
  ] });
  const r = JSON.parse((await load(db).handler({})).body);
  assert.equal(r.fda_added, 1);
  assert.ok(db.recalls.some((x) => x.organisation_id === 'us-2' && x.description.endsWith('[F-0007-2026]')));
});

test('a long reason keeps the whole recall number', async () => {
  global.fetch = fda([item(9, 'Kale', '20261020', 'x'.repeat(500))]);
  const db = makeDb({ orgs: [US[0]] });
  await load(db).handler({});
  const d = db.recalls[0].description;
  assert.equal(d.length, 200);
  assert.ok(d.endsWith(' [F-0009-2026]'));
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

test('"N/A" and missing recall numbers are keyed on product and day, not shared', async () => {
  const a = { recall_number: 'N/A', product_description: 'Raw milk cheddar', code_info: '', reason_for_recall: 'E. coli', report_date: '20261014' };
  const b = { recall_number: 'N/A', product_description: 'Almond Joy bar', code_info: '', reason_for_recall: 'Undeclared nuts', report_date: '20261014' };
  const c = { recall_number: '', product_description: 'Ice cream bar', code_info: '', reason_for_recall: 'Listeria', report_date: '20260930' };
  global.fetch = fda([a, b, c]);
  const db = makeDb({ orgs: [US[0]] });
  const mod = load(db);
  const r = JSON.parse((await mod.handler({})).body);
  assert.equal(r.fda_added, 3, 'three different recalls, three rows');
  assert.ok(db.recalls.every((x) => !x.description.includes('[N/A]')));
  const again = JSON.parse((await mod.handler({})).body);
  assert.equal(again.fda_added, 0, 'and none repeated on the next run');
});
