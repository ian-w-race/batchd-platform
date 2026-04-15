// netlify/functions/recall-feeds.js
// Proxies RASFF and Mattilsynet recall feeds, normalises to RSS-compatible XML

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/xml; charset=utf-8',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }

  const source = event.queryStringParameters?.source;

  try {
    if (source === 'rasff')            return await fetchRASFF();
    if (source === 'mattilsynet_rss')  return await fetchMattilsynet();
    if (source === 'mattilsynet_page') return await fetchMattilsynet(); // same handler
    return { statusCode: 400, headers, body: xmlError('Unknown source: ' + source) };
  } catch (e) {
    console.error('[recall-feeds]', source, e.message);
    return { statusCode: 502, headers, body: xmlError(e.message) };
  }
};

// ── RASFF ────────────────────────────────────────────────────────
// Uses the RASFF Window backend JSON API — more stable than RSS
async function fetchRASFF() {
  const url = 'https://webgate.ec.europa.eu/rasff-window/backend/public/consumer/notification/search' +
    '?page=0&size=30&sortField=publicationDate&sortDir=DESC';

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Batchd/1.0; +https://batchd.no)',
      'Accept': 'application/json, */*',
      'Referer': 'https://webgate.ec.europa.eu/rasff-window/screen/',
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!resp.ok) {
    throw new Error(`RASFF API returned ${resp.status}`);
  }

  const json = await resp.json();
  const items = json?.results || json?.content || json?.notifications || json || [];

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('RASFF returned empty or unexpected format');
  }

  // Normalise to RSS XML so existing client parser works unchanged
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>RASFF Notifications</title>
    ${items.map(item => {
      const title = esc(
        item.subject || item.title || item.productName || item.product ||
        (item.notifiedProduct ? item.notifiedProduct.productName : null) || 'RASFF Alert'
      );
      const desc = esc([
        item.hazardDescription || item.hazardCategory || '',
        item.origin ? 'Origin: ' + item.origin : '',
        item.notificationType ? 'Type: ' + item.notificationType : '',
        item.referenceNumber ? '[' + item.referenceNumber + ']' : '',
      ].filter(Boolean).join(' · ').slice(0, 300));
      const link = esc(item.referenceNumber
        ? 'https://webgate.ec.europa.eu/rasff-window/screen/?event=notificationDetail&NOTIF_REFERENCE=' + item.referenceNumber
        : 'https://webgate.ec.europa.eu/rasff-window/screen/');
      return `    <item>
      <title>${title}</title>
      <description>${desc}</description>
      <link>${link}</link>
    </item>`;
    }).join('\n')}
  </channel>
</rss>`;

  return { statusCode: 200, headers, body: xml };
}

// ── MATTILSYNET ──────────────────────────────────────────────────
// Fetches the tilbakekallinger HTML page and extracts recall items
async function fetchMattilsynet() {
  const urls = [
    'https://www.mattilsynet.no/mat-og-vann/mattrygghet/tilbakekallinger/',
    'https://www.mattilsynet.no/tilbakekallinger/',
    'https://www.mattilsynet.no/mat-og-vann/tilbakekallinger/',
  ];

  let html = null;
  let lastErr = '';

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*',
          'Accept-Language': 'nb-NO,nb;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
      });
      if (resp.ok) {
        html = await resp.text();
        break;
      }
      lastErr = `${url} → ${resp.status}`;
    } catch (e) {
      lastErr = `${url} → ${e.message}`;
    }
  }

  if (!html) throw new Error('All Mattilsynet URLs failed: ' + lastErr);

  // Extract recall items from the HTML
  // Look for article/list items containing tilbaketrekking/recall keywords
  const items = [];

  // Pattern 1: links with tilbakekallinger path + article title
  const linkMatches = [...html.matchAll(
    /href="([^"]*tilbakekall[^"]*)"[^>]*>([^<]{5,})</gi
  )];

  // Pattern 2: article cards / list items
  const articleMatches = [...html.matchAll(
    /<(?:article|li|div)[^>]*>[\s\S]{0,500}?(?:tilbaketrekk|tilbakekall|recall)[^<]{0,200}/gi
  )];

  // Build items from link matches (most reliable)
  const seen = new Set();
  for (const m of linkMatches.slice(0, 30)) {
    const href = m[1];
    const rawTitle = m[2].trim().replace(/\s+/g, ' ');
    if (rawTitle.length < 8 || seen.has(href)) continue;
    seen.add(href);
    const isRecall = /tilbaketrekk|tilbakekall|recall|trekkes tilbake/i.test(rawTitle + href);
    if (!isRecall) continue;
    items.push({
      title: rawTitle,
      link: href.startsWith('http') ? href : 'https://www.mattilsynet.no' + href,
      desc: 'Mattilsynet tilbaketrekking. ' + rawTitle,
    });
  }

  // Fallback: extract h-tags near tilbaketrekk keywords
  if (items.length === 0) {
    const headingMatches = [...html.matchAll(/<h[2-4][^>]*>([^<]{10,})<\/h[2-4]>/gi)];
    for (const m of headingMatches) {
      const title = m[1].trim();
      if (/tilbaketrekk|tilbakekall/i.test(title)) {
        items.push({ title, link: 'https://www.mattilsynet.no/mat-og-vann/mattrygghet/tilbakekallinger/', desc: title });
      }
    }
  }

  if (items.length === 0) {
    throw new Error('No recall items found on Mattilsynet page (structure may have changed)');
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Mattilsynet Tilbakekallinger</title>
    ${items.map(item => `    <item>
      <title>${esc(item.title)}</title>
      <description>${esc(item.desc)}</description>
      <link>${esc(item.link)}</link>
      <extra1>Tilbaketrekking</extra1>
    </item>`).join('\n')}
  </channel>
</rss>`;

  return { statusCode: 200, headers, body: xml };
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function xmlError(msg) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><error>${esc(msg)}</error></channel></rss>`;
}
