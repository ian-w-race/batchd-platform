// netlify/functions/recall-reminder.js
// Manual reminder endpoint for the dashboard's "Send reminders" and
// "📧 Remind" buttons.
//
// Split from recall-escalation.js (2026-08-05): recall-escalation is
// registered as a SCHEDULED function in netlify.toml, and Netlify
// scheduled functions cannot be invoked via URL — so the dashboard
// needs this separate plain-HTTP function. recall-escalation keeps the
// automated 2h/24h tiers; this one sends an on-demand reminder to every
// store on a recall that hasn't reached Resolved (DB status stays
// 'confirmed' per CLAUDE.md — only the UI label changed).
//
// Auth: caller must include `Authorization: Bearer <supabase_jwt>` and
// be an ACTIVE corp_admin of the claimed orgId. Drills never send.
//
// Never register this function with a schedule in netlify.toml.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL   = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = "Batch'd Alerts <alerts@batchdapp.com>";
const H24 = 24 * 60 * 60 * 1000;

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    signal: AbortSignal.timeout(6000),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message || `Resend ${res.status}`); }
}

function buildReminderHtml({ store, retailerName, product, lot, severity, coord, coordTel }) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
      <div style="background:${severity==='class_i'?'#e53e3e':'#080f12'};padding:18px 24px;text-align:center;">
        <div style="font-weight:700;color:#34d399;font-size:13px;text-transform:uppercase;letter-spacing:.05em;">
          📣 Recall Reminder
        </div>
        <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:4px;">${esc(store)} · ${esc(retailerName)}</div>
      </div>
      <div style="padding:20px 24px;">
        <div style="background:#fff3f3;border:1px solid #fed7d7;border-radius:8px;padding:14px;margin-bottom:14px;">
          <div style="font-size:15px;font-weight:700;color:#1a1a1a;">${esc(product)}</div>
          ${lot?`<div style="font-family:monospace;font-size:12px;color:#555;margin-top:3px;">Lot: ${esc(lot)}</div>`:''}
        </div>
        <p style="color:#333;font-size:14px;line-height:1.6;">
          <strong>${esc(store)}</strong> has not yet completed the recall response chain for this product. Please complete all five steps in Batch'd.
        </p>
        ${coord?`<div style="background:#f7f7f7;border-radius:8px;padding:12px;margin-bottom:14px;">
          <div style="font-size:10px;color:#888;text-transform:uppercase;margin-bottom:3px;">Recall coordinator</div>
          <div style="font-weight:600;color:#333;">${esc(coord)}</div>
          ${coordTel?`<div style="font-size:12px;color:#666;">${esc(coordTel)}</div>`:''}
        </div>`:''}
        <div style="text-align:center;padding:8px 0 16px;">
          <a href="https://batchd-app.netlify.app" style="background:#34d399;color:#052e16;text-decoration:none;font-weight:700;font-size:14px;padding:13px 26px;border-radius:8px;display:inline-block;">
            Open Batch'd — Continue the response
          </a>
        </div>
        <p style="font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px;">
          Sent from your organisation's Batch'd dashboard by your recall team.
        </p>
      </div>
      <div style="background:#f9f9f9;padding:12px 24px;text-align:center;font-size:11px;color:#aaa;">
        Batch'd · <a href="https://batchdapp.com" style="color:#34d399;text-decoration:none;">batchdapp.com</a>
      </div>
    </div>
  </body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }
  if (!process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured (SUPABASE_SERVICE_KEY missing)' }) };
  }
  if (!RESEND_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured (RESEND_API_KEY missing)' }) };
  }

  try {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { recallEventId, orgId } = body;
    if (!recallEventId || !orgId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'recallEventId + orgId required' }) };
    }

    const sb = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // ── Auth: active corp_admin of the claimed org ──────────────
    const auth = event.headers?.authorization || event.headers?.Authorization || '';
    const jwt  = auth.replace(/^Bearer\s+/i, '');
    let callerOk = false;
    if (jwt) {
      try {
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${jwt}` },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          if (userData?.id) {
            const { data: mem } = await sb.from('organisation_members')
              .select('role, active')
              .eq('user_id', userData.id)
              .eq('organisation_id', orgId)
              .limit(1);
            // active NULL means active; only explicit false is deactivated
            // (matches the dashboard's member.active === false convention).
            callerOk = mem?.[0]?.role === 'corp_admin' && mem?.[0]?.active !== false;
          }
        }
      } catch (_) { /* fall through to 403 */ }
    }
    if (!callerOk) {
      return { statusCode: 403, body: JSON.stringify({ error: 'corp_admin sign-in required' }) };
    }

    // ── Targets: every non-Resolved store on this recall, drills excluded ──
    const { data: acks, error } = await sb.from('recall_acknowledgements')
      .select(`id,status,created_at,escalation_2h_sent_at,escalation_24h_sent_at,
        stores(name),
        recall_events!inner(id,product_name,lot_number,severity,published_at,is_drill),
        organisations!recall_acknowledgements_organisation_id_fkey(name,contact_email,recall_coordinator_name,recall_coordinator_contact)`)
      .eq('recall_event_id', recallEventId)
      .eq('organisation_id', orgId)
      .neq('status', 'confirmed')
      .eq('recall_events.is_drill', false);
    if (error) throw error;

    const now = new Date();
    let sentManual = 0, failed = 0;
    const list = acks || [];

    // Batched parallel sends (verify-fix 2026-08-05): sequential awaits
    // could exceed Netlify's ~10s function budget at 20+ pending stores,
    // killing the run mid-loop after some emails had already gone out —
    // the client would then report total failure and a retry would
    // double-send. Batches of 10 with a 6s per-send cap keep worst-case
    // wall time inside the budget.
    const BATCH = 10;
    for (let i = 0; i < list.length; i += BATCH) {
      const settled = await Promise.allSettled(list.slice(i, i + BATCH).map(async (ack) => {
        const ev       = ack.recall_events;
        const retailer = ack.organisations;
        if (!ev || !retailer?.contact_email) throw new Error('missing recipient email');

        const store   = ack.stores?.name || 'Unknown store';
        const product = ev.product_name  || 'Unknown product';

        // Subject lines are plain text — no HTML escaping (an apostrophe
        // must not arrive as &#39; in the inbox).
        await sendEmail(
          retailer.contact_email,
          `[Reminder] Recall action needed — ${product} · ${store}`,
          buildReminderHtml({
            store, product,
            retailerName: retailer.name,
            lot:          ev.lot_number || null,
            severity:     ev.severity,
            coord:        retailer.recall_coordinator_name || null,
            coordTel:     retailer.recall_coordinator_contact || null,
          })
        );

        // Stamp AFTER a confirmed send. 2h stamp (when empty) tells the
        // scheduled escalation this store was already nudged; the 24h
        // stamp is added too once 24h have elapsed so the scheduler
        // doesn't send a second email to the same contact within 30
        // minutes of a manual reminder. Stamp failures are logged —
        // supabase-js resolves errors instead of throwing.
        const updates = {};
        if (!ack.escalation_2h_sent_at) updates.escalation_2h_sent_at = now.toISOString();
        const elapsed = now - new Date(ev.published_at || ack.created_at);
        if (elapsed >= H24 && !ack.escalation_24h_sent_at) updates.escalation_24h_sent_at = now.toISOString();
        if (Object.keys(updates).length) {
          const { error: stampErr } = await sb.from('recall_acknowledgements').update(updates).eq('id', ack.id);
          if (stampErr) console.error('[recall-reminder] stamp update failed:', stampErr.message);
        }
      }));
      settled.forEach(s => {
        if (s.status === 'fulfilled') sentManual++;
        else { failed++; console.error('[recall-reminder] send error:', s.reason?.message || s.reason); }
      });
    }

    const result = { checked: (acks||[]).length, sentManual, failed, at: now.toISOString() };
    console.log('[recall-reminder] Done:', result);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch(err) {
    console.error('[recall-reminder] error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
