// ================================================================
// fetch-recall-feeds.js — Batch'd scheduled Netlify function
// Pulls the FDA enforcement report once a day and writes each new
// recall entry once into recall_catalog (improvement plan B4, stage 2,
// 2026-11-08), then matches it against every US organization's scans
// through sweep_catalog_matches.
//
// Transition (B4 stages 2 to 5): the screens still read the old
// per-organization copies in the recalls table, so this function also
// keeps writing those rows exactly as before. Stage 6 removes that path
// once every screen reads batchd_active_recalls. Do not remove it earlier.
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
  const results = { fda: null, catalog: null, errors: [] };

  // ── US retailer organizations (the per-organization copies, until stage 6) ──
  const { data: orgs, error: orgErr } = await sb
    .from('organisations')
    .select('id, region')
    .eq('type', 'retailer');
  if (orgErr) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load orgs: ' + orgErr.message }) };
  }
  const usOrgs = (orgs || []).filter(o => o.region === 'us').map(o => o.id);

  let feed = null;
  try {
    feed = await fetchFDAFeed();
  } catch (e) {
    console.error('[fetch-recall-feeds] FDA error:', e.message);
    results.errors.push('FDA: ' + e.message);
  }

  if (feed) {
    // 1. The catalog: each entry once, then the sweep for the new ones.
    try {
      results.catalog = await importCatalog(sb, feed);
    } catch (e) {
      console.error('[fetch-recall-feeds] catalog error:', e.message);
      results.errors.push('Catalog: ' + e.message);
    }
    // 2. The per-organization copies the screens still read (stage 6 removes this).
    if (usOrgs.length > 0) {
      try {
        results.fda = await importPerOrg(sb, feed, usOrgs);
      } catch (e) {
        console.error('[fetch-recall-feeds] per-org error:', e.message);
        results.errors.push('FDA: ' + e.message);
      }
    }
  }

  console.log('[fetch-recall-feeds] Complete:', JSON.stringify(results));

  return {
    statusCode: 200,
    body: JSON.stringify({
      fda_added:        results.fda?.added    ?? 0,
      fda_skipped:      results.fda?.skipped  ?? 0,
      catalog_added:    results.catalog?.added   ?? 0,
      catalog_skipped:  results.catalog?.skipped ?? 0,
      catalog_matches:  results.catalog?.matches ?? 0,
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
// entry in the report, so the key is the number plus a hash of the product
// text. Entries without a number are keyed on product and report day.
function catalogKey(r) {
  const recallNumber = fdaRecallNumber(r);
  const productName = (r.product_description || '').slice(0, 120);
  const day = (r.report_date ? parseDate(r.report_date) : null) || '';
  if (recallNumber) {
    const h = crypto.createHash('sha1').update(r.product_description || '').digest('hex').slice(0, 12);
    return `${recallNumber}|${h}`;
  }
  return `pd|${productName}|${day.slice(0, 10)}`;
}

// Lot codes and GTINs out of the FDA's free-text code_info, conservatively:
// a token counts as a lot when it has 4 to 30 characters, at least one digit
// and no spaces, is not a date and is not a UPC. Digit runs of 12 to 14
// (spaces allowed, as "0 41497 03611 9") count as GTINs. B5 improves this.
const CODE_LABELS = /\b(lot|lots|lot\s*(?:#|no\.?|number|numbers|code|codes)|batch|batches|codes?|numbers?|no\.?|item|items|upc|upcs|sku|skus|best\s*by|use\s*by|sell\s*by|exp(?:ires|iry|iration)?|dates?|through|thru|to|and|all)\b/gi;
function parseCodeInfo(text) {
  const s = String(text || '');
  const gtins = new Set();
  for (const m of s.matchAll(/\b(\d[\d ]{10,16}\d)\b/g)) {
    const digits = m[1].replace(/\s+/g, '');
    if (digits.length >= 12 && digits.length <= 14) gtins.add(digits);
  }
  const withoutGtins = s.replace(/\b\d[\d ]{10,16}\d\b/g, ' ');
  const lots = new Set();
  for (const fragment of withoutGtins.split(/[,;\n|]|\band\b|&/i)) {
    const cleaned = fragment.replace(CODE_LABELS, ' ').replace(/[#:()]/g, ' ');
    for (const tok of cleaned.split(/\s+/)) {
      const t = tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      if (t.length < 4 || t.length > 30) continue;
      if (!/\d/.test(t)) continue;
      if (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(t) || /^\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}$/.test(t)) continue; // a date
      if (/^\d{1,2}[\/.-]\d{2,4}$/.test(t)) continue;                                                       // month/year
      if (/^\d{12,14}$/.test(t)) { gtins.add(t); continue; }
      lots.add(t);
      if (lots.size >= 50) break;
    }
    if (lots.size >= 50) break;
  }
  return { lots: [...lots], gtins: [...gtins] };
}

function catalogRow(r) {
  const recallNumber = fdaRecallNumber(r);
  const productName = (r.product_description || '').slice(0, 120);
  const reportDate = r.report_date ? parseDate(r.report_date) : null;
  const { lots, gtins } = parseCodeInfo(r.code_info);
  return {
    source: 'fda',
    external_key: catalogKey(r),
    recall_number: recallNumber,
    product_name: productName,
    product_description: (r.product_description || '').slice(0, 4000) || null,
    code_info: (r.code_info || '').slice(0, 4000) || null,
    lots, gtins,
    recalling_firm: (r.recalling_firm || '').slice(0, 200) || null,
    classification: (r.classification || '').slice(0, 40) || null,
    reason: (r.reason_for_recall || '').slice(0, 4000) || null,
    feed_status: (r.status || '').slice(0, 40) || null,
    report_date: reportDate ? reportDate.slice(0, 10) : null,
    published_at: reportDate,
    raw: r,
  };
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

  // Insert the entries the catalog does not have yet; the unique key keeps
  // two sites or two retries from ever adding one twice.
  const { data: inserted, error: insErr } = await sb.from('recall_catalog')
    .upsert(rows, { onConflict: 'source,external_key', ignoreDuplicates: true })
    .select('id');
  if (insErr) throw new Error('Catalog insert failed: ' + insErr.message);
  const added = (inserted || []).map(x => x.id);

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
  return { added: added.length, skipped: skipped + rows.length - added.length, matches };
}

// ── The per-organization copies (until B4 stage 6) ─────────────
// Rewritten 2026-10-24. One query for what the US orgs already have, one
// bulk insert. Each org and recall pair gets a stable id, so two sites or
// two retries can never insert the same pair twice. The recall number is
// always kept at the end of the description ("... [F-1234-2026]").
const FDA_DESC_MAX = 200;

function fdaDescription(reason, recallNumber) {
  const suffix = recallNumber ? ` [${recallNumber}]` : '';
  return String(reason || '').slice(0, FDA_DESC_MAX - suffix.length) + suffix;
}

function recallNumberFrom(description) {
  const m = /\[([A-Z]-\d{4}-\d{4})\]$/.exec(String(description || ''));
  return m ? m[1] : null;
}

// Stable UUID (version 5 layout) from the org and the FDA recall number.
function stableRecallId(orgId, key) {
  const h = crypto.createHash('sha1').update(`batchd-fda|${orgId}|${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function importPerOrg(sb, feed, orgIds) {
  const candidates = [];
  let skipped = 0;
  for (const r of feed) {
    const productName = (r.product_description || '').slice(0, 120);
    if (!productName) { skipped++; continue; }
    const createdAt = (r.report_date ? parseDate(r.report_date) : null) || new Date().toISOString();
    const recallNumber = fdaRecallNumber(r);
    candidates.push({
      recallNumber,
      productName,
      lotNumber:    (r.code_info || '').slice(0, 80) || null,
      description:  fdaDescription(r.reason_for_recall, recallNumber),
      createdAt,
    });
  }
  if (!candidates.length) return { added: 0, skipped };

  // What the US orgs already hold for this window. Old rows may have lost
  // the recall number to truncation, so they also match on product and day.
  const earliest = candidates.reduce((m, c) => (c.createdAt < m ? c.createdAt : m), candidates[0].createdAt);
  const since = new Date(new Date(earliest).getTime() - 86400000).toISOString();
  const { data: existing, error: exErr } = await sb.from('recalls')
    .select('id, organisation_id, product_name, description, created_at')
    .eq('source', 'fda')
    .in('organisation_id', orgIds)
    .gte('created_at', since)
    .limit(5000);
  if (exErr) throw new Error('Could not read existing FDA recalls: ' + exErr.message);

  const have = new Set();
  for (const row of existing || []) {
    const rn = recallNumberFrom(row.description);
    if (rn) have.add(`${row.organisation_id}|rn|${rn}`);
    have.add(`${row.organisation_id}|pd|${row.product_name}|${String(row.created_at).slice(0, 10)}`);
    have.add(`id|${row.id}`);
  }

  const rows = [];
  for (const c of candidates) {
    const key = c.recallNumber || `${c.productName}|${c.createdAt.slice(0, 10)}`;
    for (const orgId of orgIds) {
      const id = stableRecallId(orgId, key);
      if (have.has(`id|${id}`)) continue;
      if (c.recallNumber && have.has(`${orgId}|rn|${c.recallNumber}`)) continue;
      if (have.has(`${orgId}|pd|${c.productName}|${c.createdAt.slice(0, 10)}`)) continue;
      rows.push({
        id,
        product_name:    c.productName,
        lot_number:      c.lotNumber,
        description:     c.description,
        source:          'fda',
        active:          true,
        organisation_id: orgId,
        created_at:      c.createdAt,
      });
    }
  }
  if (!rows.length) return { added: 0, skipped: skipped + candidates.length * orgIds.length };

  const { data: inserted, error: insErr } = await sb.from('recalls')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    .select('id');
  if (insErr) throw new Error('FDA insert failed: ' + insErr.message);
  const added = (inserted || []).length;
  return { added, skipped: skipped + candidates.length * orgIds.length - added };
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
exports._test = { fdaDescription, recallNumberFrom, stableRecallId, catalogKey, catalogRow, parseCodeInfo, importCatalog, importPerOrg };

// Every run is recorded in job_runs for the daily health check (migration 041).
exports.handler = require('../lib/job-log').withJobLog('fetch-recall-feeds', run);
