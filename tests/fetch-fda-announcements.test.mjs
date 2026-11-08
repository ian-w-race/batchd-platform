// fetch-fda-announcements-background.js (improvement plan B5 stage 2): FDA
// press releases become catalog entries on the day they are published. The
// feed, the article pages and the AI reader are stubbed; the Supabase client
// is an in-memory stand-in. Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.BATCHD_JOB_LOG = 'off';
process.env.INTERNAL_NOTIFY_SECRET = 'test-secret-0123456789abcdef';
delete process.env.SCHEDULED_FUNCTIONS_DISABLED;

const mod = require('../netlify/functions/fetch-fda-announcements-background.js')._test;

function makeDb(catalog = []) {
  const db = { catalog: catalog.map((r) => ({ ...r })), sweeps: [], calls: 0 };
  let seq = 0;
  db.rpc = (name, args) => Promise.resolve().then(() => { db.calls++; db.sweeps.push({ name, ...args }); return { data: 1, error: null }; });
  db.from = (table) => {
    const st = { table, filters: [], op: 'select', rows: null, opts: null };
    const b = {
      select() { return b; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return b; },
      like(c, pattern) { const re = new RegExp('^' + pattern.replace(/[.*+?^${}()[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'); st.filters.push((r) => re.test(String(r[c] || ''))); return b; },
      limit() { return b; },
      upsert(rows, opts) { st.op = 'upsert'; st.rows = rows; st.opts = opts; return b; },
      then(res, rej) {
        return Promise.resolve().then(() => {
          db.calls++;
          if (st.op === 'upsert') {
            const keys = String(st.opts.onConflict).split(',');
            const out = [];
            for (const row of st.rows) {
              if (db.catalog.find((r) => keys.every((k) => r[k] === row[k]))) continue;
              const saved = { id: 'cat-' + (++seq), ...row };
              db.catalog.push(saved); out.push({ id: saved.id });
            }
            return { data: out, error: null };
          }
          return { data: db.catalog.filter((r) => st.filters.every((f) => f(r))), error: null };
        }).then(res, rej);
      },
    };
    return b;
  };
  return db;
}

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Snack Right Super Foods Recalls Brad's Crunchy Kale &amp; Veggie Chips Due to Potential Thallium Contamination</title>
<link>http://www.fda.gov/safety/recalls/brads</link><description>Coral Gables, FL - Snack Right is recalling certain chips.</description>
<pubDate>Mon, 02 Nov 2026 12:19:00 EST</pubDate><guid isPermaLink="true">http://www.fda.gov/safety/recalls/brads</guid></item>
<item><title>Acme Pharma Recalls One Lot of Tablets</title>
<link>http://www.fda.gov/safety/recalls/acme</link><description>A drug recall.</description>
<pubDate>Sun, 01 Nov 2026 10:00:00 EST</pubDate><guid isPermaLink="true">http://www.fda.gov/safety/recalls/acme</guid></item>
<item><title>Once Upon A Farm Recalls All Lots of Tractor Wheels Bars</title>
<link>http://www.fda.gov/safety/recalls/farm</link><description>Already in the catalog.</description>
<pubDate>Fri, 30 Oct 2026 19:59:00 EDT</pubDate><guid isPermaLink="true">http://www.fda.gov/safety/recalls/farm</guid></item>
<item><title>Blog post about recalls</title>
<link>http://www.fda.gov/news/blog</link><description>Not a recall.</description>
<pubDate>Thu, 29 Oct 2026 09:00:00 EDT</pubDate><guid isPermaLink="true">http://www.fda.gov/news/blog</guid></item>
</channel></rss>`;

const PAGES = {
  'http://www.fda.gov/safety/recalls/brads': `<html><head><script>x()</script></head><body><nav>menu</nav><main><h1>Brad's Raw Chips recall</h1><dl><dt>Product Type:</dt><dd>Food &amp; Beverages</dd></dl><p>Snack Right Super Foods, Inc. is recalling Brad's Plant Based Crunchy Kale (2 oz) UPC 8 54136 00123 4 lots 24300 through 24310, and Brad's Veggie Chips Kale (3 oz) UPC 854136001241 lot 24311, best by 03/15/2027.</p></main></body></html>`,
  'http://www.fda.gov/safety/recalls/acme': `<html><body><main><p>Product Type: Drugs</p><p>Acme recalls tablets.</p></main></body></html>`,
  'http://www.fda.gov/news/blog': `<html><body><main><p>No product type here. A blog post.</p></main></body></html>`,
};

const READINGS = {
  brads: {
    is_recall_notice: true, recalling_firm: 'Snack Right Super Foods, Inc.', notice_date: '2026-11-02', classification: 'unknown',
    reason: 'The chips may contain thallium.', hazard: 'thallium',
    products: [
      { description: "Brad's Plant Based Crunchy Kale", brand: "Brad's", size: '2 oz', gtins: ['8 54136 00123 4'], lots: [], lot_ranges: [{ from: '24300', to: '24310' }], best_by_from: null, best_by_to: null, match_terms: ['kale', 'chips'] },
      { description: 'Veggie Chips Kale', brand: "Brad's", size: '3 oz', gtins: ['854136001241'], lots: ['24311'], lot_ranges: [], best_by_from: '2027-03-15', best_by_to: '2027-03-15', match_terms: ['veggie', 'chips'] },
    ],
    instructions: 'Do not eat.', contact: 'Snack Right', uncertainties: [],
  },
  blog: { is_recall_notice: false, recalling_firm: null, notice_date: null, classification: 'unknown', reason: null, hazard: null, products: [], instructions: null, contact: null, uncertainties: [] },
};

function stubFetch() {
  return async (url) => {
    const u = String(url);
    if (u.includes('rss.xml')) return { ok: true, status: 200, text: async () => RSS };
    if (PAGES[u]) return { ok: true, status: 200, text: async () => PAGES[u] };
    return { ok: false, status: 404, text: async () => '' };
  };
}
function stubClient(log) {
  return { beta: { messages: { create: async (req) => {
    const text = req.messages[0].content[0].text;
    log.push(req);
    const reading = text.includes('Brad') ? READINGS.brads : READINGS.blog;
    return { stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(reading) }] };
  } } } };
}
const event = (headers = { 'x-internal-secret': 'test-secret-0123456789abcdef' }) => ({ httpMethod: 'POST', headers, body: '' });

test('the feed is parsed: title, link, guid, pubDate as ISO, description', () => {
  const items = mod.parseRss(RSS);
  assert.equal(items.length, 4);
  assert.equal(items[0].title, "Snack Right Super Foods Recalls Brad's Crunchy Kale & Veggie Chips Due to Potential Thallium Contamination");
  assert.equal(items[0].guid, 'http://www.fda.gov/safety/recalls/brads');
  assert.equal(items[0].pubDate, '2026-11-02T17:19:00.000Z');
  assert.equal(items[2].pubDate, '2026-10-30T23:59:00.000Z');
});

test('the article text drops scripts and tags and finds the product type', () => {
  const a = mod.articleText(PAGES['http://www.fda.gov/safety/recalls/brads']);
  assert.equal(a.productType, 'Food & Beverages');
  assert.ok(a.text.includes('Snack Right Super Foods, Inc. is recalling'));
  assert.ok(!a.text.includes('x()') && !a.text.includes('menu'), 'script and nav are gone (main only)');
  assert.equal(mod.articleText(PAGES['http://www.fda.gov/safety/recalls/acme']).productType, 'Drugs');
  assert.equal(mod.articleText(PAGES['http://www.fda.gov/news/blog']).productType, null);
  assert.equal(mod.isFood('Food & Beverages'), true); assert.equal(mod.isFood('Dietary Supplements'), true);
  assert.equal(mod.isFood('Drugs'), false); assert.equal(mod.isFood(null), false);
});

test('a run: known items skipped, non-food skipped without AI, food read once, one entry per product, swept', async () => {
  global.fetch = stubFetch();
  const db = makeDb([{ id: 'old', source: 'fda', kind: 'announcement', external_key: 'press|http://www.fda.gov/safety/recalls/farm|0' }]);
  const log = [];
  const r = JSON.parse((await mod.run(event(), { sb: db, client: stubClient(log) })).body);
  assert.equal(r.items, 4);
  assert.equal(r.known, 1, 'the farm item is already in the catalog');
  assert.equal(r.not_food, 1, 'the drug recall was skipped by its product type, with no AI call');
  assert.equal(r.read, 2, "Brad's and the blog post (no product type, so the reader decides)");
  assert.equal(r.not_recalls, 1, 'the blog post is not a recall');
  assert.equal(log.length, 2);
  assert.ok(log[0].messages[0].content[0].text.includes('FDA public recall announcement'));
  assert.equal(r.entries_added, 2, "two products in Brad's announcement");
  assert.equal(r.matches, 2, 'both swept (the stub reports 1 match each)');
  assert.deepEqual(db.sweeps.map((s) => s.name), ['sweep_catalog_matches', 'sweep_catalog_matches']);
  const rows = db.catalog.filter((c) => c.id !== 'old');
  assert.deepEqual(rows.map((c) => c.external_key), ['press|http://www.fda.gov/safety/recalls/brads|0', 'press|http://www.fda.gov/safety/recalls/brads|1']);
  const a = rows[0];
  assert.equal(a.kind, 'announcement'); assert.equal(a.source, 'fda'); assert.equal(a.recall_number, null);
  assert.equal(a.product_name, "Brad's Plant Based Crunchy Kale", 'the brand is already in the description');
  assert.deepEqual(a.gtins, ['854136001234'], 'digits only');
  assert.deepEqual(a.lot_ranges, [{ from: '24300', to: '24310' }]);
  assert.equal(a.notice_url, 'http://www.fda.gov/safety/recalls/brads');
  assert.equal(a.published_at, '2026-11-02T17:19:00.000Z'); assert.equal(a.report_date, '2026-11-02');
  assert.equal(a.recalling_firm, 'Snack Right Super Foods, Inc.'); assert.equal(a.feed_status, 'Announced');
  assert.equal(a.code_info, 'Lots 24300 through 24310; UPC 854136001234');
  assert.deepEqual(a.match_terms, ['kale', 'chips']); assert.equal(a.parser_version, 2);
  const b = rows[1];
  assert.equal(b.product_name, "Brad's Veggie Chips Kale", 'brand added when the description lacks it');
  assert.deepEqual(b.lots, ['24311']); assert.equal(b.best_by_from, '2027-03-15'); assert.equal(b.best_by_to, '2027-03-15');
  assert.equal(a.raw.extracted.hazard, 'thallium');
});

test('a second run reads nothing new', async () => {
  global.fetch = stubFetch();
  const db = makeDb();
  const log = [];
  await mod.run(event(), { sb: db, client: stubClient(log) });
  const again = JSON.parse((await mod.run(event(), { sb: db, client: stubClient(log) })).body);
  assert.equal(again.known, 1, "Brad's is known now");
  assert.equal(again.read, 1, 'only the blog post, which has no product type, is read again');
  assert.equal(again.entries_added, 0);
  assert.equal(db.catalog.length, 2);
});

test('"all lots" announcements are flagged when the reader lists no code', () => {
  const rows = mod.rowsFor(
    { title: 'Once Upon A Farm Recalls All Lots and Varieties of Tractor Wheels Bars', link: 'http://x', guid: 'g', pubDate: '2026-10-30T23:59:00.000Z', description: '' },
    { recalling_firm: 'Once Upon a Farm', classification: 'class_ii', reason: 'Choking hazard', products: [{ description: 'Tractor Wheels Organic Toddler Soft-Baked Bars', brand: null, size: null, gtins: ['850012345678'], lots: [], lot_ranges: [], best_by_from: null, best_by_to: null, match_terms: ['toddler', 'bars'] }] },
  );
  assert.equal(rows[0].all_lots, true);
  assert.equal(rows[0].classification, 'Class II');
  assert.equal(rows[0].code_info, 'UPC 850012345678');
});

test('the internal secret is required; a wrong method is refused; the disabled flag skips', async () => {
  global.fetch = stubFetch();
  const db = makeDb();
  assert.equal((await mod.run(event({}), { sb: db })).statusCode, 403);
  assert.equal((await mod.run(event({ 'x-internal-secret': 'wrong-secret-0123456789abcd' }), { sb: db })).statusCode, 403);
  assert.equal((await mod.run({ httpMethod: 'GET', headers: {} }, { sb: db })).statusCode, 405);
  process.env.SCHEDULED_FUNCTIONS_DISABLED = 'true';
  const skipped = await mod.run(event(), { sb: db });
  delete process.env.SCHEDULED_FUNCTIONS_DISABLED;
  assert.match(skipped.body, /skipped/);
  assert.equal(db.calls, 0);
});
