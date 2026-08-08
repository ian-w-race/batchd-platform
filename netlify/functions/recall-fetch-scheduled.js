// netlify/functions/recall-fetch-scheduled.js
// Runs daily via Netlify scheduled functions — fetches all recall sources
// and stores results directly in Supabase, so the app always has fresh data
// without depending on a user triggering a manual fetch.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async () => {
  console.log('[recall-cron] Starting daily recall fetch', new Date().toISOString());

  if (!SUPABASE_SERVICE_KEY) {
    console.error('[recall-cron] Missing SUPABASE_SERVICE_KEY env var');
    return { statusCode: 500, body: 'Missing SUPABASE_SERVICE_KEY' };
  }

  const results = {};

  // ── 1. FDA ──────────────────────────────────────────────────────
  try {
    const resp = await fetch(
      'https://api.fda.gov/food/enforcement.json?search=status:Ongoing&limit=50&sort=report_date:desc',
      { signal: AbortSignal.timeout(15000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      let added = 0;
      for (const r of (data.results || [])) {
        const { data: existing } = await sbFetch('GET',
          `/rest/v1/recalls?select=id&source=eq.fda&description=eq.${encodeURIComponent((r.recall_number||'').slice(0,80))}&limit=1`
        );
        if (existing?.length) continue;
        const err = await sbFetch('POST', '/rest/v1/recalls', {
          product_name: (r.product_description || 'FDA Recall').slice(0, 120),
          lot_number: (r.code_info || '').slice(0, 200) || null,
          description: ((r.reason_for_recall || '') + (r.recall_number ? ` [${r.recall_number}]` : '')).slice(0, 200),
          source: 'fda',
          active: true,
        });
        if (!err?.error) added++;
      }
      results.fda = '+' + added;
    } else {
      results.fda = '✗ ' + resp.status;
    }
  } catch(e) { results.fda = '✗ ' + e.message.slice(0, 60); }

  // ── 2. RASFF (via our own recall-feeds function) ────────────────
  try {
    const baseUrl = process.env.URL || 'https://batchd-app.netlify.app';
    const resp = await fetch(`${baseUrl}/.netlify/functions/recall-feeds?source=rasff`, {
      signal: AbortSignal.timeout(20000),
    });
    if (resp.ok) {
      const xml = await resp.text();
      const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)];
      let added = 0;
      for (const [itemXml] of items.slice(0, 30)) {
        const title = (itemXml.match(/<title>([^<]*)<\/title>/)?.[1] || '').trim();
        const desc  = (itemXml.match(/<description>([^<]*)<\/description>/)?.[1] || '').trim();
        if (!title || title === 'RASFF Alert') continue;
        const { data: existing } = await sbFetch('GET',
          `/rest/v1/recalls?select=id&source=eq.rasff&product_name=ilike.${encodeURIComponent(title.slice(0,60)+'%')}&limit=1`
        );
        if (existing?.length) continue;
        const err = await sbFetch('POST', '/rest/v1/recalls', {
          product_name: title.slice(0, 120),
          description: desc.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').slice(0, 200),
          source: 'rasff',
          active: true,
        });
        if (!err?.error) added++;
      }
      results.rasff = '+' + added;
    } else {
      results.rasff = '✗ feed-fn ' + resp.status;
    }
  } catch(e) { results.rasff = '✗ ' + e.message.slice(0, 60); }

  // ── 3. Mattilsynet ─────────────────────────────────────────────
  try {
    const baseUrl = process.env.URL || 'https://batchd-app.netlify.app';
    const resp = await fetch(`${baseUrl}/.netlify/functions/recall-feeds?source=mattilsynet_rss`, {
      signal: AbortSignal.timeout(20000),
    });
    if (resp.ok) {
      const xml = await resp.text();
      const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)];
      let added = 0;
      for (const [itemXml] of items.slice(0, 30)) {
        const title = (itemXml.match(/<title>([^<]*)<\/title>/)?.[1] || '').trim();
        const desc  = (itemXml.match(/<description>([^<]*)<\/description>/)?.[1] || '').trim();
        if (!title || title === 'Tilbakekallinger') continue;
        const { data: existing } = await sbFetch('GET',
          `/rest/v1/recalls?select=id&source=eq.mattilsynet&product_name=ilike.${encodeURIComponent(title.slice(0,60)+'%')}&limit=1`
        );
        if (existing?.length) continue;
        const err = await sbFetch('POST', '/rest/v1/recalls', {
          product_name: title.slice(0, 120),
          description: desc.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').slice(0, 200),
          source: 'mattilsynet',
          active: true,
        });
        if (!err?.error) added++;
      }
      results.mattilsynet = '+' + added;
    } else {
      results.mattilsynet = '✗ feed-fn ' + resp.status;
    }
  } catch(e) { results.mattilsynet = '✗ ' + e.message.slice(0, 60); }

  const summary = Object.entries(results).map(([k,v]) => k + ': ' + v).join(' · ');
  console.log('[recall-cron] Done:', summary);
  return { statusCode: 200, body: summary };
};

// ── Supabase REST helper ────────────────────────────────────────
async function sbFetch(method, path, body) {
  const resp = await fetch(SUPABASE_URL + path, {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=minimal' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  try { return await resp.json(); } catch { return null; }
}
