// ================================================================
// fetch-recall-feeds.js — Batch'd scheduled Netlify function
// Pulls FDA and Mattilsynet recall feeds once daily and inserts
// new records into the recalls table for each org in the relevant
// region.
//
// Schedule: daily at 06:00 UTC (configured in netlify.toml)
// Scheduled only: Netlify scheduled functions cannot be called by URL.
//
// Sources:
//   FDA    — api.fda.gov/food/enforcement.json (US orgs)
//   Mattilsynet — mattilsynet.no RSS feed (NO/EU orgs)
//
// Note: RASFF has no reliable public API. It is not included.
// ================================================================

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Netlify native scheduled function — runs daily at 06:00 UTC
exports.schedule = '0 6 * * *';

const run = async (event) => {
  // Same cron-singleton switch as recall-escalation.js. The FDA import below
  // is idempotent (stable ids), so running on two sites is harmless, but
  // there is no reason to do the work twice.
  if (process.env.SCHEDULED_FUNCTIONS_DISABLED === 'true') {
    console.log('[fetch-recall-feeds] skipped: scheduled functions disabled on this site');
    return { statusCode: 200, body: JSON.stringify({ skipped: 'scheduled functions disabled on this site' }) };
  }
  // Accept both scheduled invocations and manual POST triggers
  const isScheduled = event?.['scheduled'] === true;
  const body = event.body ? JSON.parse(event.body) : {};
  const forceSource = body.source || null; // 'fda' | 'mattilsynet' | null (both)

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  const results = { fda: null, mattilsynet: null, errors: [] };

  // ── Fetch all orgs, grouped by region ───────────────────────
  const { data: orgs, error: orgErr } = await sb
    .from('organisations')
    .select('id, region')
    .eq('type', 'retailer');

  if (orgErr) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load orgs: ' + orgErr.message }) };
  }

  const usOrgs = (orgs || []).filter(o => o.region === 'us').map(o => o.id);
  const noOrgs = (orgs || []).filter(o => o.region !== 'us').map(o => o.id);

  // ── FDA feed (US orgs) ──────────────────────────────────────
  if ((!forceSource || forceSource === 'fda') && usOrgs.length > 0) {
    try {
      results.fda = await fetchFDA(sb, usOrgs);
    } catch(e) {
      console.error('[fetch-recall-feeds] FDA error:', e.message);
      results.errors.push('FDA: ' + e.message);
    }
  }

  // ── Mattilsynet feed (NO/EU orgs) ───────────────────────────
  if ((!forceSource || forceSource === 'mattilsynet') && noOrgs.length > 0) {
    try {
      results.mattilsynet = await fetchMattilsynet(sb, noOrgs);
    } catch(e) {
      console.error('[fetch-recall-feeds] Mattilsynet error:', e.message);
      results.errors.push('Mattilsynet: ' + e.message);
    }
  }

  console.log('[fetch-recall-feeds] Complete:', JSON.stringify(results));

  return {
    statusCode: 200,
    body: JSON.stringify({
      fda_added:           results.fda?.added    ?? 0,
      fda_skipped:         results.fda?.skipped  ?? 0,
      mattilsynet_added:   results.mattilsynet?.added   ?? 0,
      mattilsynet_skipped: results.mattilsynet?.skipped ?? 0,
      errors: results.errors.length > 0 ? results.errors : undefined,
      timestamp: new Date().toISOString(),
    }),
  };
};

// ── FDA enforcement feed ──────────────────────────────────────
// Rewritten 2026-10-24. The old loop ran one leading-wildcard ILIKE per
// recall over the whole recalls table, then one insert per org per recall,
// all sequential across the Atlantic (Netlify us-east, Supabase eu-west).
// Runs took 11 to 15 s and Netlify's scheduler cut most of them off at
// 15 s, so for most of the week of 2026-10-18 no FDA recall arrived.
// It also deduplicated globally (a recall present for one org was never
// added for an org created later) and cut the recall number off when the
// reason was long, which let the same recall be inserted again: 955 of
// 8,660 FDA rows were duplicates on 2026-10-24.
// Now: one FDA request, one query for what the US orgs already have, one
// bulk insert. Each org and recall pair gets a stable id, so two sites or
// two retries can never insert the same pair twice.
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

async function fetchFDA(sb, orgIds) {
  const url = 'https://api.fda.gov/food/enforcement.json?limit=50&sort=report_date:desc';
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Batched-RecallTracker/1.0 (batchd-app.netlify.app)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error('FDA API returned ' + resp.status);

  const json = await resp.json();
  const candidates = [];
  let skipped = 0;
  for (const r of json.results || []) {
    const productName = (r.product_description || '').slice(0, 120);
    if (!productName) { skipped++; continue; }
    const createdAt = (r.report_date ? parseDate(r.report_date) : null) || new Date().toISOString();
    // Only a real FDA recall number counts (the feed also sends "N/A" or
    // nothing); otherwise the recall is keyed on product and report day.
    const recallNumber = /^[A-Z]-\d{4}-\d{4}$/.test(r.recall_number || '') ? r.recall_number : null;
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

// ── Mattilsynet RSS feed ──────────────────────────────────────
async function fetchMattilsynet(sb, orgIds) {
  const rssUrl = 'https://www.mattilsynet.no/mat/tilbakekallinger/rss';
  const resp = await fetch(rssUrl, {
    headers: { 'User-Agent': 'Batched-RecallTracker/1.0 (batchd-app.netlify.app)' },
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) throw new Error('Mattilsynet RSS returned ' + resp.status);

  const xml = await resp.text();
  const items = parseRSSItems(xml);
  let added = 0, skipped = 0;

  for (const item of items.slice(0, 30)) {
    const title = (item.title || '').trim();
    const desc  = stripHtml(item.description || '').slice(0, 200);
    const link  = item.link || '';
    const pubDate = item.pubDate ? new Date(item.pubDate).toISOString() : null;

    // Only include tilbaketrekking / tilbakekall items
    const isRecall = /tilbaketrekk|tilbakekall/i.test(title) ||
                     /tilbaketrekk|tilbakekall|trekkes|kalles tilbake/i.test(desc);
    if (!isRecall || !title || title.length < 8) { skipped++; continue; }

    // Dedup by title
    const { data: existing } = await sb.from('recalls')
      .select('id')
      .ilike('product_name', title.slice(0, 60))
      .eq('source', 'mattilsynet')
      .limit(1);
    if (existing?.length) { skipped++; continue; }

    for (const orgId of orgIds) {
      const { error } = await sb.from('recalls').insert({
        product_name:    title.slice(0, 120),
        description:     desc + (link ? ' [mattilsynet.no]' : ''),
        source:          'mattilsynet',
        active:          true,
        organisation_id: orgId,
        created_at:      pubDate || new Date().toISOString(),
      });
      if (!error) added++;
      else console.warn('[Mattilsynet insert error]', error.message, title);
    }
  }

  return { added, skipped };
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

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseRSSItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = tag => {
      const r = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
      const match = r.exec(block);
      return match ? (match[1] || match[2] || '').trim() : '';
    };
    items.push({
      title:       get('title'),
      description: get('description'),
      link:        get('link'),
      pubDate:     get('pubDate'),
    });
  }
  return items;
}

// Exported for tests.
exports._test = { fdaDescription, recallNumberFrom, stableRecallId, fetchFDA };

// Every run is recorded in job_runs for the daily health check (migration 041).
exports.handler = require('../lib/job-log').withJobLog('fetch-recall-feeds', run);
