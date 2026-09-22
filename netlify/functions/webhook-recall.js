// netlify/functions/webhook-recall.js
// ERP integration endpoint — manufacturers can POST recall events directly from SAP/Oracle/etc.
// Authentication: X-Batchd-Api-Key header (must match org's api_key stored in organisations table)
// Rate limit: 10 recalls/hour per org

const SUPABASE_URL = 'https://lurxucdmrugikdlvvebc.supabase.co';
const SB_SVC_KEY   = process.env.SUPABASE_SERVICE_KEY;
const crypto = require('crypto');
const SITE_URL = process.env.URL || 'https://app.batchdapp.com';
const SEVERITIES = new Set(['unknown', 'class_i', 'class_ii', 'class_iii', 'market_withdrawal']);
// Text fields: strings only, tag-shaped runs removed, whitespace collapsed, length-capped.
const txt = (v, max) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/<\/?[a-z][^>]*>/gi, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
};
const normSeverity = (v) => v == null ? null : String(v).trim().toLowerCase().replace(/[\s-]+/g, '_');

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
  if (typeof apiKey !== 'string' || apiKey.length < 16 || apiKey.length > 256) {
    return jsonResponse(401, { error: 'Missing or malformed X-Batchd-Api-Key header.' });
  }
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const keyRows = await sbFetch(`/organisation_api_keys?key_hash=eq.${keyHash}&revoked_at=is.null&select=organisation_id&limit=1`);
  const keyOrgId = keyRows?.[0]?.organisation_id;
  const orgRes = keyOrgId ? await sbFetch(`/organisations?id=eq.${keyOrgId}&type=eq.manufacturer&select=id,name,type&limit=1`) : null;
  const org = orgRes?.[0];
  if (!org) return jsonResponse(401, { error: 'Invalid API key.' });

  // Rate limit: 50 recall events per organisation per hour.
  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const recent = await sbFetch(`/recall_events?source_org_id=eq.${org.id}&created_at=gte.${encodeURIComponent(oneHourAgo)}&select=id&limit=50`);
  if ((recent || []).length >= 50) {
    return jsonResponse(429, { error: 'Rate limit: at most 50 recall events per hour per organisation.' });
  }

  // ── Parse request body ─────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return jsonResponse(400, { error: 'Request body must be valid JSON.' });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse(400, { error: 'Request body must be a JSON object.' });
  }
  const product_name        = txt(body.product_name, 200);
  const lot_number          = txt(body.lot_number, 80);
  const barcode             = txt(body.barcode, 32);
  const reason              = txt(body.reason, 500);
  const description         = txt(body.description, 2000);
  const authority_reference = txt(body.authority_reference, 100);
  const severity            = normSeverity(body.severity);
  const is_drill            = body.is_drill === true;
  const affected_countries  = Array.isArray(body.affected_countries)
    ? body.affected_countries.filter(c => typeof c === 'string').map(c => c.slice(0, 3)).slice(0, 50) : null;
  const rawTargets = Array.isArray(body.target_retailer_ids) ? body.target_retailer_ids
                   : Array.isArray(body.retailer_org_ids)   ? body.retailer_org_ids : [];
  const retailer_org_ids = rawTargets.filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id));
  if (!product_name) return jsonResponse(400, { error: 'product_name is required.' });
  if (severity !== null && !SEVERITIES.has(severity)) {
    return jsonResponse(422, { error: 'Invalid severity. Use one of: unknown, class_i, class_ii, class_iii, market_withdrawal.' });
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
      is_drill:            is_drill,
      published_at:        new Date().toISOString(),
    };

    const eventRes = await sbPost('/recall_events', eventPayload);
    if (!eventRes?.id) {
      return jsonResponse(500, { error: 'Failed to create recall event.' });
    }
    const recallEventId = eventRes.id;

    // ── 2. Determine which retailers to notify ─────────────────────────────
    // Always filter through trading_partners. Without this, a manufacturer
    // with a valid API key could spam fake recalls at arbitrary retailer
    // orgs by sending unknown UUIDs in retailer_org_ids. Added 2026-06-14
    // after audit flagged this as a cross-org abuse path.
    const partners = await sbFetch(`/trading_partners?manufacturer_id=eq.${org.id}&status=eq.active&select=retailer_id`);
    const allowedRetailerIds = new Set((partners || []).map(p => p.retailer_id));

    let targetRetailerIds = retailer_org_ids || [];
    if (targetRetailerIds.length > 0) {
      // Explicit subset — keep only valid trading partners.
      targetRetailerIds = targetRetailerIds.filter(id => allowedRetailerIds.has(id));
    } else {
      // No subset → fan out to all active partners.
      targetRetailerIds = Array.from(allowedRetailerIds);
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
      const emailUrl = `${SITE_URL}/.netlify/functions/push-recall-email`;
      // push-recall-email reads snake_case recall_event_id and fetches the
      // event, distributions and org contacts itself — send only the id.
      const emailRes = await fetch(emailUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recall_event_id: recallEventId, internal_secret: process.env.INTERNAL_NOTIFY_SECRET }),
      });
      // fetch() resolves on HTTP errors — surface them so a dead email leg
      // shows up in the function logs instead of failing silently.
      if (!emailRes.ok) {
        console.error('Email notification failed: HTTP', emailRes.status, (await emailRes.text()).slice(0, 300));
      }
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
    console.error('[webhook-recall]', e);
    return jsonResponse(500, { error: 'Internal error creating recall event.' });
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
