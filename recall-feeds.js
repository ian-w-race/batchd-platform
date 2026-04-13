// netlify/functions/recall-feeds.js
// Server-side proxy for external recall feeds — avoids CORS issues in the browser.
// Handles RASFF (EU), Mattilsynet RSS (Norway), and Mattilsynet page scrape fallback.

const FEEDS = {
  rasff: 'https://webgate.ec.europa.eu/rasff-window/backend/public/consumer/rss?date_type=publishing&window=30&categories[]=&hazards[]=',
  mattilsynet_rss: 'https://www.mattilsynet.no/rss?subscription=tilbakekallinger',
  mattilsynet_page: 'https://www.mattilsynet.no/mat/tilbakekallinger-av-mat',
};

const TIMEOUT_MS = 8000;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const source = event.queryStringParameters?.source;
  if (!source || !FEEDS[source]) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Unknown source: ${source}. Valid: ${Object.keys(FEEDS).join(', ')}` }),
    };
  }

  const url = FEEDS[source];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Batchd-RecallTracker/1.0 (food safety; contact ian.w.race@gmail.com)',
        'Accept': source === 'mattilsynet_page'
          ? 'text/html,application/xhtml+xml'
          : 'application/rss+xml,application/xml,text/xml,*/*',
      },
    });

    clearTimeout(timer);

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        body: JSON.stringify({ error: `Upstream error ${resp.status} from ${source}` }),
      };
    }

    const body = await resp.text();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': source === 'mattilsynet_page' ? 'text/html; charset=utf-8' : 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=1800',
      },
      body,
    };

  } catch (err) {
    if (err.name === 'AbortError') {
      return {
        statusCode: 504,
        body: JSON.stringify({ error: `Timeout fetching ${source} after ${TIMEOUT_MS}ms` }),
      };
    }
    console.error(`recall-feeds error [${source}]:`, err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
