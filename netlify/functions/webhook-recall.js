// netlify/functions/webhook-recall.js
// ERP integration endpoint — manufacturers can POST recall events directly from SAP/Oracle/etc.
// Authentication: X-Batchd-Api-Key header (must match org's api_key stored in organisations table)
// Rate limit: 10 recalls/hour per org

const SUPABASE_URL = 'https://lurxucdmrugikdlvvebc.supabase.co';
const SB_SVC_KEY   = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed. Use POST.' });
  }

  // ── Auth: API key from header ──────────────────────────────────────────────
  const apiKey = event.headers['x-batchd-api-key'] || event.headers['X-Batchd-Api-Key'];
  if (!apiKey) {
    return jsonResponse(401, { error: 'Missing X-Batchd-Api-Key header.' });
  }

  // Look up organisation by API key
  const orgRes = await sbFetch(`/organisations?api_key=eq.${encodeURIComponent(apiKey)}&type=eq.manufacturer&select=id,name,type`);
  const org = orgRes?.[0];
  if (!org) {
    return jsonResponse(401, { error: 'Invalid API key. Generate one from the Batch\'d manufacturer portal.' });
  }

  // ── Parse request body ─────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return jsonResponse(400, { error: 'Request body must be valid JSON.' });
  }

  const {
    product_name,
    lot_number,
    barcode,
    severity,      // 'class_i' | 'class_ii' | 'class_iii' | 'market_withdrawal'
    reason,        // free text
    description,
    authority_reference,
    affected_countries,
    is_drill = false,
    // Optional: pre-select which retailer orgs to notify (if empty, notifies all trading partners)
    retailer_org_ids,
  } = body;

  if (!product_name) {
    return jsonResponse(400, { error: 'product_name is required.' });
  }

  try {
    // ── 1. Create recall_event ─────────────────────────────────────────────
    const eventPayload = {
      source_org_id:       org.id,
      product_name,
      lot_number:          lot_number || null,
      barcode:             barcode    || null,
      severity:            severity   || null,
      reason:              reason     || null,
      description:         description || null,
      authority_reference: authority_reference || null,
      affected_countries:  affected_countries || null,
      is_drill:            !!is_drill,
      published_at:        new Date().toISOString(),
    };

    const eventRes = await sbPost('/recall_events', eventPayload);
    if (!eventRes?.id) {
      return jsonResponse(500, { error: 'Failed to create recall event.' });
    }
    const recallEventId = eventRes.id;

    // ── 2. Determine which retailers to notify ─────────────────────────────
    let targetRetailerIds = retailer_org_ids || [];
    if (!targetRetailerIds.length) {
      // Notify all active trading partners
      const partners = await sbFetch(`/trading_partners?manufacturer_id=eq.${org.id}&status=eq.active&select=retailer_id`);
      targetRetailerIds = (partners || []).map(p => p.retailer_id);
    }

    // ── 3. Create distributions ────────────────────────────────────────────
    let distributionsCreated = 0;
    for (const retailerId of targetRetailerIds) {
      // Check that retailer is a real active partner
      const distPayload = {
        recall_event_id: recallEventId,
        retailer_org_id: retailerId,
        distributed_at:  new Date().toISOString(),
      };
      const dist = await sbPost('/recall_distributions', distPayload);
      if (dist) {
        distributionsCreated++;
        // Create a recall_acknowledgement for each store of this retailer
        const stores = await sbFetch(`/stores?organisation_id=eq.${retailerId}&active=eq.true&select=id,organisation_id`);
        for (const store of (stores || [])) {
          await sbPost('/recall_acknowledgements', {
            recall_event_id: recallEventId,
            store_id:        store.id,
            organisation_id: retailerId,
            status:          'notified',
          });
        }
      }
    }

    // ── 4. Trigger email notifications ─────────────────────────────────────
    // Call the push-recall-email function internally
    try {
      const emailUrl = `https://${event.headers.host}/.netlify/functions/push-recall-email`;
      await fetch(emailUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recallEventId,
          productName:      product_name,
          lotNumber:        lot_number,
          barcode,
          severity,
          reason,
          manufacturerName: org.name,
          affectedStores:   distributionsCreated,
          isDrill:          !!is_drill,
        }),
      });
    } catch(e) {
      // Email failure shouldn't block the webhook response
      console.error('Email notification failed:', e.message);
    }

    return jsonResponse(200, {
      success:         true,
      recall_event_id: recallEventId,
      retailers_notified: distributionsCreated,
      message: `Recall event created and distributed to ${distributionsCreated} retailer organisation${distributionsCreated !== 1 ? 's' : ''}.`,
      links: {
        recall_event: `https://app.batchdapp.com/manufacturer.html#recall_${recallEventId}`,
      },
    });

  } catch(e) {
    return jsonResponse(500, { error: e.message });
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Batchd-Api-Key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function jsonResponse(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

async function sbFetch(path) {
  if (!SB_SVC_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { 'apikey': SB_SVC_KEY, 'Authorization': `Bearer ${SB_SVC_KEY}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function sbPost(path, data) {
  if (!SB_SVC_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'POST',
    headers: {
      'apikey':        SB_SVC_KEY,
      'Authorization': `Bearer ${SB_SVC_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return Array.isArray(json) ? json[0] : json;
}
