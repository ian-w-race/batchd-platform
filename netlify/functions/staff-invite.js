// ================================================================
// staff-invite.js — Batch'd Netlify serverless function
// Creates a staff_invitations row + sends a magic-link email via
// Resend. Called from the corporate dashboard or store-manager
// dashboard when someone clicks "Invite staff member".
//
// Auth: caller must pass their Supabase session JWT as
// `Authorization: Bearer <jwt>`. We validate it server-side and
// then enforce role-based permissions:
//   - corp_admin → can invite any role for any store in their org
//   - store_manager → can invite store_manager or staff for the
//                     stores they manage (cannot invite corp_admin)
//
// Request body (JSON):
//   email:                     string  (required)
//   intended_role:             'corp_admin' | 'store_manager' | 'staff' (required)
//   intended_primary_store_id: uuid    (required when intended_role='staff')
//   intended_manager_store_ids: uuid[] (required when intended_role='store_manager')
//   intended_full_name:        string  (optional, pre-fills accept page)
//   intended_phone_number:     string  (optional)
//   intended_hire_date:        'YYYY-MM-DD' (optional)
//   intended_store_role:       string  (optional)
//   intended_employee_id:      string  (optional)
//
// On success: returns { invitation_id, expires_at }.
// On failure: 4xx/5xx with { error, detail? }.
//
// Companion functions: staff-invite-accept.js (handles GET-token-info
// and POST-accept flows), accept-invite.html (landing page).
// ================================================================

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL         = process.env.SUPABASE_URL         || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY       = process.env.RESEND_API_KEY;
const APP_BASE_URL         = process.env.APP_BASE_URL         || 'https://app.batchdapp.com';
const FROM_EMAIL           = 'invites@batchdapp.com';
const FROM_NAME            = "Batch'd";

// HTML-safe escaping for email body — product names, store names, etc.
// could contain < > & " ' characters.
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Cryptographically-strong token. 32 bytes ≈ 256 bits of entropy,
// URL-safe base64. Used as the magic-link query param.
function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

