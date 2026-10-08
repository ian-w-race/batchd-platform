// netlify/functions/send-invite.js
// Sends staff invitation emails via Resend. The demo-request path was
// removed 2026-09-20: landing.html is unlinked and the brand site
// (batchd.no, its own repo) owns demo requests.
//
// Security boundaries:
//  - Resend API key is read from RESEND_API_KEY env var (no fallback).
//  - The caller must hold a corp_admin session in the invitation's own org.
//  - Org name, role and inviter come from the invitation row, not the body.
//  - All user-supplied values are HTML-escaped before injection into email templates.
//  - Email addresses are validated server-side (rejects header-injection chars).
//  - inviteUrl is restricted to https:// + trusted hostnames (blocks open redirect).

// ── Helpers ─────────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// Reject control chars, quotes, angle brackets, backslashes — common email-header-injection vectors.
const isValidEmail = (e) => /^[^\s@<>"'\\]+@[^\s@<>"'\\]+\.[^\s@<>"'\\]+$/.test(String(e || ''));

const ALLOWED_INVITE_HOSTS = ['app.batchdapp.com', 'batchd-app.netlify.app', 'batchdapp.com', 'www.batchdapp.com'];

const isValidInviteUrl = (u) => {
  if (!u || typeof u !== 'string') return false;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return false;
    return ALLOWED_INVITE_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
};

// ── Handler ─────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Verify env var present — fail loud rather than silently using a fallback.
  if (!process.env.RESEND_API_KEY) {
    console.error('[send-invite] RESEND_API_KEY env var not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  // Staff invites are NOT origin-gated (2026-09-09): the corp_admin JWT
  // below is a strictly stronger check, and keeping a second host list in
  // sync with netlify.toml is what silently broke every dashboard invite
  // when corporate.batchdapp.com became the dashboard's only origin.

  // Staff invites are only ever sent from the signed-in dashboard. The
  // caller must be a corp_admin of the organisation the INVITATION belongs
  // to; the org name, role and inviter shown in the email come from the
  // invitation row and the session, never from the request body.
  const trusted = await authoriseStaffInvite(event, body);
  if (!trusted) return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized to send this invitation.' }) };
  return handleStaffInvite({ to: String(body.to).trim(), inviteUrl: body.inviteUrl, ...trusted });
};

const SUPABASE_URL         = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const { verifyUser, sbGet, isPlatformAdmin } = require('../lib/auth');

// Every value in the email comes from the invitation row and the session, never the body.
async function authoriseStaffInvite(event, { to, inviteUrl }) {
  if (!isValidInviteUrl(inviteUrl)) return null;
  const token = new URL(inviteUrl).searchParams.get('token');
  if (!token || token.length < 16) return null;
  const user = await verifyUser(event);
  if (!user) return null;
  const inv = (await sbGet(`invitations?token=eq.${encodeURIComponent(token)}&select=email,role,organisation_id,accepted,expires_at&limit=1`))[0];
  if (!inv || inv.accepted) return null;
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) return null;
  if (String(inv.email || '').trim().toLowerCase() !== String(to || '').trim().toLowerCase()) return null;
  const mem = await sbGet(`organisation_members?user_id=eq.${user.id}&organisation_id=eq.${inv.organisation_id}&role=eq.corp_admin&active=not.is.false&select=user_id&limit=1`);
  if (!mem.length && !(await isPlatformAdmin(user.id))) return null;
  const org = (await sbGet(`organisations?id=eq.${inv.organisation_id}&select=name&limit=1`))[0];
  // Phrase with its article so the email reads "as a staff member", not "as a Staff" (fixed 2026-10-07).
  const roleLabel = { corp_admin: 'a corporate admin', store_manager: 'a store manager', staff: 'a staff member' }[inv.role] || ('a ' + inv.role);
  return { orgName: org?.name || 'your organization', role: roleLabel, inviterEmail: user.email || '' };
}

// ── Staff invitation email ─────────────────────────────────
async function handleStaffInvite({ to, orgName, inviterEmail, role, inviteUrl }) {
  if (!isValidEmail(to)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid recipient email' }) };
  }
  if (inviterEmail && !isValidEmail(inviterEmail)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid inviter email' }) };
  }
  if (!isValidInviteUrl(inviteUrl)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid invite URL' }) };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: "Batch'd <invite@batchdapp.com>",
        to: [to],
        subject: `You've been invited to join ${orgName} on Batch'd`,
        html: `
          <div style="font-family:monospace;background:#080f12;color:#edfdf8;padding:40px;max-width:520px;margin:0 auto;border-radius:12px;">
            <div style="font-size:24px;font-weight:800;color:#34d399;margin-bottom:8px;">Batch'd</div>
            <div style="font-size:14px;color:#6aaf9e;margin-bottom:28px;">Food traceability platform</div>
            <div style="font-size:16px;font-weight:600;margin-bottom:12px;">You've been invited</div>
            <p style="font-size:13px;color:#6aaf9e;line-height:1.7;margin-bottom:24px;">
              <strong style="color:#edfdf8;">${esc(inviterEmail)}</strong> has invited you to join
              <strong style="color:#edfdf8;">${esc(orgName)}</strong> on Batch'd as
              <strong style="color:#edfdf8;">${esc(role)}</strong>.
            </p>
            <a href="${esc(inviteUrl)}" style="display:inline-block;background:#34d399;color:#080f12;font-weight:700;font-size:14px;padding:14px 28px;border-radius:8px;text-decoration:none;margin-bottom:24px;">
              Accept invitation →
            </a>
            <p style="font-size:11px;color:#6aaf9e;line-height:1.6;">
              This invitation expires in 7 days.<br>
              If you didn't expect this email, you can safely ignore it.
            </p>
            <div style="border-top:1px solid #163d37;margin-top:24px;padding-top:16px;font-size:10px;color:#6aaf9e;">
              © 2026 Batch'd · <a href="https://batchdapp.com" style="color:#34d399;">batchdapp.com</a>
            </div>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[send-invite] Resend error:', res.status, errText);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send invitation' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('[send-invite] handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send invitation' }) };
  }
}
