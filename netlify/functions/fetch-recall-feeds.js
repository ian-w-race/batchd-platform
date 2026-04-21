// ================================================================
// fetch-recall-feeds.js — Batch'd scheduled Netlify function
// Pulls FDA and Mattilsynet recall feeds once daily and inserts
// new records into the recalls table for each org in the relevant
// region.
//
// Schedule: daily at 06:00 UTC (configured in netlify.toml)
// Also callable on-demand via POST from the dashboard.
//
// Sources:
//   FDA    — api.fda.gov/food/enforcement.json (US orgs)
//   Mattilsynet — mattilsynet.no RSS feed (NO/EU orgs)
//
// Note: RASFF has no reliable public API. It is not included.
// ================================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Netlify native scheduled function — runs daily at 06:00 UTC
exports.schedule = '0 6 * * *';

exports.handler = async (event) => {
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
async function fetchFDA(sb, orgIds) {
  const url = 'https://api.fda.gov/food/enforcement.json?limit=50&sort=report_date:desc';
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Batched-RecallTracker/1.0 (batchd-app.netlify.app)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error('FDA API returned ' + resp.status);

  const json = await resp.json();
  const results = json.results || [];
  let added = 0, skipped = 0;

  for (const r of results) {
    const productName = (r.product_description || '').slice(0, 120);
    const lotNumber   = (r.code_info || '').slice(0, 80) || null;
    const description = ((r.reason_for_recall || '') + (r.recall_number ? ` [${r.recall_number}]` : '')).slice(0, 200);
    const recallDate  = r.report_date ? parseDate(r.report_date) : null;

    if (!productName) { skipped++; continue; }

    // Dedup check: same product + recall_number already in DB?
    const dedupeKey = r.recall_number || productName.slice(0, 40);
    const { data: existing } = await sb.from('recalls')
      .select('id')
      .ilike('description', '%' + (r.recall_number || productName.slice(0, 20)) + '%')
      .limit(1);
    if (existing?.length) { skipped++; continue; }

    // Insert for every US org
    for (const orgId of orgIds) {
      const { error } = await sb.from('recalls').insert({
        product_name:    productName,
        lot_number:      lotNumber,
        description,
        source:          'fda',
        active:          true,
        organisation_id: orgId,
        created_at:      recallDate || new Date().toISOString(),
      });
      if (!error) added++;
      else console.warn('[FDA insert error]', error.message, productName);
    }
  }

  return { added, skipped };
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
