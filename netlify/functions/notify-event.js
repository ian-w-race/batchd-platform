// netlify/functions/notify-event.js
//
// Sends per-event email notifications to opted-in users in an
// organisation. One function handles all three event types Ian
// chose to wire (Settings backlog #1, May 2026):
//
//   - recall_pushed:    a recall is pushed in the org
//   - complaint_filed:  a complaint is filed at a store
//   - drill_scheduled:  a mock drill is launched
//
// Floor staff are deliberately EXCLUDED from email notifications —
// they get in-app alerts via the scanner. Targeted recipients per
// event type:
//
//   - recall_pushed:   corp_admin (all in org) + store_manager (all in org)
//   - complaint_filed: corp_admin + store_managers of the affected store
//   - drill_scheduled: corp_admin + store_manager (all in org)
//
// Per-user opt-out: user_settings.notification_prefs JSONB. Reader
// treats absent keys as TRUE (default-on) so new event types ship
// default-on until users explicitly opt out.
//
// Auth: caller must include `Authorization: Bearer <supabase_jwt>`.
// Function verifies the caller is a member of the claimed org_id
// before sending. Prevents cross-org abuse.

const SUPABASE_URL = 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY       = process.env.RESEND_API_KEY;
const FROM_EMAIL           = 'alerts@batchdapp.com';
const FROM_NAME            = "Batch'd Alerts";
const APP_BASE_URL         = process.env.APP_BASE_URL || 'https://app.batchdapp.com';

// ── Supabase REST helpers ──────────────────────────────────────

function sbHeaders() {
  return {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  };
}

async function sbQuery(table, params) {
  const qs = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { method: 'GET', headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase ${table} query failed: ${res.status}`);
  return await res.json();
}

// HTML-safe escape for email body interpolation.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Returns the list of {id, email, role, full_name} for users in the
// given org with the named notification pref enabled. Default-on:
// rows missing notification_prefs.<key> are treated as TRUE.
//
// `storeIdScope` (optional, for complaint_filed): if provided, also
// includes the manager_store_ids overlap check for store_manager
// rows. corp_admins are always included regardless of store_scope.
async function listRecipients(orgId, prefKey, storeIdScope) {
  // We can't use Supabase REST to filter on JSONB-absent-or-true cleanly
  // in a single query, so fetch + filter client-side. Volume is small
  // (one org's worth of users), so this is fine.
  // Pull active org members in roles that get emails.
  const members = await sbQuery('organisation_members', {
    select: 'user_id,role,full_name,active',
    organisation_id: `eq.${orgId}`,
    role: 'in.(corp_admin,store_manager)',
    active: 'is.true',  // null also accepted — handle below
  });

  if (!members || members.length === 0) return [];

  // Fetch each user's settings + email
  const userIds = members.map(m => m.user_id).filter(Boolean);
  if (userIds.length === 0) return [];

  const idList = `(${userIds.map(id => '"' + id + '"').join(',')})`;
  const settings = await sbQuery('user_settings', {
    select: 'user_id,notification_prefs',
    user_id: `in.${idList}`,
  });
  const settingsByUser = {};
  (settings || []).forEach(s => { settingsByUser[s.user_id] = s; });

  // For store-scoped events, look up which managers cover the relevant store.
  let managerStoreCoverage = {};
  if (storeIdScope && prefKey === 'complaint_filed') {
    const sms = await sbQuery('store_manager_stores', {
      select: 'user_id,store_id',
      store_id: `eq.${storeIdScope}`,
    }).catch(() => []);
    (sms || []).forEach(r => { managerStoreCoverage[r.user_id] = true; });
  }

  // Get auth.users.email for each user_id via Supabase admin endpoint.
  // We need their email to actually send. supabase REST exposes auth
  // via /auth/v1/admin/users on the service-role key.
  const recipients = [];
  for (const m of members) {
    if (m.active === false) continue;  // explicit deactivated
    const userSett = settingsByUser[m.user_id];
    const prefs = userSett?.notification_prefs || {};
    // Default-on: only skip if explicitly false
    if (prefs[prefKey] === false) continue;

    // Store-scope filter for store_managers (complaint_filed only)
    if (storeIdScope && m.role === 'store_manager') {
      if (!managerStoreCoverage[m.user_id]) continue;
    }

    // Fetch email from auth.users via admin endpoint
    try {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${m.user_id}`, {
        method: 'GET', headers: sbHeaders(),
      });
      if (!userRes.ok) continue;
      const userData = await userRes.json();
      if (userData?.email) {
        recipients.push({
          id:        m.user_id,
          email:     userData.email,
          role:      m.role,
          full_name: m.full_name || userData.email.split('@')[0],
        });
      }
    } catch (_) { /* skip — best-effort per-recipient */ }
  }
  return recipients;
}

