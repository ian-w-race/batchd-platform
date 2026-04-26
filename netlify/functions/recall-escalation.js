// netlify/functions/recall-escalation.js
// ─────────────────────────────────────────────────────────────
// Checks for unacknowledged recall alerts and sends escalation
// emails at the 2-hour and 24-hour marks.
//
// Trigger: call this from a scheduled job (e.g. Netlify Scheduled
// Functions cron every 30 minutes), OR call it manually from the
// dashboard "Remind" button.
//
// Required env vars:
//   SUPABASE_URL          — project URL
//   SUPABASE_SERVICE_KEY  — service role key (bypasses RLS)
//   RESEND_API_KEY        — re_hfJMphfo_4jQcxm42VWsQ83X9JbyaRpRB
//   FROM_EMAIL            — alerts@batchdapp.com (or hello@batchd.no)

const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const sb  = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const res = new Resend(process.env.RESEND_API_KEY);

const FROM  = 'Batch\'d Alerts <alerts@batchdapp.com>';
const TWO_H = 2 * 60 * 60 * 1000;
const H24   = 24 * 60 * 60 * 1000;

exports.handler = async (event, context) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    // If called with a specific recallEventId + orgId, only check that event.
    // Otherwise check everything (scheduled run).
    const { recallEventId, orgId } = body;

    const now = new Date();

    // ── Fetch pending acknowledgements ─────────────────────────
    // "Pending" = status is 'notified' (first step, no human action yet)
    // AND the recall was pushed more than 2 hours ago
    // AND we haven't already sent the escalation for this tier
    let q = sb.from('recall_acknowledgements')
      .select(`
        id, status, created_at, organisation_id,
        escalation_2h_sent_at, escalation_24h_sent_at,
        stores ( name ),
        recall_events (
          id, product_name, lot_number, severity, reason,
          source_org_id, published_at, is_drill,
          organisations!source_org_id ( name, contact_email )
        ),
        organisations!organisation_id ( name, contact_email,
          recall_coordinator_name, recall_coordinator_contact )
      `)
      .eq('status', 'notified')
      .eq('recall_events.is_drill', false);  // never escalate drills

    if (recallEventId) q = q.eq('recall_event_id', recallEventId);
    if (orgId)         q = q.eq('organisation_id', orgId);

    const { data: acks, error: ackErr } = await q;
    if (ackErr) throw ackErr;

    let sent2h = 0, sent24h = 0;

    for (const ack of (acks || [])) {
      const recallEvent = ack.recall_events;
      if (!recallEvent) continue;

      const pushedAt  = new Date(recallEvent.published_at || ack.created_at);
      const elapsed   = now - pushedAt;
      const retailer  = ack.organisations;
      const storeName = ack.stores?.name || 'Unknown store';
      const product   = recallEvent.product_name || 'Unknown product';
      const lot       = recallEvent.lot_number   || null;
      const mfr       = recallEvent.organisations?.name || 'Manufacturer';
      const severity  = recallEvent.severity || 'class_ii';
      const toEmail   = retailer?.contact_email;
      const coordName = retailer?.recall_coordinator_name;
      const coordContact = retailer?.recall_coordinator_contact;

      if (!toEmail) continue;

      const sevLabel = severity === 'class_i'   ? 'Class I — serious health hazard'
                     : severity === 'class_ii'  ? 'Class II — moderate risk'
                     : severity === 'class_iii' ? 'Class III — low risk'
                     : 'Recall alert';
      const sevColor = severity === 'class_i' ? '#e53e3e' : severity === 'class_ii' ? '#d97706' : '#718096';

      const emailHtml = (tier) => `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
        <body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 16px;">
            <tr><td align="center">
              <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:580px;width:100%;">

                <!-- Header -->
                <tr><td style="background:${severity==='class_i'?'#e53e3e':'#080f12'};padding:20px 28px;text-align:center;">
                  <div style="font-size:14px;font-weight:700;color:${severity==='class_i'?'#ffffff':'#34d399'};letter-spacing:0.05em;text-transform:uppercase;">
                    ${tier === '2h' ? '⏰ 2-Hour Escalation' : '🚨 24-Hour Escalation — Immediate Action Required'}
                  </div>
                  <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:4px;">
                    ${storeName} · ${retailer?.name || ''}
                  </div>
                </td></tr>

                <!-- Alert box -->
                <tr><td style="padding:20px 28px 0;">
                  <div style="background:#fff3f3;border:1.5px solid #fed7d7;border-radius:8px;padding:16px;margin-bottom:16px;">
                    <div style="font-size:11px;font-weight:700;color:${sevColor};letter-spacing:0.07em;margin-bottom:6px;">${sevLabel.toUpperCase()}</div>
                    <div style="font-size:16px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">${product}</div>
                    ${lot ? `<div style="font-size:12px;color:#555;font-family:monospace;">Lot: ${lot}</div>` : ''}
                    <div style="font-size:12px;color:#555;margin-top:4px;">Issued by: ${mfr}</div>
                  </div>
                </td></tr>

                <!-- Body -->
                <tr><td style="padding:0 28px 20px;">
                  <p style="font-size:14px;color:#333;line-height:1.6;margin:12px 0;">
                    ${tier === '2h'
                      ? `<strong>${storeName}</strong> received a recall alert <strong>2 hours ago</strong> and has not yet acknowledged it in Batch'd.`
                      : `<strong>${storeName}</strong> received a recall alert <strong>24 hours ago</strong> and has still not acknowledged it. This requires immediate escalation.`}
                  </p>
                  <p style="font-size:13px;color:#555;line-height:1.6;margin:0 0 16px;">
                    The 5-step response chain requires a staff member to log in to the Batch'd scanning app and complete the acknowledgement before the next steps (Pull, Dispose, Confirm) can proceed.
                  </p>
                  ${coordName ? `
                  <div style="background:#f7f7f7;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
                    <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Recall coordinator</div>
                    <div style="font-size:13px;font-weight:600;color:#333;">${coordName}</div>
                    ${coordContact ? `<div style="font-size:12px;color:#666;margin-top:2px;">${coordContact}</div>` : ''}
                  </div>` : ''}

                  <!-- CTA -->
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr><td align="center" style="padding:8px 0 20px;">
                      <a href="https://batchd-app.netlify.app" style="display:inline-block;background:#34d399;color:#052e16;text-decoration:none;font-weight:700;font-size:14px;padding:14px 28px;border-radius:8px;">
                        Open Batch'd → Acknowledge Now
                      </a>
                    </td></tr>
                  </table>

                  <p style="font-size:11px;color:#999;border-top:1px solid #eee;padding-top:14px;margin:0;">
                    This escalation was sent automatically by Batch'd because ${storeName} has not responded to a recall alert within ${tier === '2h' ? '2 hours' : '24 hours'}.
                    ${tier === '24h' ? 'You may have a legal obligation to act — contact your recall coordinator immediately.' : ''}
                  </p>
                </td></tr>

                <!-- Footer -->
                <tr><td style="background:#f9f9f9;padding:14px 28px;text-align:center;">
                  <div style="font-size:11px;color:#aaa;">Batch'd · <a href="https://batchdapp.com" style="color:#34d399;text-decoration:none;">batchdapp.com</a></div>
                </td></tr>

              </table>
            </td></tr>
          </table>
        </body>
        </html>`;

      const updates = {};

      // 2-hour escalation
      if (elapsed >= TWO_H && !ack.escalation_2h_sent_at) {
        try {
          await res.emails.send({
            from:    FROM,
            to:      [toEmail],
            subject: `[2h Escalation] Recall not acknowledged — ${product} · ${storeName}`,
            html:    emailHtml('2h'),
          });
          updates.escalation_2h_sent_at = now.toISOString();
          sent2h++;
        } catch(emailErr) {
          console.error('2h email error:', emailErr);
        }
      }

      // 24-hour escalation
      if (elapsed >= H24 && !ack.escalation_24h_sent_at) {
        try {
          await res.emails.send({
            from:    FROM,
            to:      [toEmail],
            subject: `[URGENT 24h] Recall still unacknowledged — ${product} · ${storeName}`,
            html:    emailHtml('24h'),
          });
          updates.escalation_24h_sent_at = now.toISOString();
          sent24h++;
        } catch(emailErr) {
          console.error('24h email error:', emailErr);
        }
      }

      // Persist timestamps so we never send twice
      if (Object.keys(updates).length) {
        await sb.from('recall_acknowledgements').update(updates).eq('id', ack.id);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        checked:  (acks || []).length,
        sent2h,
        sent24h,
        timestamp: now.toISOString(),
      }),
    };

  } catch(err) {
    console.error('Escalation error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
