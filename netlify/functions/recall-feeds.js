// netlify/functions/recall-feeds.js
// Proxies external recall feeds, normalises to RSS-compatible XML

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/xml; charset=utf-8' };

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, application/xml, text/xml, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  const source = event.queryStringParameters?.source;
  try {
    if (source === 'rasff')            return await fetchRASFF();
    if (source === 'mattilsynet_rss')  return await fetchMattilsynet();
    if (source === 'mattilsynet_page') return await fetchMattilsynet();
    return { statusCode: 400, headers: CORS, body: xmlWrap([], 'Unknown source: ' + source) };
  } catch (e) {
    console.error('[recall-feeds]', source, e.message);
    return { statusCode: 502, headers: CORS, body: xmlWrap([], e.message) };
  }
};

// ── Helpers ────────────────────────────────────────────────────────
function isHTML(text) {
  const t = text.trimStart().toLowerCase();
  return t.startsWith('<!doctype html') || t.startsWith('<html');
}
function isRSS(text) {
  const t = text.trimStart().toLowerCase();
  return t.startsWith('<?xml') || t.startsWith('<rss') || t.startsWith('<feed');
}
async function tryFetch(url, opts = {}) {
  const resp = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(12000),
    redirect: 'follow',
    ...opts,
  });
  if (!resp.ok) return { ok: false, status: resp.status };
  const text = await resp.text();
  return { ok: true, text, status: resp.status };
}

// ── RASFF ─────────────────────────────────────────────────────────
// EU RASFF backend requires auth — use alternative public sources
async function fetchRASFF() {
  const sources = [
    // EFSA (European Food Safety Authority) — public RSS, covers same EU food alerts
    { url: 'https://www.efsa.europa.eu/en/rss/alerts', type: 'rss' },
    // food.gov.uk safety alerts RSS (UK FSA, re-publishes EU RASFF notifications)
    { url: 'https://www.food.gov.uk/news-alerts/alerts/rss', type: 'rss' },
    // RASFF direct RSS attempt with JSON Accept header to avoid HTML redirect
    {
      url: 'https://webgate.ec.europa.eu/rasff-window/backend/public/consumer/notification/rss/latest',
      type: 'rss',
      headers: { ...BROWSER_HEADERS, 'Accept': 'application/rss+xml, application/xml, text/xml' }
    },
    {
      url: 'https://webgate.ec.europa.eu/rasff-window/backend/public/consumer/rss/feed.rss',
      type: 'rss',
      headers: { ...BROWSER_HEADERS, 'Accept': 'application/rss+xml, application/xml, text/xml' }
    },
  ];

  for (const src of sources) {
    try {
      const r = await fetch(src.url, {
        headers: src.headers || BROWSER_HEADERS,
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      });
      if (!r.ok) { console.warn('[RASFF] ' + src.url + ' → ' + r.status); continue; }
      const text = await r.text();
      console.log('[RASFF] ' + src.url + ' → ' + r.status + ' len=' + text.length + ' html=' + isHTML(text));
      if (isHTML(text)) { console.warn('[RASFF] Got HTML from ' + src.url + ' (auth redirect) — skipping'); continue; }
      if (isRSS(text) && text.includes('<item')) {
        console.log('[RASFF] Valid RSS from ' + src.url);
        return { statusCode: 200, headers: CORS, body: text };
      }
      // Try JSON
      if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        let json;
        try { json = JSON.parse(text); } catch(e) { continue; }
        const arr = json?.results || json?.data || json?.items || json?.notifications || (Array.isArray(json) ? json : []);
        console.log('[RASFF] JSON from ' + src.url + ', ' + arr.length + ' items');
        if (!arr.length) continue;
        const items = arr.map(item => ({
          title: item.subject || item.title || item.product || item.productName || item.commodity?.name || 'RASFF Alert',
          desc: [item.hazardDescription||item.hazard||'', item.origin||item.countryOfOrigin||'', item.referenceNumber||item.reference||''].filter(Boolean).join(' · ').slice(0,300),
          link: item.referenceNumber ? 'https://webgate.ec.europa.eu/rasff-window/screen/?event=notificationDetail&NOTIF_REFERENCE='+item.referenceNumber : src.url,
        }));
        return { statusCode: 200, headers: CORS, body: xmlWrap(items, null, 'RASFF / EU Food Safety Alerts') };
      }
    } catch (e) {
      console.warn('[RASFF] ' + src.url + ':', e.message);
    }
  }
  throw new Error('All RASFF sources unavailable — try again later');
}

