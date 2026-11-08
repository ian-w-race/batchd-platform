// netlify/functions/fetch-fda-announcements-background.js
//
// Improvement plan B5, stage 2 (docs/B5-FEEDS-BACKSTOP-PLAN.md): FDA recall
// announcements reach the catalog on the day they are published, weeks
// before the enforcement report lists them.
//
// A Netlify background function (the "-background" suffix): the caller gets
// 202 at once and this runs for up to 15 minutes, which the article fetches
// and the AI reads need. It is started by fetch-recall-feeds.js at the end of
// its daily run and accepts only the internal secret (INTERNAL_NOTIFY_SECRET,
// header x-internal-secret), never a user.
//
// What it does, once a day:
//   1. Reads the FDA "Recalls, Market Withdrawals, & Safety Alerts" RSS feed
//      (about 20 newest items, every product type).
//   2. Skips items already in the catalog (external_key "press|<guid>|<n>").
//   3. Fetches each new article, reads its "Product Type" and skips anything
//      that is not food, a beverage or a dietary supplement, without AI.
//   4. Hands the article text to the supplier notice reader (the same schema
//      and prompt as netlify/lib/recall-notice.js; Ian's decision 1 of the
//      B5 plan: Batch'd pays, about 20 reads a week), which lists the
//      products with their GTINs, lots, ranges and best-by dates.
//   5. Writes one recall_catalog entry per product, kind 'announcement',
//      with notice_url and no recall number, and sweeps each new entry
//      against every US organization's scans (sweep_catalog_matches).
// At most MAX_READS articles are read per run, so a quiet feed costs nothing
// and a busy week catches up over a few days. Every run is a job_runs row.
//
// The FDA text is untrusted data: the reader is told so, and only the
// values it returns are stored, never followed.

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { internalSecretOk } = require('../lib/auth');
const { MODEL, NOTICE_SCHEMA, SYSTEM_PROMPT, normalizeExtraction } = require('../lib/recall-notice');
const lotCodes = require('../../src/shared/lot-codes.cjs');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RSS_URL = 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml';
const MAX_READS = 10;
const ARTICLE_MAX_CHARS = 60000;
const FOOD_TYPES = /\b(food|beverage|dietary supplement)/i;

// ── The feed and the article ───────────────────────────────────────────────
function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}
const tag = (xml, name) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? decodeEntities(m[1]).trim() : '';
};

// The RSS items: title, link, guid, pubDate (ISO), description.
function parseRss(xml) {
  const items = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const it = m[1];
    const link = tag(it, 'link');
    const guid = tag(it, 'guid') || link;
    if (!guid) continue;
    const pub = tag(it, 'pubDate');
    const d = pub ? new Date(pub) : null;
    items.push({
      title: tag(it, 'title'),
      link,
      guid,
      pubDate: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
      description: tag(it, 'description'),
    });
  }
  return items;
}

// The article page: its visible text and the FDA's "Product Type" line.
function articleText(html) {
  let h = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const main = /<main[\s>][\s\S]*?<\/main>/i.exec(h) || /<article[\s>][\s\S]*?<\/article>/i.exec(h);
  if (main) h = main[0];
  const text = decodeEntities(h.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h\d>|<\/tr>|<\/td>|<\/th>|<\/dt>|<\/dd>|<\/section>|<\/header>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  // The label at the start of its own line ("Product Type:" then the value on
  // the same or the next line), never the words inside a sentence.
  const pt = /(?:^|\n)\s*Product Type\s*:?\s*\n?\s*([^\n]{3,120})/i.exec(text);
  return { text: text.slice(0, ARTICLE_MAX_CHARS), productType: pt ? pt[1].trim() : null };
}

const isFood = (productType) => !!productType && FOOD_TYPES.test(productType);

// ── The reader ─────────────────────────────────────────────────────────────
async function readAnnouncement(client, item, text) {
  const content = [
    { type: 'text', text: `<notice source="FDA public recall announcement" url="${String(item.link || '').replace(/["<>]/g, '')}">\n${item.title}\n\n${text}\n</notice>` },
    { type: 'text', text: 'This is a public FDA recall announcement, not a notice sent to one retailer. Read it and fill the schema. If the product is not a food, a beverage or a dietary supplement, set is_recall_notice to false.' },
  ];
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: NOTICE_SCHEMA } },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The AI declined to read this announcement.');
  if (response.stop_reason === 'max_tokens') throw new Error('The announcement is too long to read in one pass.');
  const out = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(out); } catch { throw new Error('The AI answer was not valid JSON.'); }
  return normalizeExtraction(parsed);
}

// ── Catalog rows ───────────────────────────────────────────────────────────
const CLASS_TEXT = { class_i: 'Class I', class_ii: 'Class II', class_iii: 'Class III' };

