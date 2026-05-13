// ================================================================
// staff-invite-accept.js — Batch'd Netlify serverless function
// Handles the accept-invite landing page's two operations:
//
//   GET ?token=XYZ
//     Validates the token and returns the pre-fill data for the
//     accept page (org name, intended role, store names, HR fields).
//     No side effects.
//
//   POST body { token, password, full_name?, phone_number?,
//               hire_date?, store_role?, employee_id? }
//     Validates the token, creates the auth.users row (admin API),
//     inserts into organisation_members with the intended role +
//     primary_store_id + HR fields, inserts store_manager_stores
//     rows if applicable, and marks the invitation accepted.
//
// Public — no Authorization header required. The token IS the auth
// (32 bytes of entropy, single-use, 7-day expiry).
//
// Companion: staff-invite.js (creates the invite), accept-invite.html
// (the landing page that calls this function).
// ================================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL         = process.env.SUPABASE_URL         || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function cors() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...cors() },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ────────────────────────────────────────────────────────────────
  // GET — validate token, return display data for the accept page
  // ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const token = event.queryStringParameters?.token;
    if (!token) return json(400, { error: 'token required' });

    const { data: invite } = await sb.from('staff_invitations')
      .select(`
        id, email, intended_role,
        intended_primary_store_id, intended_manager_store_ids,
        intended_full_name, intended_phone_number, intended_hire_date,
        intended_store_role, intended_employee_id,
        organisation_id,
        expires_at, accepted_at, cancelled_at
      `)
      .eq('token', token)
      .maybeSingle();

    if (!invite) return json(404, { status: 'not_found', error: 'Invitation not found' });
    if (invite.accepted_at) return json(410, { status: 'accepted', error: 'This invitation was already accepted' });
    if (invite.cancelled_at) return json(410, { status: 'cancelled', error: 'This invitation was cancelled' });
    if (new Date(invite.expires_at) < new Date()) {
      return json(410, { status: 'expired', error: 'This invitation has expired' });
    }

    // Look up display names for org + stores
    const { data: org } = await sb.from('organisations')
      .select('name')
      .eq('id', invite.organisation_id)
      .single();

    let primary_store_name = null;
    if (invite.intended_primary_store_id) {
      const { data: s } = await sb.from('stores')
        .select('name')
        .eq('id', invite.intended_primary_store_id)
        .maybeSingle();
      primary_store_name = s?.name || null;
    }

    let manager_store_names = [];
    if (invite.intended_manager_store_ids?.length) {
      const { data: stores } = await sb.from('stores')
        .select('id, name')
        .in('id', invite.intended_manager_store_ids);
      manager_store_names = (stores || []).map(s => s.name);
    }

    return json(200, {
      status: 'valid',
      email:                   invite.email,
      intended_role:           invite.intended_role,
      intended_full_name:      invite.intended_full_name,
      intended_phone_number:   invite.intended_phone_number,
      intended_hire_date:      invite.intended_hire_date,
      intended_store_role:     invite.intended_store_role,
      intended_employee_id:    invite.intended_employee_id,
      organisation_name:       org?.name || null,
      primary_store_name,
      manager_store_names,
      expires_at:              invite.expires_at,
    });
  }

  // ────────────────────────────────────────────────────────────────
  // POST — accept the invitation, create the account
  // ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return json(400, { error: 'Invalid JSON' }); }

    const {
      token,
      password,
      full_name, phone_number, hire_date, store_role, employee_id,
    } = body;

    if (!token || typeof token !== 'string') return json(400, { error: 'token required' });
    if (!password || typeof password !== 'string') return json(400, { error: 'password required' });
    if (password.length < 8) return json(400, { error: 'Password must be at least 8 characters' });

    // Look up + validate
    const { data: invite } = await sb.from('staff_invitations')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (!invite) return json(404, { error: 'Invitation not found' });
    if (invite.accepted_at) return json(410, { error: 'This invitation was already accepted' });
    if (invite.cancelled_at) return json(410, { error: 'This invitation was cancelled' });
    if (new Date(invite.expires_at) < new Date()) {
      return json(410, { error: 'This invitation has expired' });
    }

    // ── Create the auth.users row (admin API) ────────────────────
    const { data: userData, error: userErr } = await sb.auth.admin.createUser({
      email:         invite.email,
      password,
      email_confirm: true,  // verified by virtue of the invite email being deliverable
      user_metadata: {
        full_name:     full_name || invite.intended_full_name || null,
        invited_by:    invite.invited_by,
        invitation_id: invite.id,
      },
    });

    if (userErr || !userData?.user) {
      const msg = userErr?.message || 'Unknown error';
      // Distinguish "already exists" from other failures so the UI can
      // route the user to sign-in instead of confusing them.
      if (/already|exists|registered/i.test(msg)) {
        return json(409, {
          error: 'An account with this email address already exists. Try signing in instead.',
          code:  'email_exists',
        });
      }
      return json(500, { error: 'Failed to create account', detail: msg });
    }

    const newUserId = userData.user.id;

    // ── Insert organisation_members row ──────────────────────────
    const { error: memberErr } = await sb.from('organisation_members').insert({
      user_id:          newUserId,
      organisation_id:  invite.organisation_id,
      role:             invite.intended_role,
      primary_store_id: invite.intended_primary_store_id,
      full_name:        full_name     || invite.intended_full_name     || null,
      phone_number:     phone_number  || invite.intended_phone_number  || null,
      hire_date:        hire_date     || invite.intended_hire_date     || null,
      store_role:       store_role    || invite.intended_store_role    || null,
      employee_id:      employee_id   || invite.intended_employee_id   || null,
      active:           true,
    });

    if (memberErr) {
      // Roll back: delete the auth user we just created. Leaves the
      // invitation un-accepted so the invitee can retry.
      await sb.auth.admin.deleteUser(newUserId).catch(() => {});
      return json(500, { error: 'Failed to link account to organisation', detail: memberErr.message });
    }

    // ── If manager: link to assigned stores ──────────────────────
    if (invite.intended_role === 'store_manager' && Array.isArray(invite.intended_manager_store_ids) && invite.intended_manager_store_ids.length > 0) {
      const rows = invite.intended_manager_store_ids.map(store_id => ({
        user_id:         newUserId,
        store_id,
        organisation_id: invite.organisation_id,
        assigned_by:     invite.invited_by,
      }));
      const { error: smsErr } = await sb.from('store_manager_stores').insert(rows);
      if (smsErr) {
        // Don't roll back — the account itself is good, just the store
        // assignment failed. Surface the warning so corp admin can fix
        // manually if needed. Most likely cause is a stale store_id.
        console.warn('[staff-invite-accept] store_manager_stores insert failed:', smsErr.message);
      }
    }

    // ── Mark invitation accepted ─────────────────────────────────
    await sb.from('staff_invitations')
      .update({
        accepted_at: new Date().toISOString(),
        accepted_by: newUserId,
      })
      .eq('id', invite.id);

    return json(200, {
      success: true,
      user_id: newUserId,
      email:   invite.email,
      role:    invite.intended_role,
    });
  }

  return json(405, { error: 'Method not allowed' });
};