exports.handler = async (event) => {
  // CORS preflight for browser-initiated calls from app.batchdapp.com.
  // Netlify normally allows same-origin without this, but if the
  // dashboard ever moves to a different subdomain it'll need this.
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Caller authentication ──────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Authorization header required' }) };
  }
  const jwt = authHeader.slice(7);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: callerAuth, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !callerAuth?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session' }) };
  }
  const caller = callerAuth.user;

  // ── Caller authorization (role + org) ──────────────────────────
  const { data: callerMember, error: memberErr } = await sb.from('organisation_members')
    .select('role, organisation_id, active, full_name')
    .eq('user_id', caller.id)
    .maybeSingle();

  if (memberErr || !callerMember) {
    return { statusCode: 403, body: JSON.stringify({ error: 'No org membership on record' }) };
  }
  if (callerMember.active === false) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Account is deactivated' }) };
  }
  if (!['corp_admin', 'store_manager'].includes(callerMember.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only managers and admins can invite' }) };
  }

  // ── Parse + validate request body ──────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const {
    email,
    intended_role,
    intended_primary_store_id,
    intended_manager_store_ids,
    intended_full_name,
    intended_phone_number,
    intended_hire_date,
    intended_store_role,
    intended_employee_id,
  } = body;

  if (!email || typeof email !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'email required' }) };
  }
  if (!intended_role || !['corp_admin', 'store_manager', 'staff'].includes(intended_role)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'intended_role must be corp_admin, store_manager, or staff' }) };
  }
  if (intended_role === 'staff' && !intended_primary_store_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'intended_primary_store_id required for staff invites' }) };
  }
  if (intended_role === 'store_manager' && (!Array.isArray(intended_manager_store_ids) || intended_manager_store_ids.length === 0)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'intended_manager_store_ids required for store_manager invites' }) };
  }

  // ── Permission check: managers can only invite within their scope
  if (callerMember.role === 'store_manager') {
    if (intended_role === 'corp_admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Store managers cannot invite corporate admins' }) };
    }

    // Fetch the manager's covered store IDs
    const { data: managedRows } = await sb.from('store_manager_stores')
      .select('store_id')
      .eq('user_id', caller.id);
    const managedSet = new Set((managedRows || []).map(r => r.store_id));

    if (intended_role === 'staff' && !managedSet.has(intended_primary_store_id)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'You can only invite staff to stores you manage' }) };
    }
    if (intended_role === 'store_manager') {
      const notAllowed = intended_manager_store_ids.filter(id => !managedSet.has(id));
      if (notAllowed.length > 0) {
        return { statusCode: 403, body: JSON.stringify({ error: 'You can only assign other managers to stores you manage' }) };
      }
    }
  }

  // ── Validate stores actually belong to caller's org ────────────
  // Prevents a caller from inviting someone to a store in a different
  // organisation (RLS would block reads but inserts to staff_invitations
  // would otherwise succeed since we're using the service role here).
  const allStoreIds = [
    intended_primary_store_id,
    ...(intended_manager_store_ids || []),
  ].filter(Boolean);

  if (allStoreIds.length > 0) {
    const { data: orgStores } = await sb.from('stores')
      .select('id')
      .eq('organisation_id', callerMember.organisation_id)
      .in('id', allStoreIds);
    const orgStoreSet = new Set((orgStores || []).map(s => s.id));
    const foreign = allStoreIds.filter(id => !orgStoreSet.has(id));
    if (foreign.length > 0) {
      return { statusCode: 403, body: JSON.stringify({ error: 'One or more stores are not in your organisation' }) };
    }
  }

  // ── Create the invitation row ──────────────────────────────────
  const token = randomToken();
  const { data: invite, error: insErr } = await sb.from('staff_invitations')
    .insert({
      token,
      email: email.toLowerCase().trim(),
      organisation_id: callerMember.organisation_id,
      invited_by: caller.id,
      intended_role,
      intended_primary_store_id: intended_primary_store_id || null,
      intended_manager_store_ids: intended_manager_store_ids || null,
      intended_full_name:     intended_full_name     || null,
      intended_phone_number:  intended_phone_number  || null,
      intended_hire_date:     intended_hire_date     || null,
      intended_store_role:    intended_store_role    || null,
      intended_employee_id:   intended_employee_id   || null,
    })
    .select('id, expires_at')
    .single();

  if (insErr) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not create invitation', detail: insErr.message }) };
  }

  // ── Build the invitation email ─────────────────────────────────
  const { data: org } = await sb.from('organisations')
    .select('name')
    .eq('id', callerMember.organisation_id)
    .single();
  const orgName = org?.name || 'your organisation';

  const inviterName = callerMember.full_name || caller.email || 'someone at your organisation';

  let storeContext = '';
  if (intended_primary_store_id) {
    const { data: store } = await sb.from('stores').select('name').eq('id', intended_primary_store_id).single();
    if (store?.name) storeContext = ` at <strong>${esc(store.name)}</strong>`;
  } else if (intended_role === 'store_manager' && intended_manager_store_ids?.length) {
    const { data: stores } = await sb.from('stores')
      .select('name')
      .in('id', intended_manager_store_ids);
    if (stores?.length) {
      const names = stores.map(s => esc(s.name)).join(', ');
      storeContext = ` covering <strong>${names}</strong>`;
    }
  }

  const acceptUrl = `${APP_BASE_URL}/accept-invite.html?token=${encodeURIComponent(token)}`;
  const roleLabel = ({
    corp_admin:    'corporate admin',
    store_manager: 'store manager',
    staff:         'store staff',
  })[intended_role];

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Batch'd invitation</title></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;color:#1a201d;max-width:560px;margin:0 auto;padding:24px;line-height:1.6;background:#fff;">

  <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-weight:800;font-size:22px;color:#077A55;letter-spacing:-0.01em;">Batch'd</div>
  <div style="margin-top:4px;text-transform:uppercase;letter-spacing:0.12em;font-size:10px;color:#666;font-weight:600;">Food Traceability &amp; Recall Management</div>

  <h2 style="margin-top:30px;font-size:18px;color:#1a201d;">You're invited to join ${esc(orgName)}</h2>

  <p style="font-size:14px;color:#1a201d;">${esc(inviterName)} has invited you to join <strong>${esc(orgName)}</strong> on Batch'd as ${esc(roleLabel)}${storeContext}.</p>

  <p style="font-size:14px;color:#1a201d;">Batch'd is the recall-management platform your team uses to scan products, track shelf inventory, and respond to food-safety recalls.</p>

  <p style="margin:30px 0;text-align:center;">
    <a href="${acceptUrl}" style="display:inline-block;background:#077A55;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Accept invite &amp; set password</a>
  </p>

  <p style="font-size:12px;color:#666;">Or paste this link into your browser:<br>
    <span style="word-break:break-all;font-family:'SF Mono',Menlo,monospace;font-size:11px;color:#444;">${esc(acceptUrl)}</span>
  </p>

  <p style="font-size:11px;color:#888;margin-top:36px;border-top:1px solid #eee;padding-top:16px;">
    This invite expires in 7 days. If you weren't expecting this email, you can ignore it — no account will be created until you click the link and set a password.
  </p>

  <p style="font-size:10px;color:#888;margin-top:16px;text-align:center;">
    Batch'd &middot; <span style="font-family:monospace;">batchd.no</span>
  </p>

</body></html>`;

  const text = `You're invited to join ${orgName} on Batch'd

${inviterName} has invited you to join ${orgName} on Batch'd as ${roleLabel}${
  intended_primary_store_id ? ' at your assigned store' : ''
}.

Accept the invite and set your password:
${acceptUrl}

This invite expires in 7 days.

— Batch'd · batchd.no`;

  // ── Send via Resend ────────────────────────────────────────────
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    `${FROM_NAME} <${FROM_EMAIL}>`,
        to:      [email],
        subject: `You're invited to ${orgName} on Batch'd`,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      // Roll back: cancel the invitation so it doesn't sit unsent
      await sb.from('staff_invitations')
        .update({ cancelled_at: new Date().toISOString(), cancelled_by: caller.id })
        .eq('id', invite.id);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Email send failed', detail: errText }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invitation_id: invite.id,
        expires_at:    invite.expires_at,
        email,
      }),
    };
  } catch (e) {
    await sb.from('staff_invitations')
      .update({ cancelled_at: new Date().toISOString(), cancelled_by: caller.id })
      .eq('id', invite.id);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