// ── MATTILSYNET ───────────────────────────────────────────────────
async function fetchMattilsynet() {
  // Strategy 1: Norwegian open data API
  const apiAttempts = [
    'https://data.mattilsynet.no/api/tilbakekallinger?limit=30',
    'https://www.mattilsynet.no/api/content/search?contentTypes=no.enonic.app.site.main:article&query=tilbaketrekk&count=20&start=0',
    'https://www.mattilsynet.no/_/component/page/main/top-page-region/header?type=json',
  ];

  for (const url of apiAttempts) {
    try {
      const r = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(8000), redirect: 'follow' });
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) continue;
      const json = await r.json();
      const hits = json?.hits || json?.results || json?.items || json?.data || [];
      if (hits.length > 0) {
        console.log('[Mattilsynet API] ' + url + ' → ' + hits.length + ' items');
        const items = hits.slice(0, 30).map(h => ({
          title: h.title || h.displayName || h.name || h.heading || '',
          desc: (h.preamble || h.intro || h.description || h.title || '').slice(0, 200),
          link: (h.path||h._path||h.url||'').startsWith('http') ? (h.path||h._path||h.url) : 'https://www.mattilsynet.no' + (h.path||h._path||h.url||''),
        })).filter(i => i.title.length > 5);
        if (items.length > 0) return { statusCode: 200, headers: CORS, body: xmlWrap(items, null, 'Mattilsynet Tilbakekallinger') };
      }
    } catch(e) { console.warn('[Mattilsynet API]', url, e.message); }
  }

  // Strategy 2: Scrape HTML listing page
  const pageUrls = [
    'https://www.mattilsynet.no/mat-og-vann/mattrygghet/tilbakekallinger/',
    'https://www.mattilsynet.no/mat-og-vann/tilbakekallinger/',
    'https://www.mattilsynet.no/tilbakekallinger/',
  ];

  for (const url of pageUrls) {
    try {
      const r = await fetch(url, { headers: { ...BROWSER_HEADERS, 'Accept': 'text/html' }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
      if (!r.ok) continue;
      const html = await r.text();
      console.log('[Mattilsynet HTML] ' + url + ' len=' + html.length + ' isHTML=' + isHTML(html));
      if (!html || html.length < 500) continue;

      // Look for inline JSON data (SSR data blobs common in modern CMS sites)
      const jsonBlobs = [...html.matchAll(/window\.__[A-Z_]+__\s*=\s*(\{[\s\S]{20,3000}\});/g)];
      for (const [, blob] of jsonBlobs) {
        try {
          const data = JSON.parse(blob);
          const items = extractRecallsFromObject(data);
          if (items.length > 0) { console.log('[Mattilsynet SSR blob] found ' + items.length + ' items'); return { statusCode: 200, headers: CORS, body: xmlWrap(items, null, 'Mattilsynet Tilbakekallinger') }; }
        } catch(e) {}
      }

      // HTML link extraction
      const items = [];
      const seen = new Set();
      // Pattern: article cards with recall-related content
      const linkRe = /href="(\/[^"]{15,})"[^>]*>\s*(?:<[^>]+>)*\s*([^<]{10,})/g;
      for (const [, href, rawTitle] of html.matchAll(linkRe)) {
        const title = rawTitle.trim().replace(/\s+/g, ' ');
        if (seen.has(href) || title.length < 10) continue;
        if (!/tilbaketrekk|tilbakekall|recall/i.test(title + href)) continue;
        if (/meny|navigasjon|header|footer|cookie/i.test(href)) continue;
        seen.add(href);
        items.push({ title, desc: 'Mattilsynet. ' + title, link: 'https://www.mattilsynet.no' + href });
        if (items.length >= 20) break;
      }

      if (items.length > 0) {
        console.log('[Mattilsynet HTML] extracted ' + items.length + ' recall links');
        return { statusCode: 200, headers: CORS, body: xmlWrap(items, null, 'Mattilsynet Tilbakekallinger') };
      }
      console.warn('[Mattilsynet HTML] 0 items from ' + url + ' — page may be JS-rendered');
    } catch(e) { console.warn('[Mattilsynet HTML]', url, e.message); }
  }

  // Strategy 3: Mattilsynet news RSS (filter recall items client-side)
  const rssUrls = ['https://www.mattilsynet.no/nyheter.rss', 'https://www.mattilsynet.no/rss'];
  for (const url of rssUrls) {
    try {
      const r = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const text = await r.text();
      if (isRSS(text) && !isHTML(text)) {
        console.log('[Mattilsynet RSS] ' + url + ' → len=' + text.length);
        return { statusCode: 200, headers: CORS, body: text };
      }
    } catch(e) {}
  }

  throw new Error('Mattilsynet: no data found across all strategies (page may be JS-rendered)');
}

function extractRecallsFromObject(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return [];
  const items = [];
  if (Array.isArray(obj)) { for (const item of obj) items.push(...extractRecallsFromObject(item, depth+1)); return items; }
  const title = obj.title || obj.displayName || obj.heading || obj.name || '';
  const path  = obj.path || obj._path || obj.url || obj.href || '';
  if (title && /tilbaketrekk|tilbakekall/i.test(title + path)) {
    items.push({ title, desc: title, link: path.startsWith('http') ? path : 'https://www.mattilsynet.no' + path });
  }
  for (const v of Object.values(obj)) items.push(...extractRecallsFromObject(v, depth+1));
  return items.slice(0, 30);
}

function xmlWrap(items, error, channelTitle) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${esc(channelTitle || 'Recall Feed')}</title>
  ${error ? '<e>' + esc(error) + '</e>' : ''}
  ${(items||[]).map(i => `<item>
    <title>${esc(i.title)}</title>
    <description>${esc(i.desc||'')}</description>
    <link>${esc(i.link||'')}</link>
    <extra1>Tilbaketrekking</extra1>
  </item>`).join('\n  ')}
</channel></rss>`;
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