// ── Verify caller is a member of the claimed org ──────────────
async function verifyCallerOrgMembership(jwt, orgId) {
  if (!jwt) return false;
  try {
    // Resolve user from JWT via Supabase auth
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${jwt}` },
    });
    if (!userRes.ok) return false;
    const userData = await userRes.json();
    const userId = userData?.id;
    if (!userId) return false;
    // Verify membership
    const members = await sbQuery('organisation_members', {
      select: 'user_id',
      user_id: `eq.${userId}`,
      organisation_id: `eq.${orgId}`,
    });
    return Array.isArray(members) && members.length > 0;
  } catch (_) { return false; }
}

// ── Email templates ────────────────────────────────────────────
//
// Each template returns { subject, html, text }. Plain-text fallback
// is included for clients that don't render HTML (Outlook plain mode).
// Footer signs each as a Batch'd alert with the org name so recipients
// can identify the source without opening the email body.

function tmplRecallPushed(p, orgName) {
  const url = `${APP_BASE_URL}/dashboard.html`;
  const subject = `Recall pushed — ${p.product_name || 'Unnamed product'} (${orgName})`;
  const html = `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#1a201d;line-height:1.6;">
  <div style="font-weight:800;font-size:20px;color:#077A55;letter-spacing:-0.01em;">Batch'd</div>
  <h2 style="font-size:17px;margin-top:24px;">A recall was just pushed in your organisation</h2>
  <p>A recall has been initiated by <strong>${esc(orgName)}</strong> and is now live across the affected stores.</p>
  <div style="background:#fff3f3;border:1px solid #fbcaca;border-radius:8px;padding:14px 16px;margin:18px 0;">
    <div><strong>Product:</strong> ${esc(p.product_name || '—')}</div>
    ${p.lot_number ? `<div><strong>Lot / batch:</strong> <span style="font-family:monospace;">${esc(p.lot_number)}</span></div>` : ''}
    ${p.severity ? `<div><strong>Severity:</strong> ${esc(p.severity).replace(/_/g,' ').replace(/^./, m=>m.toUpperCase())}</div>` : ''}
    ${p.reason ? `<div style="margin-top:6px;"><strong>Reason:</strong> ${esc(p.reason)}</div>` : ''}
  </div>
  <p>Stores in your network will see the recall in their scanning app and dashboard. Coordinator action is required to push through the 5-step response chain.</p>
  <p style="margin:24px 0;"><a href="${url}" style="display:inline-block;background:#077A55;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;">Open Batch'd dashboard →</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="font-size:11px;color:#888;">You're receiving this because <em>"Recall pushed"</em> notifications are enabled in your <a href="${url}" style="color:#077A55;">Batch'd preferences</a>. Disable in Settings → Your preferences.</p>
</body></html>`;
  const text = `Batch'd Alert — Recall pushed in ${orgName}

Product: ${p.product_name || '—'}
${p.lot_number ? `Lot: ${p.lot_number}\n` : ''}${p.severity ? `Severity: ${p.severity}\n` : ''}${p.reason ? `Reason: ${p.reason}\n` : ''}
Open dashboard: ${url}

(Disable in Settings → Your preferences.)`;
  return { subject, html, text };
}

function tmplComplaintFiled(p, orgName) {
  const url = `${APP_BASE_URL}/dashboard.html`;
  const subject = `Complaint filed — ${p.product_name || 'product'} (${p.complaint_number || 'new complaint'})`;
  const html = `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#1a201d;line-height:1.6;">
  <div style="font-weight:800;font-size:20px;color:#077A55;letter-spacing:-0.01em;">Batch'd</div>
  <h2 style="font-size:17px;margin-top:24px;">A new customer complaint was filed</h2>
  <p>A complaint was just logged ${p.store_name ? `at <strong>${esc(p.store_name)}</strong>` : `in <strong>${esc(orgName)}</strong>`} and needs triage review.</p>
  <div style="background:#fff8ec;border:1px solid #f5e0a8;border-radius:8px;padding:14px 16px;margin:18px 0;">
    ${p.complaint_number ? `<div><strong>Ref:</strong> <span style="font-family:monospace;">${esc(p.complaint_number)}</span></div>` : ''}
    <div><strong>Product:</strong> ${esc(p.product_name || '—')}</div>
    ${p.lot_number ? `<div><strong>Lot:</strong> <span style="font-family:monospace;">${esc(p.lot_number)}</span></div>` : ''}
    ${p.triage_level ? `<div><strong>Triage:</strong> ${esc(p.triage_level).toUpperCase()}</div>` : ''}
  </div>
  <p>Open the Complaint Triage panel to review, assign follow-up, or escalate.</p>
  <p style="margin:24px 0;"><a href="${url}" style="display:inline-block;background:#077A55;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;">Open Batch'd dashboard →</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="font-size:11px;color:#888;">You're receiving this because <em>"Complaint filed"</em> notifications are enabled in your <a href="${url}" style="color:#077A55;">Batch'd preferences</a>. Disable in Settings → Your preferences.</p>
</body></html>`;
  const text = `Batch'd Alert — Complaint filed (${orgName})

${p.complaint_number ? `Ref: ${p.complaint_number}\n` : ''}Product: ${p.product_name || '—'}
${p.lot_number ? `Lot: ${p.lot_number}\n` : ''}${p.triage_level ? `Triage: ${p.triage_level}\n` : ''}${p.store_name ? `Store: ${p.store_name}\n` : ''}
Open dashboard: ${url}

(Disable in Settings → Your preferences.)`;
  return { subject, html, text };
}

function tmplDrillScheduled(p, orgName) {
  const url = `${APP_BASE_URL}/dashboard.html`;
  const subject = `Mock drill launched — ${p.product_name || 'recall readiness drill'} (${orgName})`;
  const html = `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#1a201d;line-height:1.6;">
  <div style="font-weight:800;font-size:20px;color:#077A55;letter-spacing:-0.01em;">Batch'd</div>
  <h2 style="font-size:17px;margin-top:24px;">A mock recall drill has been launched</h2>
  <p>A drill is now live across <strong>${esc(orgName)}</strong>'s active stores. Drill records are flagged separately from real recalls — but stores need to walk through the same 5-step response chain to count.</p>
  <div style="background:#f0f9ff;border:1px solid #c5e2f5;border-radius:8px;padding:14px 16px;margin:18px 0;">
    <div><strong>Drill product:</strong> ${esc(p.product_name || '—')}</div>
    ${p.lot_number ? `<div><strong>Lot:</strong> <span style="font-family:monospace;">${esc(p.lot_number)}</span></div>` : ''}
    ${p.reason ? `<div style="margin-top:6px;"><strong>Reason:</strong> ${esc(p.reason)}</div>` : ''}
  </div>
  <p>Open the Recalls panel to track per-store progress. The drill certificate will generate when all stores reach Resolved.</p>
  <p style="margin:24px 0;"><a href="${url}" style="display:inline-block;background:#077A55;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;">Open Batch'd dashboard →</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="font-size:11px;color:#888;">You're receiving this because <em>"Drill scheduled"</em> notifications are enabled in your <a href="${url}" style="color:#077A55;">Batch'd preferences</a>. Disable in Settings → Your preferences.</p>
</body></html>`;
  const text = `Batch'd Alert — Mock drill launched (${orgName})

Drill product: ${p.product_name || '—'}
${p.lot_number ? `Lot: ${p.lot_number}\n` : ''}${p.reason ? `Reason: ${p.reason}\n` : ''}
Open dashboard: ${url}

(Disable in Settings → Your preferences.)`;
  return { subject, html, text };
}

const TEMPLATES = {
  recall_pushed:    tmplRecallPushed,
  complaint_filed:  tmplComplaintFiled,
  drill_scheduled:  tmplDrillScheduled,
};

// ── Send via Resend ────────────────────────────────────────────
async function sendOne(to, subject, html, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from:    `${FROM_NAME} <${FROM_EMAIL}>`,
      to:      [to],
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${detail}`);
  }
}

