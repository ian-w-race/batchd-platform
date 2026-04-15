// netlify/functions/trace.js
// Public endpoint — returns sanitized product traceability data for consumer-facing page.
// NO authentication required. Returns only safe, non-sensitive fields.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60', // cache 60s — recall status can change
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const lot     = event.queryStringParameters?.lot     || '';
  const barcode = event.queryStringParameters?.barcode || '';

  if (!lot && !barcode) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'missing_params', message: 'Provide lot or barcode parameter.' }) };
  }

  // Rate limiting: basic check on request frequency (no state here, rely on Netlify edge limits)
  // This endpoint is intentionally minimal — only returns:
  // product_name, lot_number, barcode, manufacturer_name, shipped_at
  // and whether there is an active recall for this lot.
  // It does NOT return: org IDs, user data, store names, internal records.

  try {
    if (!SUPABASE_SERVICE_KEY) throw new Error('Service key not configured');

    // ── 1. Look up product lot in product_lots table ──
    let lotData = null;
    if (lot) {
      const r = await sbGet(`/rest/v1/product_lots?lot_number=ilike.${encodeURIComponent(lot)}&select=lot_number,product_id,manufacturer_id,created_at&limit=1`);
      if (r?.length) lotData = r[0];
    }

    // ── 2. Look up shipments for this lot/barcode ──
    let shipment = null;
    {
      let url = '/rest/v1/shipments?select=lot_number,barcode,product_name,shipped_at,manufacturer_id&limit=1';
      if (lot)     url += `&lot_number=ilike.${encodeURIComponent(lot)}`;
      if (barcode && !lot) url += `&barcode=eq.${encodeURIComponent(barcode)}`;
      const r = await sbGet(url);
      if (r?.length) shipment = r[0];
    }

    if (!lotData && !shipment) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'not_found', found: false }) };
    }

    // ── 3. Get manufacturer name (safe public field) ──
    const mfrId = lotData?.manufacturer_id || shipment?.manufacturer_id;
    let manufacturerName = null;
    if (mfrId) {
      const r = await sbGet(`/rest/v1/organisations?id=eq.${mfrId}&select=name&limit=1`);
      if (r?.length) manufacturerName = r[0].name;
    }

    // ── 4. Get product name ──
    let productName = shipment?.product_name || null;
    if (!productName && lotData?.product_id) {
      const r = await sbGet(`/rest/v1/products?id=eq.${lotData.product_id}&select=name&limit=1`);
      if (r?.length) productName = r[0].name;
    }

    // ── 5. Check for active recall on this lot ──
    // Check both recalls table AND recall_events (manufacturer push)
    let activeRecall = null;
    const resolvedLot = lot || shipment?.lot_number || '';

    if (resolvedLot) {
      // Check recall_events first (manufacturer push)
      const recallEvents = await sbGet(
        `/rest/v1/recall_events?lot_number=ilike.%25${encodeURIComponent(resolvedLot.slice(0,20))}%25&select=id,product_name,reason,severity,published_at&limit=3`
      );
      if (recallEvents?.length) {
        const ev = recallEvents[0];
        activeRecall = {
          source: 'manufacturer',
          reason: ev.reason || 'Product recall notice',
          authority: null,
          published_at: ev.published_at,
        };
      }

      // Check FDA/Mattilsynet recalls table (sanitize — only return reason, not org info)
      if (!activeRecall) {
        const recallRows = await sbGet(
          `/rest/v1/recalls?lot_number=ilike.%25${encodeURIComponent(resolvedLot.slice(0,20))}%25&active=eq.true&select=product_name,description,source&limit=3`
        );
        if (recallRows?.length) {
          const r = recallRows[0];
          activeRecall = {
            source: r.source || 'regulatory',
            reason: r.description ? r.description.slice(0, 200) : 'This product lot is subject to an active recall.',
            authority: r.source === 'fda' ? 'US FDA' : r.source === 'mattilsynet' ? 'Mattilsynet (Norwegian Food Safety Authority)' : 'Food Safety Authority',
          };
        }
      }
    }

    // ── 6. Return sanitized response ──
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        found: true,
        product_name: productName || 'Product',
        lot_number: resolvedLot || null,
        barcode: barcode || shipment?.barcode || null,
        manufacturer_name: manufacturerName,
        shipped_at: shipment?.shipped_at || lotData?.created_at || null,
        active_recall: !!activeRecall,
        recall_reason: activeRecall?.reason || null,
        recall_authority: activeRecall?.authority || null,
        verified_at: new Date().toISOString(),
      }),
    };

  } catch (e) {
    console.error('[trace]', e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'server_error', message: 'Could not retrieve traceability data.' }) };
  }
};

async function sbGet(path) {
  const resp = await fetch(SUPABASE_URL + path, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) return null;
  return resp.json();
}
