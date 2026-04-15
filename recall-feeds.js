// netlify/functions/recall-feeds.js
// Proxies external recall feeds to avoid CORS issues in the browser
// Cached 30 minutes per source

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const cache = {};

const SOURCES = {
  rasff: {
    // EU RASFF public RSS — multiple URL variants as the EU reorganises endpoints
    url: 'https://webgate.ec.europa.eu/rasff-window/backend/public/consumer/rss/feed.rss',
    fallback: 'https://webgate.ec.europa.eu/rasff-window/backend/public/consumer/notification/rss/all',
    fallback2: 'https://webgate.ec.europa.eu/rasff-window/screen/rss.cfm',
    contentType: 'application/xml'
  },
  mattilsynet_rss: {
    // Mattilsynet restructured their site — try current paths first
    url: 'https://www.mattilsynet.no/mat-og-vann/mattrygghet/tilbakekallinger/feed.rss',
    fallback: 'https://www.mattilsynet.no/tilbakekallinger.rss',
    fallback2: 'https://www.mattilsynet.no/rss/nyheter.rss',
    contentType: 'application/xml'
  },
  mattilsynet_page: {
    url: 'https://www.mattilsynet.no/mat-og-vann/mattrygghet/tilbakekallinger/',
    fallback: 'https://www.mattilsynet.no/tilbakekallinger/',
    contentType: 'text/html'
  }
};

exports.handler = async (event) => {
  const source = event.queryStringParameters?.source;

  if (!source || !SOURCES[source]) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid source. Use: rasff, mattilsynet_rss, mattilsynet_page' })
    };
  }

  // Check cache
  const now = Date.now();
  if (cache[source] && (now - cache[source].ts) < CACHE_TTL) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': SOURCES[source].contentType,
        'Access-Control-Allow-Origin': '*',
        'X-Cache': 'HIT'
      },
      body: cache[source].body
    };
  }

  const cfg = SOURCES[source];
  let body = null;
  let lastError = null;

  // Try primary URL
  try {
    const res = await fetch(cfg.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Batchd/1.0; +https://batchd.no)',
        'Accept': 'application/rss+xml, application/xml, text/xml, text/html, */*'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      body = await res.text();
    } else {
      lastError = `Primary URL returned ${res.status}`;
    }
  } catch (e) {
    lastError = `Primary URL failed: ${e.message}`;
    console.warn(`[recall-feeds] ${source} primary failed:`, e.message);
  }

  // Try fallback URL if primary failed
  if (!body && cfg.fallback) {
    try {
      const res2 = await fetch(cfg.fallback, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Batchd/1.0; +https://batchd.no)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (res2.ok) {
        body = await res2.text();
        lastError = null;
      } else {
        lastError = (lastError || '') + ` | Fallback returned ${res2.status}`;
      }
    } catch (e2) {
      lastError = (lastError || '') + ` | Fallback failed: ${e2.message}`;
      console.warn(`[recall-feeds] ${source} fallback failed:`, e2.message);
    }
  }

  // Try fallback2 if both primary and fallback failed
  if (!body && cfg.fallback2) {
    try {
      const res3 = await fetch(cfg.fallback2, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Batchd/1.0; +https://batchd.no)',
          'Accept': 'application/rss+xml, application/xml, text/xml, text/html, */*'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (res3.ok) {
        body = await res3.text();
        lastError = null;
      } else {
        lastError = (lastError || '') + ` | Fallback2 returned ${res3.status}`;
      }
    } catch (e3) {
      lastError = (lastError || '') + ` | Fallback2 failed: ${e3.message}`;
      console.warn(`[recall-feeds] ${source} fallback2 failed:`, e3.message);
    }
  }

  if (!body) {
    console.error(`[recall-feeds] ${source} all attempts failed: ${lastError}`);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: `Feed unavailable: ${lastError}` })
    };
  }

  // Cache and return
  cache[source] = { body, ts: now };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': cfg.contentType,
      'Access-Control-Allow-Origin': '*',
      'X-Cache': 'MISS',
      'Cache-Control': 'public, max-age=1800'
    },
    body
  };
};
