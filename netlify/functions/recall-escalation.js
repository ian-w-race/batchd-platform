// netlify/functions/recall-escalation.js
// Uses fetch() for Resend API — no SDK needed. Matches push-recall-email.js pattern.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL   = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const RESEND_API_KEY = process.env.RESEND_API_KEY; // must be set in Netlify env vars
const FROM_EMAIL     = "Batch'd Alerts <alerts@batchdapp.com>";
const TWO_H = 2  * 60 * 60 * 1000;
const H24   = 24 * 60 * 60 * 1000;

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    signal: AbortSignal.timeout(8000),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message || `Resend ${res.status}`); }
}

exports.handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { recallEventId, orgId } = body;
    const sb  = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const now = new Date();

    let q = sb.from('recall_acknowledgements')
      .select(`id,status,created_at,organisation_id,escalation_2h_sent_at,escalation_24h_sent_at,
        stores(name),
        recall_events!inner(id,product_name,lot_number,severity,published_at,is_drill),
        organisations!recall_acknowledgements_organisation_id_fkey(name,contact_email,recall_coordinator_name,recall_coordinator_contact)`)
      .eq('status','notified')
      .eq('recall_events.is_drill', false);

    if (recallEventId) q = q.eq('recall_event_id', recallEventId);
    if (orgId)         q = q.eq('organisation_id', orgId);

    const { data: acks, error } = await q;
    if (error) throw error;

    let sent2h = 0, sent24h = 0;

    for (const ack of (acks || [])) {
      const ev       = ack.recall_events;
      const retailer = ack.organisations;
      if (!ev || !retailer?.contact_email) continue;

      const elapsed  = now - new Date(ev.published_at || ack.created_at);
      const store    = ack.stores?.name || 'Unknown store';
      const product  = ev.product_name  || 'Unknown product';
      const lot      = ev.lot_number    || null;
      const toEmail  = retailer.contact_email;
      const coord    = retailer.recall_coordinator_name || null;
      const coordTel = retailer.recall_coordinator_contact || null;

      const buildHtml = (tier) => `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:24px;">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
          <div style="background:${ev.severity==='class_i'?'#e53e3e':'#080f12'};padding:18px 24px;text-align:center;">
            <div style="font-weight:700;color:#34d399;font-size:13px;text-transform:uppercase;letter-spacing:.05em;">
              ${tier==='2h'?'⏰ 2-Hour Escalation':'🚨 24-Hour Escalation — Immediate Action Required'}
            </div>
            <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:4px;">${esc(store)} · ${esc(retailer.name)}</div>
          </div>
          <div style="padding:20px 24px;">
            <div style="background:#fff3f3;border:1px solid #fed7d7;border-radius:8px;padding:14px;margin-bottom:14px;">
              <div style="font-size:15px;font-weight:700;color:#1a1a1a;">${esc(product)}</div>
              ${lot?`<div style="font-family:monospace;font-size:12px;color:#555;margin-top:3px;">Lot: ${esc(lot)}</div>`:''}
            </div>
            <p style="color:#333;font-size:14px;line-height:1.6;">
              ${tier==='2h'
                ?`<strong>${esc(store)}</strong> received a recall alert <strong>2 hours ago</strong> and has not yet acknowledged it.`
                :`<strong>${esc(store)}</strong> received a recall alert <strong>24 hours ago</strong> and has still not acknowledged it. Immediate action required.`}
            </p>
            ${coord?`<div style="background:#f7f7f7;border-radius:8px;padding:12px;margin-bottom:14px;">
              <div style="font-size:10px;color:#888;text-transform:uppercase;margin-bottom:3px;">Recall coordinator</div>
              <div style="font-weight:600;color:#333;">${esc(coord)}</div>
              ${coordTel?`<div style="font-size:12px;color:#666;">${esc(coordTel)}</div>`:''}
            </div>`:''}
            <div style="text-align:center;padding:8px 0 16px;">
              <a href="https://batchd-app.netlify.app" style="background:#34d399;color:#052e16;text-decoration:none;font-weight:700;font-size:14px;padding:13px 26px;border-radius:8px;display:inline-block;">
                Open Batch'd — Acknowledge Now
              </a>
            </div>
            <p style="font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px;">
              Sent automatically by Batch'd because ${esc(store)} has not responded within ${tier==='2h'?'2 hours':'24 hours'}.
              ${tier==='24h'?'Contact your recall coordinator immediately.':''}
            </p>
          </div>
          <div style="background:#f9f9f9;padding:12px 24px;text-align:center;font-size:11px;color:#aaa;">
            Batch'd · <a href="https://batchdapp.com" style="color:#34d399;text-decoration:none;">batchdapp.com</a>
          </div>
        </div>
      </body></html>`;

      const updates = {};

      if (elapsed >= TWO_H && !ack.escalation_2h_sent_at) {
        try {
          await sendEmail(toEmail, `[2h Escalation] Recall not acknowledged — ${esc(product)} · ${esc(store)}`, buildHtml('2h'));
          updates.escalation_2h_sent_at = now.toISOString();
          sent2h++;
        } catch(e) { console.error('2h email error:', e.message); }
      }

      if (elapsed >= H24 && !ack.escalation_24h_sent_at) {
        try {
          await sendEmail(toEmail, `[URGENT 24h] Recall still unacknowledged — ${esc(product)} · ${esc(store)}`, buildHtml('24h'));
          updates.escalation_24h_sent_at = now.toISOString();
          sent24h++;
        } catch(e) { console.error('24h email error:', e.message); }
      }

      if (Object.keys(updates).length) {
        await sb.from('recall_acknowledgements').update(updates).eq('id', ack.id);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ checked: (acks||[]).length, sent2h, sent24h }) };
  } catch(err) {
    console.error('Escalation error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