function rowsFor(item, extracted) {
  const rows = [];
  const products = (extracted.products || []).slice(0, 20);
  const headline = `${item.title} ${item.description}`;
  products.forEach((p, n) => {
    const desc = p.description || 'Unnamed product';
    const name = p.brand && !desc.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.brand} ${desc}` : desc;
    const codeBits = [];
    if (p.lots.length) codeBits.push('Lots: ' + p.lots.join(', '));
    p.lot_ranges.forEach((r) => codeBits.push(`Lots ${r.from} through ${r.to}`));
    if (p.best_by_from) codeBits.push('Best by ' + p.best_by_from + (p.best_by_to && p.best_by_to !== p.best_by_from ? ' to ' + p.best_by_to : ''));
    if (p.gtins.length) codeBits.push('UPC ' + p.gtins.join(', '));
    const noCodes = !p.lots.length && !p.lot_ranges.length && !p.best_by_from;
    const allLots = noCodes && /\ball\s+(lots?|codes?|dates?|varieties|products?|sizes?)\b/i.test(headline + ' ' + desc);
    rows.push({
      source: 'fda',
      kind: 'announcement',
      external_key: `press|${item.guid}|${n}`,
      event_key: null,
      recall_number: null,
      product_name: name.slice(0, 120),
      product_description: [name, p.size].filter(Boolean).join(', ').slice(0, 4000),
      code_info: codeBits.join('; ').slice(0, 4000) || null,
      lots: p.lots.slice(0, 50),
      gtins: p.gtins,
      lot_ranges: p.lot_ranges,
      best_by_from: p.best_by_from,
      best_by_to: p.best_by_to || p.best_by_from,
      all_lots: allLots,
      match_terms: p.match_terms,
      recalling_firm: (extracted.recalling_firm || '').slice(0, 200) || null,
      classification: CLASS_TEXT[extracted.classification] || null,
      reason: (extracted.reason || item.title || '').slice(0, 4000) || null,
      feed_status: 'Announced',
      report_date: item.pubDate ? item.pubDate.slice(0, 10) : null,
      published_at: item.pubDate,
      notice_url: item.link || null,
      parser_version: lotCodes.PARSER_VERSION,
      raw: { rss: item, extracted, read_at: new Date().toISOString() },
    });
  });
  return rows;
}

// ── The run ────────────────────────────────────────────────────────────────
async function run(event, deps = {}) {
  if (event && event.httpMethod && event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  const h = (event && event.headers) || {};
  const given = h['x-internal-secret'] || h['X-Internal-Secret'] || String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!internalSecretOk(given)) return { statusCode: 403, body: JSON.stringify({ error: 'forbidden' }) };
  if (process.env.SCHEDULED_FUNCTIONS_DISABLED === 'true') {
    return { statusCode: 200, body: JSON.stringify({ skipped: 'scheduled functions disabled on this site' }) };
  }

  const sb = deps.sb || createClient(SUPABASE_URL, SUPABASE_KEY);
  const result = { items: 0, known: 0, not_food: 0, read: 0, not_recalls: 0, entries_added: 0, matches: 0, errors: [] };

  const feedRes = await fetch(RSS_URL, { headers: { 'User-Agent': 'Batched-RecallTracker/1.0 (batchdapp.com)' }, signal: AbortSignal.timeout(10000) });
  if (!feedRes.ok) throw new Error('FDA RSS returned ' + feedRes.status);
  const items = parseRss(await feedRes.text());
  result.items = items.length;

  const { data: existing, error: exErr } = await sb.from('recall_catalog')
    .select('external_key').eq('kind', 'announcement').like('external_key', 'press|%').limit(5000);
  if (exErr) throw new Error('Could not read the catalog: ' + exErr.message);
  const knownGuids = new Set((existing || []).map((r) => String(r.external_key).split('|').slice(1, -1).join('|')));

  let client = deps.client || null;
  const newRows = [];
  for (const item of items) {
    if (knownGuids.has(item.guid)) { result.known++; continue; }
    if (result.read >= MAX_READS) break;
    try {
      const page = await fetch(item.link, { headers: { 'User-Agent': 'Batched-RecallTracker/1.0 (batchdapp.com)' }, signal: AbortSignal.timeout(15000) });
      if (!page.ok) throw new Error('article ' + page.status);
      const { text, productType } = articleText(await page.text());
      if (productType && !isFood(productType)) { result.not_food++; continue; }
      if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      result.read++;
      const extracted = await readAnnouncement(client, item, text);
      if (!extracted.is_recall_notice || !extracted.products.length) { result.not_recalls++; continue; }
      newRows.push(...rowsFor(item, extracted));
    } catch (e) {
      console.error('[fda-announcements]', item.guid, e && e.message);
      result.errors.push(`${item.guid}: ${String(e && e.message || e).slice(0, 160)}`);
    }
  }

  if (newRows.length) {
    const { data: inserted, error: insErr } = await sb.from('recall_catalog')
      .upsert(newRows, { onConflict: 'source,external_key', ignoreDuplicates: true })
      .select('id');
    if (insErr) throw new Error('Catalog insert failed: ' + insErr.message);
    const ids = (inserted || []).map((r) => r.id).filter(Boolean);
    result.entries_added = ids.length;
    for (let i = 0; i < ids.length; i += 10) {
      const res = await Promise.all(ids.slice(i, i + 10).map((id) => sb.rpc('sweep_catalog_matches', { p_catalog_id: id, p_lookback_days: 180 })));
      for (const r of res) { if (r.error) throw new Error('sweep_catalog_matches failed: ' + r.error.message); result.matches += Number(r.data) || 0; }
    }
  }

  console.log('[fda-announcements] Complete:', JSON.stringify(result));
  return { statusCode: 200, body: JSON.stringify({ ...result, errors: result.errors.length ? result.errors : undefined, timestamp: new Date().toISOString() }) };
}

exports._test = { run, parseRss, articleText, isFood, rowsFor, readAnnouncement };
// Every run is recorded in job_runs for the daily health check (migration 041).
exports.handler = require('../lib/job-log').withJobLog('fetch-fda-announcements', (event) => run(event));