// ── Handler ────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }
  if (!SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured (SUPABASE_SERVICE_KEY missing)' }) };
  }
  if (!RESEND_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured (RESEND_API_KEY missing)' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { event_type, org_id, payload, internal_secret } = body;
  if (!event_type || !TEMPLATES[event_type]) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown event_type' }) };
  }
  if (!org_id || !payload) {
    return { statusCode: 400, body: JSON.stringify({ error: 'org_id + payload required' }) };
  }

  // Auth: two paths.
  //  1. Server-to-server: include INTERNAL_NOTIFY_SECRET in body.
  //     Used by other Netlify Functions (triage-complaint) that fire
  //     this from a no-JWT context.
  //  2. Browser: include Authorization: Bearer <jwt>. Caller must
  //     be a member of org_id.
  const internalOk = !!(process.env.INTERNAL_NOTIFY_SECRET &&
                        internal_secret === process.env.INTERNAL_NOTIFY_SECRET);
  if (!internalOk) {
    const auth = event.headers.authorization || event.headers.Authorization || '';
    const jwt  = auth.replace(/^Bearer\s+/i, '');
    const isMember = await verifyCallerOrgMembership(jwt, org_id);
    if (!isMember) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not a member of this org' }) };
    }
  }

  // Look up org name for the email subject lines.
  let orgName = 'your organisation';
  try {
    const orgs = await sbQuery('organisations', { select: 'name', id: `eq.${org_id}` });
    if (orgs?.[0]?.name) orgName = orgs[0].name;
  } catch (_) { /* fall back to placeholder */ }

  // Resolve recipients per event type
  const storeIdScope = (event_type === 'complaint_filed') ? (payload.store_id || null) : null;
  const recipients = await listRecipients(org_id, event_type, storeIdScope);

  if (recipients.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, sent: 0, note: 'No opted-in recipients in this org for this event type.' }),
    };
  }

  // Compose + send. Best-effort per recipient — one failed send doesn't
  // block the others. Return a summary so callers can log if needed.
  const tmpl = TEMPLATES[event_type](payload, orgName);
  let sent = 0, failed = 0;
  const errors = [];
  for (const r of recipients) {
    try {
      await sendOne(r.email, tmpl.subject, tmpl.html, tmpl.text);
      sent++;
    } catch (e) {
      failed++;
      errors.push({ to: r.email, message: String(e.message || e).slice(0, 200) });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, event_type, sent, failed, errors }),
  };
};
