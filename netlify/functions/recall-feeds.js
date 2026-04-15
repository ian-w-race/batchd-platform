// netlify/functions/recall-feeds.js
// Proxies RASFF and Mattilsynet feeds, returns RSS-compatible XML

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/xml; charset=utf-8' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  const source = event.queryStringParameters?.source;
  try {
    if (source === 'rasff')           return await fetchRASFF();
    if (source === 'mattilsynet_rss') return await fetchMattilsynet();
    if (source === 'mattilsynet_page')return await fetchMattilsynet();
    return { statusCode: 400, headers: CORS, body: xmlWrap([]) };
  } catch (e) {
    console.error('[recall-feeds]', source, e.message);
    return { statusCode: 502, headers: CORS, body: xmlWrap([], e.message) };
  }
};

// ── RASFF ─────────────────────────────────────────────────────────
async function fetchRASFF() {
  // Try JSON search API first (most reliable)
  const endpoints = [
    'https://webgate.ec.europa.eu/rasff-window/backend/public/consumer/notification/search?page=0&size=30&sortField=publicationDate&sortDir=DESC',
    'https://webgate.ec.europa.eu/rasff-window/backend/public/consumer/notification/search?pageNumber=0&pageSize=30',
    'https://webgate.ec.europa.eu/rasff-window/backend/public/consumer/rss/feed.rss',
    'https://webgate.ec.europa.eu/rasff-window/backend/public/consumer/notification/rss/all',
  ];

  const fetchOpts = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json, application/xml, text/xml, */*',
      'Referer': 'https://webgate.ec.europa.eu/rasff-window/screen/',
      'Origin': 'https://webgate.ec.europa.eu',
    },
    signal: AbortSignal.timeout(12000),
    redirect: 'follow',
  };

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, fetchOpts);
      if (!resp.ok) { console.warn('[RASFF] ' + url + ' → ' + resp.status); continue; }

      const text = await resp.text();
      console.log('[RASFF] fetched from ' + url + ', length=' + text.length);

      // Detect if XML (RSS)
      if (text.trim().startsWith('<')) {
        // Already RSS — just pass it through
        return { statusCode: 200, headers: CORS, body: text };
      }

      // Parse JSON — try many possible structures
      let json;
      try { json = JSON.parse(text); } catch(e) { console.warn('[RASFF] JSON parse error:', e.message, text.slice(0,200)); continue; }

      // Log structure for debugging
      console.log('[RASFF] JSON keys:', Object.keys(json || {}).join(', '));
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        for (const k of Object.keys(json)) {
          if (Array.isArray(json[k])) console.log('[RASFF] Array field "' + k + '" length=' + json[k].length);
        }
      }

      // Extract item array — try every possible field name
      const candidates = Array.isArray(json) ? json
        : json?.results || json?.data || json?.content || json?.items
        || json?.notifications || json?.alerts || json?.records
        || json?.notificationList || json?.list || json?.rows || [];

      if (!candidates.length) { console.warn('[RASFF] 0 items from ' + url + ', raw:', text.slice(0,300)); continue; }

      const items = candidates.map(item => ({
        title: item.subject || item.title || item.product || item.productName
          || item.commodity?.name || item.notifiedProduct?.name || item.name
          || item.alert_title || item.notificationTitle || 'RASFF Alert',
        desc: [
          item.hazardDescription || item.hazard || item.hazardCategory || item.danger || '',
          item.origin || item.countryOfOrigin || item.country_origin || '',
          item.notificationType || item.type || item.classification || '',
          item.referenceNumber || item.reference || item.ref || '',
        ].filter(Boolean).join(' · ').slice(0, 300),
        link: item.referenceNumber
          ? 'https://webgate.ec.europa.eu/rasff-window/screen/?event=notificationDetail&NOTIF_REFERENCE=' + item.referenceNumber
          : item.link || item.url || 'https://webgate.ec.europa.eu/rasff-window/screen/',
      }));

      console.log('[RASFF] built ' + items.length + ' items');
      return { statusCode: 200, headers: CORS, body: xmlWrap(items, null, 'RASFF Notifications') };

    } catch (e) {
      console.warn('[RASFF] failed ' + url + ':', e.message);
    }
  }

  throw new Error('All RASFF endpoints failed or returned 0 items');
}

// ── MATTILSYNET ──────────────────────────────────────────────────
async function fetchMattilsynet() {
  const fetchOpts = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml,application/json,*/*',
      'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8',
    },
    signal: AbortSignal.timeout(12000),
    redirect: 'follow',
  };

  const items = [];

  // Strategy 1: Try JSON API (Enonic CMS pattern used by Norwegian govt sites)
  const apiUrls = [
    'https://www.mattilsynet.no/api/content/search?query=tilbaketrekk&contentTypes=[no.enonic.app.main:article]&start=0&count=20',
    'https://www.mattilsynet.no/_/service/com.enonic.app.main/search?query=tilbaketrekk&count=20',
    'https://www.mattilsynet.no/api/tilbakekallinger',
  ];

  for (const url of apiUrls) {
    try {
      const resp = await fetch(url, fetchOpts);
      if (!resp.ok) continue;
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('json')) {
        const json = await resp.json();
        console.log('[Mattilsynet API] keys:', Object.keys(json || {}).join(', '));
        const hits = json?.hits || json?.results || json?.items || json?.data || [];
        for (const h of hits.slice(0, 25)) {
          const title = h.title || h.displayName || h.name || '';
          const path  = h.path || h._path || h.url || '';
          if (title && (path || title)) {
            items.push({
              title,
              desc: 'Mattilsynet tilbaketrekking. ' + title,
              link: path.startsWith('http') ? path : 'https://www.mattilsynet.no' + path,
            });
          }
        }
        if (items.length > 0) { console.log('[Mattilsynet] got ' + items.length + ' from API'); break; }
      }
    } catch(e) { console.warn('[Mattilsynet API]', url, e.message); }
  }

  // Strategy 2: Scrape HTML tilbakekallinger listing
  if (items.length === 0) {
    const pageUrls = [
      'https://www.mattilsynet.no/mat-og-vann/mattrygghet/tilbakekallinger/',
      'https://www.mattilsynet.no/tilbakekallinger/',
    ];
    for (const url of pageUrls) {
      try {
        const resp = await fetch(url, fetchOpts);
        if (!resp.ok) continue;
        const html = await resp.text();
        console.log('[Mattilsynet HTML] fetched ' + url + ', length=' + html.length);

        // Extract article links — Norwegian govt sites typically have <a href="/...">Title</a>
        const patterns = [
          // Specific tilbakekallinger article URLs
          /href="(\/[^"]*tilbakekall[^"]{3,})"[^>]*>\s*<[^>]+>\s*([^<]{10,})/gi,
          // Any article link with recall content nearby
          /href="(\/[^"]{10,})"[^>]*>([^<]{15,})<\/a>/gi,
        ];

        const seen = new Set();
        for (const pattern of patterns) {
          const matches = [...html.matchAll(pattern)];
          for (const m of matches) {
            const href  = m[1];
            const title = m[2].trim().replace(/\s+/g, ' ');
            if (title.length < 10 || seen.has(href)) continue;
            if (!/tilbaketrekk|tilbakekall|recall|trekkes|kalles tilbake/i.test(title + href)) continue;
            seen.add(href);
            items.push({
              title,
              desc: 'Mattilsynet. ' + title,
              link: href.startsWith('http') ? href : 'https://www.mattilsynet.no' + href,
            });
          }
          if (items.length >= 5) break;
        }
        if (items.length > 0) { console.log('[Mattilsynet HTML] got ' + items.length + ' items'); break; }
      } catch(e) { console.warn('[Mattilsynet HTML]', url, e.message); }
    }
  }

  // Strategy 3: Mattilsynet news RSS (filter for recalls client-side)
  if (items.length === 0) {
    try {
      const resp = await fetch('https://www.mattilsynet.no/nyheter.rss', fetchOpts);
      if (resp.ok) {
        const xml = await resp.text();
        console.log('[Mattilsynet RSS] length=' + xml.length);
        // Pass through the RSS directly — client already filters for tilbaketrekk
        return { statusCode: 200, headers: CORS, body: xml };
      }
    } catch(e) { console.warn('[Mattilsynet RSS]', e.message); }
  }

  if (items.length === 0) throw new Error('Mattilsynet: no recall items found across all strategies');

  console.log('[Mattilsynet] returning ' + items.length + ' items');
  return { statusCode: 200, headers: CORS, body: xmlWrap(items, null, 'Mattilsynet Tilbakekallinger') };
}

// ── Helpers ────────────────────────────────────────────────────────
function xmlWrap(items, error, channelTitle) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${esc(channelTitle || 'Recall Feed')}</title>
  ${error ? '<error>' + esc(error) + '</error>' : ''}
  ${items.map(item => `<item>
    <title>${esc(item.title)}</title>
    <description>${esc(item.desc || '')}</description>
    <link>${esc(item.link || '')}</link>
    <extra1>Tilbaketrekking</extra1>
  </item>`).join('\n  ')}
</channel></rss>`;
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
