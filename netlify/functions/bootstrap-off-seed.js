// netlify/functions/bootstrap-off-seed.js
// Phase 2b of refactor plan v2 — Open Food Facts US seed for products_pending.
//
// One-time-ish bootstrap that fetches popular US grocery products from Open Food
// Facts (https://world.openfoodfacts.org) and stages them in products_pending
// with bootstrap_source='open_food_facts', source='external_api'. Same review
// workflow as the bootstrap_products_pending() SQL function — staged rows
// require manual promotion before they reach the canonical products table.
//
// Why a Netlify function (not a SQL migration):
// - OFF is an external HTTP API; calling it from inside Postgres is awkward.
// - The function uses SUPABASE_SERVICE_KEY to INSERT directly, bypassing RLS.
// - Each invocation is bounded (caps on max_pages and page_size) so it fits
//   inside Netlify's function timeout. Run it multiple times for more coverage.
//
// AUTHENTICATION
//
// Requires X-Admin-Token header that matches BOOTSTRAP_ADMIN_TOKEN env var.
// Set the env var in Netlify (Site configuration → Environment variables) with
// "Contains secret values" enabled. Use a long random string. Rotate by
// changing the env var; old token stops working immediately.
//
// USAGE
//
//   curl -X POST -H "X-Admin-Token: <your-token>" \
//     "https://app.batchdapp.com/.netlify/functions/bootstrap-off-seed?max_pages=5"
//
// Or from your browser DevTools console:
//
//   await fetch('/.netlify/functions/bootstrap-off-seed?max_pages=5', {
//     method: 'POST',
//     headers: { 'X-Admin-Token': '<your-token>' }
//   }).then(r => r.json())
//
// Returns JSON like:
//   {
//     fetched: 487, staged: 412, skipped: 75, errors: 0,
//     page_results: [{page:1, fetched:100, staged:88, skipped:12}, ...]
//   }
//
// QUALITY FILTERS (per plan v2 §2.1)
//
// - Skip if no barcode or barcode length < 6
// - Skip if no product_name (en or generic) or name length < 3
// - Skip if barcode already exists in `products` (canonical) or `products_pending`
// - Compose displayName as "Brand Product" if brand isn't already in the name
//
// CONFIDENCE
//
// OFF data gets confidence_score = 0.6 — moderate. Higher than scans-only
// bootstrap (0.4) because OFF is curated; lower than code_patterns bootstrap
// (0.5-0.95) because it hasn't been validated by any actual Batch'd scan.

const SUPABASE_URL = 'https://lurxucdmrugikdlvvebc.supabase.co';

// JS twin of the SQL normalize_barcode() function in migration 001.
// 12-digit UPC pads to 13-digit GTIN-13; otherwise pass-through after whitespace strip.
function normalizeBarcode(input) {
  if (input == null) return null;
  const cleaned = String(input).replace(/\s/g, '');
  if (cleaned.length === 0) return null;
  if (cleaned.length === 12 && /^\d{12}$/.test(cleaned)) {
    return '0' + cleaned;
  }
  return cleaned;
}

// Sleep helper for being respectful to OFF's free public API
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

exports.handler = async (event) => {
  // ── Auth ──────────────────────────────────────────────────────────────
  const adminToken = event.headers?.['x-admin-token'] || event.headers?.['X-Admin-Token'];
  if (!adminToken || !process.env.BOOTSTRAP_ADMIN_TOKEN || adminToken !== process.env.BOOTSTRAP_ADMIN_TOKEN) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  if (!process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error: SUPABASE_SERVICE_KEY missing' }) };
  }

  // ── Params ────────────────────────────────────────────────────────────
  const params = event.queryStringParameters || {};
  // Cap max_pages at 10 to fit comfortably in Netlify's function timeout.
  // Each page is ~1-2s OFF call + ~1s Supabase insert; 10 pages ≈ 20-30s.
  // For more coverage, run the function multiple times.
  const maxPages = Math.min(Math.max(parseInt(params.max_pages, 10) || 5, 1), 10);
  const pageSize = Math.min(Math.max(parseInt(params.page_size, 10) || 100, 10), 200);
  const country = params.country || 'en:united-states';

  // ── Pre-fetch existing barcodes for dedup ─────────────────────────────
  // Build a Set of barcodes already in products + products_pending so we can
  // skip them. For pilot scale (a few thousand entries) this is fine; if/when
  // products grows past ~100k rows we'd want to switch to per-row WHERE NOT EXISTS.
  let existingBarcodes;
  try {
    existingBarcodes = await fetchExistingBarcodes();
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to fetch existing barcodes: ' + e.message }) };
  }

  // ── Page through OFF ──────────────────────────────────────────────────
  let totalFetched = 0;
  let totalStaged = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const pageResults = [];

  for (let page = 1; page <= maxPages; page++) {
    try {
      const offUrl = buildOffSearchUrl({ country, pageSize, page });
      const resp = await fetch(offUrl, {
        headers: { 'User-Agent': 'Batched-RecallTracker/1.0 (batchd-app.netlify.app)' }
      });
      if (!resp.ok) {
        totalErrors++;
        pageResults.push({ page, error: `OFF returned ${resp.status}` });
        break;
      }
      const data = await resp.json();
      const products = Array.isArray(data.products) ? data.products : [];
      totalFetched += products.length;

      const result = await stageProducts(products, existingBarcodes);
      totalStaged += result.staged;
      totalSkipped += result.skipped;
      pageResults.push({ page, fetched: products.length, staged: result.staged, skipped: result.skipped, errors: result.errors });

      // No more pages
      if (products.length < pageSize) break;

      // Be respectful to OFF — small delay between requests
      if (page < maxPages) await sleep(500);
    } catch(e) {
      totalErrors++;
      pageResults.push({ page, error: e.message || 'unknown error' });
      break;
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fetched: totalFetched,
      staged: totalStaged,
      skipped: totalSkipped,
      errors: totalErrors,
      page_results: pageResults,
    }, null, 2),
  };
};

