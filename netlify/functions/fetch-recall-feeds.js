// ================================================================
// fetch-recall-feeds.js — Batch'd scheduled Netlify function
// Pulls the FDA enforcement report once a day and writes each new
// recall entry once into recall_catalog (improvement plan B4, stage 2,
// 2026-11-08), then matches it against every US organization's scans
// through sweep_catalog_matches.
//
// Since B4 stage 6 (2026-11-08) the catalog is the only thing it writes:
// the per-organization copies in the recalls table are gone (both apps read
// batchd_active_recalls since stages 4 and 5) and nothing may write them
// again (scripts/check.mjs refuses a `recalls` write in this file).
//
// Schedule: daily at 06:00 UTC (configured in netlify.toml)
// Scheduled only: Netlify scheduled functions cannot be called by URL.
//
// Source: api.fda.gov/food/enforcement.json. The Mattilsynet leg was
// removed on 2026-11-08 (decision 3 of docs/B4-RECALL-CATALOG-PLAN.md):
// its feed had answered 404 for weeks and the NO layer is frozen.
// RASFF has no reliable public API. It is not included.
// ================================================================

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Netlify native scheduled function — runs daily at 06:00 UTC
exports.schedule = '0 6 * * *';

const run = async (event) => {
  // Same cron-singleton switch as recall-escalation.js. The import is
  // idempotent (stable ids and a unique catalog key), so running on two
  // sites is harmless, but there is no reason to do the work twice.
  if (process.env.SCHEDULED_FUNCTIONS_DISABLED === 'true') {
    console.log('[fetch-recall-feeds] skipped: scheduled functions disabled on this site');
    return { statusCode: 200, body: JSON.stringify({ skipped: 'scheduled functions disabled on this site' }) };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const results = { catalog: null, reparse: null, links: null, announcements: null, errors: [] };

  let feed = null;
  try {
    feed = await fetchFDAFeed();
  } catch (e) {
    console.error('[fetch-recall-feeds] FDA error:', e.message);
    results.errors.push('FDA: ' + e.message);
  }

  if (feed) {
    // The catalog: each entry once, then the sweep for the new ones.
    try {
      results.catalog = await importCatalog(sb, feed);
    } catch (e) {
      console.error('[fetch-recall-feeds] catalog error:', e.message);
      results.errors.push('Catalog: ' + e.message);
    }
  }
  // Older entries take the current parser's reading, a hundred a run (B5 stage 1).
  try {
    results.reparse = await reparseCatalog(sb, 100);
  } catch (e) {
    console.error('[fetch-recall-feeds] re-parse error:', e.message);
    results.errors.push('Re-parse: ' + e.message);
  }
  // The links (B5 stage 3): enforcement entries join their announcements,
  // and each organization's pushed recalls cover the public entries they
  // name. Both are SQL functions for the service role (migration 046).
  try {
    const [ann, cov] = await Promise.all([
      sb.rpc('link_catalog_announcements', { p_days: 120 }),
      sb.rpc('link_catalog_coverage', { p_event: null }),
    ]);
    if (ann.error) throw new Error('link_catalog_announcements: ' + ann.error.message);
    if (cov.error) throw new Error('link_catalog_coverage: ' + cov.error.message);
    results.links = { announcements: Number(ann.data) || 0, coverage: Number(cov.data) || 0 };
  } catch (e) {
    console.error('[fetch-recall-feeds] link error:', e.message);
    results.errors.push('Links: ' + e.message);
  }
  // FDA announcements (B5 stage 2): the press releases are read by the
  // background function, which has the minutes this scheduled run lacks.
  results.announcements = await triggerAnnouncements();

  console.log('[fetch-recall-feeds] Complete:', JSON.stringify(results));

  return {
    statusCode: 200,
    body: JSON.stringify({
      catalog_added:    results.catalog?.added   ?? 0,
      catalog_skipped:  results.catalog?.skipped ?? 0,
      catalog_refreshed: results.catalog?.refreshed ?? 0,
      catalog_matches:  results.catalog?.matches ?? 0,
      catalog_reparsed: results.reparse?.reparsed ?? 0,
      reparse_matches:  results.reparse?.matches ?? 0,
      links_announcements: results.links?.announcements ?? 0,
      links_coverage:   results.links?.coverage ?? 0,
      announcements:    results.announcements,
      errors: results.errors.length > 0 ? results.errors : undefined,
      timestamp: new Date().toISOString(),
    }),
  };
};

// ── The FDA enforcement feed ───────────────────────────────────
async function fetchFDAFeed() {
  const url = 'https://api.fda.gov/food/enforcement.json?limit=50&sort=report_date:desc';
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Batched-RecallTracker/1.0 (batchd-app.netlify.app)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error('FDA API returned ' + resp.status);
  const json = await resp.json();
  return json.results || [];
}

// Only a real FDA recall number counts (the feed also sends "N/A" or nothing).
function fdaRecallNumber(r) {
  return /^[A-Z]-\d{4}-\d{4}$/.test(r.recall_number || '') ? r.recall_number : null;
}

// ── The catalog (B4 stage 2) ───────────────────────────────────
// One FDA recall number covers several product lines, each a separate
// entry in the report, so the key is the number plus a hash of the
// 120-character product name. Entries without a number are keyed on that
// name and the report day. Migration 044 derives the same key from the old
// per-organization rows (recall number from the description, product_name,
// created_at), so a migrated entry and a freshly imported one meet on the
// unique key instead of becoming two rows.
function catalogKey(r) {
  const recallNumber = fdaRecallNumber(r);
  const productName = (r.product_description || '').slice(0, 120);
  const day = (r.report_date ? parseDate(r.report_date) : null) || '';
  if (recallNumber) {
    const h = crypto.createHash('md5').update(productName).digest('hex').slice(0, 12);
    return `${recallNumber}|${h}`;
  }
  return `pd|${productName}|${day.slice(0, 10)}`;
}

// What a store can match on comes from the shared parser (B5 stage 1,
// src/shared/lot-codes.cjs): lots, printed lot ranges, GTINs and UPCs from
// the code text and the product text, the best-by window and the "all lots"
// flag, with a parser_version so older entries can be re-parsed below.
const lotCodes = require('../../src/shared/lot-codes.cjs');
function codesFor(r) {
  return lotCodes.parseRecallCodes({ code_info: r.code_info, more_code_info: r.more_code_info, product_description: r.product_description });
}

function catalogRow(r) {
  const recallNumber = fdaRecallNumber(r);
  const productName = (r.product_description || '').slice(0, 120);
  const reportDate = r.report_date ? parseDate(r.report_date) : null;
  const codes = codesFor(r);
  return {
    source: 'fda',
    kind: 'enforcement',
    event_key: (r.event_id || '').toString().slice(0, 40) || null,
    external_key: catalogKey(r),
    recall_number: recallNumber,
    product_name: productName,
    product_description: (r.product_description || '').slice(0, 4000) || null,
    code_info: [r.code_info, r.more_code_info].filter(Boolean).join(' ').slice(0, 4000) || null,
    lots: codes.lots, gtins: codes.gtins, lot_ranges: codes.lot_ranges,
    best_by_from: codes.best_by_from, best_by_to: codes.best_by_to, all_lots: codes.all_lots,
    parser_version: codes.parser_version,
    recalling_firm: (r.recalling_firm || '').slice(0, 200) || null,
    classification: (r.classification || '').slice(0, 40) || null,
    reason: (r.reason_for_recall || '').slice(0, 4000) || null,
    feed_status: (r.status || '').slice(0, 40) || null,
    report_date: reportDate ? reportDate.slice(0, 10) : null,
    published_at: reportDate,
    raw: r,
  };
}

// Older entries take the current parser's reading, a hundred a run, newest
// first: from the raw FDA entry where one is stored, else from the code text
// and product name the migration kept. An entry that gains a matchable key
// is swept again.
async function reparseCatalog(sb, limit = 100) {
  const { data: rows, error } = await sb.from('recall_catalog')
    .select('id, raw, code_info, product_name, product_description, lots, gtins')
    .lt('parser_version', lotCodes.PARSER_VERSION)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error('Could not read catalog entries to re-parse: ' + error.message);
  let reparsed = 0, matches = 0;
  const toSweep = [];
  for (const row of rows || []) {
    const src = row.raw && typeof row.raw === 'object'
      ? row.raw
      : { code_info: row.code_info, product_description: row.product_description || row.product_name };
    const codes = codesFor(src);
    const patch = {
      lots: codes.lots.length ? codes.lots : (row.lots || []),   // never lose a lot the old parser had
      gtins: codes.gtins, lot_ranges: codes.lot_ranges,
      best_by_from: codes.best_by_from, best_by_to: codes.best_by_to, all_lots: codes.all_lots,
      parser_version: codes.parser_version,
    };
    const { error: upErr } = await sb.from('recall_catalog').update(patch).eq('id', row.id);
    if (upErr) throw new Error('Could not re-parse catalog entry ' + row.id + ': ' + upErr.message);
    reparsed++;
    if (patch.lots.length || patch.gtins.length) toSweep.push(row.id);
  }
  for (let i = 0; i < toSweep.length; i += 10) {
    const part = toSweep.slice(i, i + 10);
    const res = await Promise.all(part.map((id) => sb.rpc('sweep_catalog_matches', { p_catalog_id: id, p_lookback_days: 180 })));
    for (const r of res) { if (r.error) throw new Error('sweep_catalog_matches failed: ' + r.error.message); matches += Number(r.data) || 0; }
  }
  return { reparsed, matches, remaining_known: (rows || []).length === limit };
}

async function importCatalog(sb, feed) {
  const rows = [];
  let skipped = 0;
  const seen = new Set();
  for (const r of feed) {
    if (!(r.product_description || '').trim()) { skipped++; continue; }
    const row = catalogRow(r);
    if (seen.has(row.external_key)) { skipped++; continue; }   // the report can repeat an entry
    seen.add(row.external_key);
    rows.push(row);
  }
  if (!rows.length) return { added: 0, skipped, matches: 0 };

  // Which of these entries the catalog already holds (one query), then an
  // upsert on the unique key: a new entry is inserted, a known one is
  // refreshed (the FDA moves an entry's status from Ongoing to Completed or
  // Terminated, and a migrated entry gains its raw feed text here). Two
  // sites or two retries can never add one twice. Only new entries are swept.
  const { data: existing, error: exErr } = await sb.from('recall_catalog')
    .select('external_key')
    .eq('source', 'fda')
    .in('external_key', rows.map(r => r.external_key));
  if (exErr) throw new Error('Could not read the catalog: ' + exErr.message);
  const known = new Set((existing || []).map(x => x.external_key));
  const { data: written, error: insErr } = await sb.from('recall_catalog')
    .upsert(rows, { onConflict: 'source,external_key' })
    .select('id, external_key');
  if (insErr) throw new Error('Catalog upsert failed: ' + insErr.message);
  const added = (written || []).filter(x => !known.has(x.external_key)).map(x => x.id);

  // Match each new entry against every US organization's scans (service
  // role only). Ten at a time keeps the run inside Netlify's budget.
  let matches = 0;
  for (let i = 0; i < added.length; i += 10) {
    const batch = added.slice(i, i + 10).map(id => sb.rpc('sweep_catalog_matches', { p_catalog_id: id, p_lookback_days: 180 }));
    for (const r of await Promise.allSettled(batch)) {
      if (r.status === 'fulfilled' && !r.value?.error) matches += Number(r.value?.data) || 0;
      else console.warn('[fetch-recall-feeds] sweep failed:', r.reason?.message || r.value?.error?.message);
    }
  }
  return { added: added.length, skipped: skipped + rows.length - added.length, refreshed: Math.max(0, (written || []).length - added.length), matches };
}

// Starts fetch-fda-announcements-background on this site with the internal
// secret (netlify/lib/auth.js). Netlify answers 202 and runs it for up to 15
// minutes; its own run is a job_runs row. A missing site URL or secret is
// reported, not thrown: the catalog import above must not fail over it.
async function triggerAnnouncements() {
  const base = process.env.URL;
  const secret = require('../lib/auth').internalSecret();
  if (!base) return { skipped: 'no site URL' };
  if (!secret) return { skipped: 'no internal secret' };
  try {
    const r = await fetch(`${base}/.netlify/functions/fetch-fda-announcements-background`, {
      method: 'POST', headers: { 'x-internal-secret': secret }, signal: AbortSignal.timeout(8000),
    });
    return { started: r.status === 202 || r.ok, status: r.status };
  } catch (e) {
    return { started: false, error: String(e && e.message || e).slice(0, 160) };
  }
}

// ── Helpers ───────────────────────────────────────────────────
function parseDate(str) {
  // FDA dates come as YYYYMMDD
  if (!str || str.length < 8) return null;
  try {
    const y = str.slice(0, 4), m = str.slice(4, 6), d = str.slice(6, 8);
    return new Date(`${y}-${m}-${d}T00:00:00Z`).toISOString();
  } catch { return null; }
}

// Exported for tests.
exports._test = { catalogKey, catalogRow, importCatalog, reparseCatalog };

// Every run is recorded in job_runs for the daily health check (migration 041).
exports.handler = require('../lib/job-log').withJobLog('fetch-recall-feeds', run);
