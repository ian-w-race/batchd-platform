// ================================================================
// push-recall-email.js — Batch'd Netlify serverless function
// Sends recall alert emails to retailer org contacts when a recall
// fires. Called from the manufacturer portal and ERP webhook.
//
// Handles BOTH recall sources:
//   1. recall_events + recall_distributions (manufacturer push)
//   2. recalls table (manual / FDA / RASFF)
//
// Now includes exposure summary from scan_recall_matches.
// ================================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL     = process.env.SUPABASE_URL     || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY; // service role — can read across orgs
const RESEND_API_KEY   = process.env.RESEND_API_KEY;   // must be set in Netlify env vars
const FROM_EMAIL       = 'recalls@batchdapp.com';
const FROM_NAME        = "Batch'd Recall Alerts";

// HTML-safe string escaping — prevents broken email if product names contain < > & etc.
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { recall_event_id, recall_id, test } = body;

  if (!recall_event_id && !recall_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'recall_event_id or recall_id required' }) };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    let recallData = null;
    let affectedOrgs = [];
    let recallSource = '';

    // ── Path 1: Manufacturer-pushed recall (recall_events) ──────
    if (recall_event_id) {
      recallSource = 'manufacturer_push';

      const { data: recallEvent, error: evErr } = await sb
        .from('recall_events')
        .select('id, product_name, lot_number, barcode, reason, severity, is_drill, created_at, source_org_id')
        .eq('id', recall_event_id)
        .single();

      if (evErr || !recallEvent) {
        return { statusCode: 404, body: JSON.stringify({ error: 'recall_event not found', detail: evErr?.message }) };
      }

      recallData = {
        id:           recallEvent.id,
        product_name: recallEvent.product_name,
        lot_number:   recallEvent.lot_number,
        barcode:      recallEvent.barcode,
        reason:       recallEvent.reason,
        severity:     recallEvent.severity,
        is_drill:     recallEvent.is_drill,
        created_at:   recallEvent.created_at,
        source:       'manufacturer_push',
      };

      // Get manufacturer name
      if (recallEvent.source_org_id) {
        const { data: mfrOrg } = await sb.from('organisations').select('name').eq('id', recallEvent.source_org_id).single();
        recallData.manufacturer_name = mfrOrg?.name || null;
      }

      // Get all retailer orgs that received this recall
      const { data: dists } = await sb
        .from('recall_distributions')
        .select('retailer_org_id')
        .eq('recall_event_id', recall_event_id);

      const orgIds = [...new Set((dists || []).map(d => d.retailer_org_id).filter(Boolean))];
      if (orgIds.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ sent: 0, skipped: 'no distributions found' }) };
      }

      const { data: orgs } = await sb
        .from('organisations')
        .select('id, name, contact_email, region')
        .in('id', orgIds);

      affectedOrgs = orgs || [];
    }

    // ── Path 2: Manual / FDA / RASFF recall (recalls table) ─────
    if (recall_id) {
      recallSource = 'manual';

      const { data: recall, error: rErr } = await sb
        .from('recalls')
        .select('id, product_name, lot_number, barcode_number, description, source, active, created_at, organisation_id')
        .eq('id', recall_id)
        .single();

      if (rErr || !recall) {
        return { statusCode: 404, body: JSON.stringify({ error: 'recall not found', detail: rErr?.message }) };
      }

      recallData = {
        id:           recall.id,
        product_name: recall.product_name,
        lot_number:   recall.lot_number,
        barcode:      recall.barcode_number,
        reason:       recall.description,
        source:       recall.source || 'manual',
        created_at:   recall.created_at,
        is_drill:     false,
      };

      // For org-scoped recalls, notify that org's contact
      if (recall.organisation_id) {
        const { data: org } = await sb
          .from('organisations')
          .select('id, name, contact_email, region')
          .eq('id', recall.organisation_id)
          .single();
        if (org) affectedOrgs = [org];
      }
    }

    if (affectedOrgs.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0, skipped: 'no orgs to notify' }) };
    }

    // ── Exposure data from scan_recall_matches ───────────────────
    // Gracefully handles the case where the table doesn't exist yet.
    let exposureByOrg = {};
    const matchRecallId = recall_event_id || recall_id;
    let matchRows = null;
    try {
      const srmRes = await sb
        .from('scan_recall_matches')
        .select('organisation_id, store_name, quantity, placed_at, removed_at, scanned_by')
        .eq('recall_id', matchRecallId);
      if (!srmRes.error) matchRows = srmRes.data;
    } catch(srmErr) {
      // Table may not exist — exposure data will be omitted from the email
      console.warn('[push-recall-email] scan_recall_matches unavailable:', srmErr.message);
    }

    if (matchRows && matchRows.length > 0) {
      matchRows.forEach(m => {
        if (!exposureByOrg[m.organisation_id]) {
          exposureByOrg[m.organisation_id] = { total: 0, onShelf: 0, pulled: 0, stores: new Set() };
        }
        const e = exposureByOrg[m.organisation_id];
        e.total += (m.quantity || 1);
        if (m.removed_at) e.pulled += (m.quantity || 1);
        else e.onShelf += (m.quantity || 1);
        if (m.store_name) e.stores.add(m.store_name);
      });
    }

    // ── Send email to each org ───────────────────────────────────
    let sent = 0;
    const errors = [];

    for (const org of affectedOrgs) {
      if (!org.contact_email) continue;

      const exposure = exposureByOrg[org.id];
      const isDrill  = recallData.is_drill;
      const isNO     = (org.region || 'no') === 'no';

      const subject = isDrill
        ? `[DRILL] Batch'd Recall Drill: ${esc(recallData.product_name}`
        : `⚠ Recall Alert: ${esc(recallData.product_name}${recallData.lot_number ? ` — Lot ${recallData.lot_number}` : ''}`;

      const html = buildRecallEmailHtml({
        org, recallData, exposure, isDrill, isNO,
        dashboardUrl: `https://app.batchdapp.com`,
      });

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from:    `${FROM_NAME} <${FROM_EMAIL}>`,
          to:      [org.contact_email],
          subject,
          html,
        }),
      });

      const resData = await res.json();
      if (res.ok) {
        sent++;
      } else {
        errors.push({ org: org.name, error: resData.message || 'Resend error' });
        console.error(`[push-recall-email] Failed to send to ${org.contact_email}:`, resData);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        sent,
        total_orgs: affectedOrgs.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
    };

  } catch (err) {
    console.error('[push-recall-email] Unexpected error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ── Email HTML builder ────────────────────────────────────────────
function buildRecallEmailHtml({ org, recallData, exposure, isDrill, isNO, dashboardUrl }) {
  const accentColor = isDrill ? '#f5a623' : '#ff5c5c';
  const drillBanner = isDrill
    ? `<div style="background:#f5a62320;border:2px solid #f5a623;border-radius:8px;padding:10px 16px;margin-bottom:20px;text-align:center;">
        <strong style="color:#f5a623;font-size:13px;">⚠ THIS IS A DRILL — No action required on real product</strong>
       </div>`
    : '';

  const severityLabel = recallData.severity
    ? `<div style="display:inline-block;background:${accentColor}20;color:${accentColor};border:1px solid ${accentColor}50;border-radius:4px;padding:2px 10px;font-size:11px;font-weight:700;font-family:monospace;margin-bottom:12px;">${recallData.severity.toUpperCase()}</div>`
    : '';

  const sourceLabel = {
    manufacturer_push: 'Manufacturer Push',
    fda:              'FDA Recall',
    rasff:            'Mattilsynet Alert',
    mattilsynet:      'Mattilsynet',
    manual:           'Manual Entry',
  }[recallData.source] || 'Recall Alert';

  // Exposure block
  let exposureHtml = '';
  if (exposure && exposure.total > 0) {
    const storeList = [...exposure.stores].slice(0, 5).join(', ') + (exposure.stores.size > 5 ? ` +${exposure.stores.size - 5} more` : '');
    exposureHtml = `
      <div style="background:#ff5c5c15;border:1px solid #ff5c5c40;border-radius:8px;padding:14px 16px;margin:16px 0;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#ff5c5c;font-weight:700;margin-bottom:10px;">
          ${isNO ? 'Eksponeringssammendrag' : 'Exposure Summary'}
        </div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align:center;padding:0 8px;">
              <div style="font-size:28px;font-weight:800;color:#ff5c5c;">${exposure.onShelf}</div>
              <div style="font-size:10px;color:#666;text-transform:uppercase;">${isNO ? 'Enheter på hylla' : 'Units on shelf'}</div>
            </td>
            <td style="text-align:center;padding:0 8px;border-left:1px solid #eee;">
              <div style="font-size:28px;font-weight:800;color:#34d399;">${exposure.pulled}</div>
              <div style="font-size:10px;color:#666;text-transform:uppercase;">${isNO ? 'Bekreftet fjernet' : 'Confirmed pulled'}</div>
            </td>
            <td style="text-align:center;padding:0 8px;border-left:1px solid #eee;">
              <div style="font-size:28px;font-weight:800;color:#333;">${exposure.stores.size}</div>
              <div style="font-size:10px;color:#666;text-transform:uppercase;">${isNO ? 'Butikker' : 'Stores'}</div>
            </td>
          </tr>
        </table>
        ${storeList ? `<div style="margin-top:10px;font-size:11px;color:#666;">${isNO ? 'Butikker' : 'Stores'}: <strong>${storeList}</strong></div>` : ''}
        ${exposure.onShelf > 0 ? `<div style="margin-top:8px;font-size:12px;color:#ff5c5c;font-weight:600;">⚠ ${exposure.onShelf} unit${exposure.onShelf !== 1 ? 's' : ''} still on shelf — immediate action required</div>` : ''}
      </div>`;
  } else {
    exposureHtml = `
      <div style="background:#f5a62310;border:1px solid #f5a62340;border-radius:8px;padding:12px 16px;margin:16px 0;font-size:12px;color:#666;">
        ${isNO ? 'Kontroller Batch\'d-dashbordet for eksponeringsstatus i sanntid.' : 'Check the Batch\'d dashboard for real-time exposure status.'}
      </div>`;
  }

  const actionSteps = isNO
    ? ['Logg inn på Batch\'d-dashbordet', 'Kontroller hvilke butikker som har produktet på lager', 'Bekreft at alle butikker har fjernet varen', 'Dokumenter handlinger i Batch\'d for revisjonssporet']
    : ['Log in to the Batch\'d dashboard', 'Review which stores have the product in stock', 'Confirm all stores have removed the item', 'Document all actions in Batch\'d for the audit trail'];

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr>
        <td style="background:#080f12;padding:24px 32px;text-align:center;">
          <div style="font-family:Georgia,serif;font-size:22px;font-weight:800;color:#34d399;letter-spacing:-0.5px;">Batch'd</div>
          <div style="font-size:11px;color:#6aaf9e;margin-top:2px;font-family:monospace;letter-spacing:0.08em;">
            ${isDrill ? 'RECALL DRILL' : 'RECALL ALERT'} · ${sourceLabel.toUpperCase()}
          </div>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:32px;">
          ${drillBanner}

          <div style="font-size:13px;color:#888;margin-bottom:6px;font-family:monospace;text-transform:uppercase;letter-spacing:0.06em;">
            ${isNO ? 'Hei' : 'Hello'}, ${esc(org.name)}
          </div>

          <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#1a1a1a;line-height:1.2;">
            ${isDrill ? '🔔 ' : '⚠️ '}${esc(recallData.product_name) || 'Unknown product'}
          </h1>

          ${severityLabel}

          <!-- Recall details -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;border-radius:8px;padding:14px 16px;margin-bottom:4px;">
            <tr><td style="padding:4px 0;">
              <span style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.06em;font-family:monospace;">${isNO ? 'Partinummer' : 'Lot Number'}</span><br>
              <strong style="font-size:15px;color:#1a1a1a;font-family:monospace;">${esc(recallData.lot_number) || (isNO ? 'Alle partier' : 'All lots')}</strong>
            </td></tr>
            ${recallData.barcode ? `<tr><td style="padding:4px 0;border-top:1px solid #eee;">
              <span style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.06em;font-family:monospace;">${isNO ? 'Strekkode' : 'Barcode'}</span><br>
              <strong style="font-size:13px;color:#1a1a1a;font-family:monospace;">${esc(recallData.barcode)}</strong>
            </td></tr>` : ''}
            ${recallData.reason ? `<tr><td style="padding:4px 0;border-top:1px solid #eee;">
              <span style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.06em;font-family:monospace;">${isNO ? 'Årsak' : 'Reason'}</span><br>
              <span style="font-size:13px;color:#333;">${esc(recallData.reason)}</span>
            </td></tr>` : ''}
            ${recallData.manufacturer_name ? `<tr><td style="padding:4px 0;border-top:1px solid #eee;">
              <span style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.06em;font-family:monospace;">${isNO ? 'Produsent' : 'Manufacturer'}</span><br>
              <span style="font-size:13px;color:#333;">${esc(recallData.manufacturer_name)}</span>
            </td></tr>` : ''}
          </table>

          ${exposureHtml}

          <!-- Action steps -->
          <div style="margin:20px 0 16px;font-size:13px;font-weight:700;color:#1a1a1a;text-transform:uppercase;letter-spacing:0.05em;">
            ${isNO ? 'Nødvendige handlinger' : 'Required Actions'}
          </div>
          ${actionSteps.map((s, i) => `
            <div style="display:flex;align-items:flex-start;margin-bottom:10px;">
              <div style="width:22px;height:22px;border-radius:50%;background:${accentColor};color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:10px;margin-top:1px;">${i+1}</div>
              <div style="font-size:13px;color:#333;padding-top:3px;">${s}</div>
            </div>`).join('')}

          <!-- CTA button -->
          <div style="text-align:center;margin:28px 0 16px;">
            <a href="${dashboardUrl}" style="display:inline-block;background:#34d399;color:#04120e;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:14px;font-weight:800;font-family:-apple-system,sans-serif;letter-spacing:0.02em;">
              ${isNO ? 'Åpne Batch\'d-dashbordet →' : 'Open Batch\'d Dashboard →'}
            </a>
          </div>

          ${isDrill ? `<div style="text-align:center;font-size:11px;color:#888;margin-top:8px;">
            ${isNO ? 'Dette er en øvelse. Ingen reelle produkter er berørt.' : 'This is a drill. No real products are affected.'}
          </div>` : ''}
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f8f8f8;padding:20px 32px;border-top:1px solid #eee;">
          <div style="font-size:11px;color:#888;text-align:center;line-height:1.6;">
            ${isNO
              ? `Denne varslingen ble sendt fra Batch'd til ${esc(org.name)}.<br>Traceability og tilbakekallingsadministrasjon for matvarebransjen.`
              : `This alert was sent by Batch'd to ${esc(org.name)}.<br>Food traceability and recall management for grocery retail.`}
            <br><a href="https://batchd.no" style="color:#34d399;text-decoration:none;">batchd.no</a>
          </div>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}