// ── Helpers ────────────────────────────────────────────────────────────

function buildOffSearchUrl({ country, pageSize, page }) {
  const fields = [
    'code', 'product_name', 'product_name_en', 'brands', 'categories_tags', 'unique_scans_n'
  ].join(',');
  const params = new URLSearchParams({
    countries_tags: country,
    fields,
    page_size: String(pageSize),
    page: String(page),
    sort_by: 'unique_scans_n',  // popularity proxy
  });
  // Use the country-specific OFF subdomain, NOT world.openfoodfacts.org.
  // The world endpoint with countries_tags filter returns products *sold in* the
  // country (often as imports — Moroccan / EU products with US distribution),
  // not products *primarily for* that market. The subdomain scopes the dataset
  // to products primarily distributed in that country.
  // Map our country param to the subdomain prefix.
  const subdomain = country.startsWith('en:united-states') ? 'us'
                   : country.startsWith('en:united-kingdom') ? 'uk'
                   : country.startsWith('en:france') ? 'fr'
                   : country.startsWith('en:germany') ? 'de'
                   : 'world'; // fallback to global with countries_tags filter
  return `https://${subdomain}.openfoodfacts.org/api/v2/search?${params.toString()}`;
}

async function fetchExistingBarcodes() {
  const set = new Set();
  // products
  const productsResp = await fetch(
    `${SUPABASE_URL}/rest/v1/products?select=barcode_normalized&barcode_normalized=not.is.null&limit=10000`,
    {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (productsResp.ok) {
    const rows = await productsResp.json();
    rows.forEach(r => { if (r.barcode_normalized) set.add(r.barcode_normalized); });
  }
  // products_pending (only unreviewed — promoted/rejected ones don't block)
  const pendingResp = await fetch(
    `${SUPABASE_URL}/rest/v1/products_pending?select=barcode_normalized&barcode_normalized=not.is.null&reviewed_at=is.null&limit=10000`,
    {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (pendingResp.ok) {
    const rows = await pendingResp.json();
    rows.forEach(r => { if (r.barcode_normalized) set.add(r.barcode_normalized); });
  }
  return set;
}

async function stageProducts(offProducts, existingBarcodes) {
  let skipped = 0;
  let errors = 0;
  const candidates = [];

  for (const p of offProducts) {
    const barcode = p.code;
    const rawName = (p.product_name_en || p.product_name || '').trim();
    const brands = (p.brands || '').trim();

    if (!barcode || String(barcode).length < 6 || !rawName || rawName.length < 3) {
      skipped++;
      continue;
    }

    const normalized = normalizeBarcode(barcode);
    if (!normalized) { skipped++; continue; }

    if (existingBarcodes.has(normalized)) {
      skipped++;
      continue;
    }
    // Add to set so within-batch duplicates also get filtered
    existingBarcodes.add(normalized);

    // Compose display name: "Brand Product" if brand isn't already in name
    let displayName = rawName;
    if (brands) {
      const firstBrand = brands.split(',')[0].trim();
      if (firstBrand && !rawName.toLowerCase().includes(firstBrand.toLowerCase())) {
        displayName = `${firstBrand} ${rawName}`;
      }
    }
    displayName = displayName.slice(0, 200);

    // First useful category (drop the 'en:' prefix and replace dashes)
    let category = null;
    if (Array.isArray(p.categories_tags) && p.categories_tags.length > 0) {
      // Take the most-specific (last) tag; OFF lists them general → specific
      const specific = p.categories_tags[p.categories_tags.length - 1];
      category = String(specific).replace(/^en:/, '').replace(/-/g, ' ').slice(0, 100);
    }

    candidates.push({
      barcode,
      name: displayName,
      category,
      source: 'external_api',
      bootstrap_source: 'open_food_facts',
      published: true,
      confidence_score: 0.6,
      staging_notes: `From Open Food Facts (US dataset)${p.unique_scans_n ? ' — popularity ' + p.unique_scans_n : ''}`,
    });
  }

  if (candidates.length === 0) return { staged: 0, skipped, errors };

  // Bulk INSERT via PostgREST. Service key bypasses RLS.
  // products_pending has no UNIQUE constraint on barcode_normalized (conflicts
  // are intentional for review), so we don't use Prefer: resolution.
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/products_pending`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(candidates),
    });
    if (resp.ok) {
      return { staged: candidates.length, skipped, errors };
    }
    const errText = await resp.text();
    console.error('[bootstrap-off-seed] Supabase insert error:', resp.status, errText.slice(0, 300));
    return { staged: 0, skipped, errors: candidates.length };
  } catch(e) {
    console.error('[bootstrap-off-seed] Supabase insert threw:', e);
    return { staged: 0, skipped, errors: candidates.length };
  }
}
