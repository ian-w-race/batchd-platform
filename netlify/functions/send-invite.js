// netlify/functions/send-invite.js
// Sends staff invitation emails and demo request notifications via Resend.
//
// Security boundaries:
//  - Resend API key is read from RESEND_API_KEY env var (no fallback).
//  - Origin header must come from a trusted Batch'd domain.
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

const ALLOWED_ORIGINS = [
  'https://batchdapp.com',
  'https://www.batchdapp.com',
  'https://app.batchdapp.com',
  'https://batchd-app.netlify.app',
];

const isAllowedOrigin = (o) => !!o && ALLOWED_ORIGINS.includes(o);

// ── Handler ─────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Origin / Referer allowlist — basic abuse mitigation.
  // Spoofable by determined attackers but blocks casual scripted abuse.
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const referer = event.headers?.referer || event.headers?.Referer || '';
  const clientIp = ((event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'] || '').split(',')[0] || '').trim() || 'unknown';

  let refererOrigin = '';
  try { if (referer) refererOrigin = new URL(referer).origin; } catch {}

  if (!isAllowedOrigin(origin) && !isAllowedOrigin(refererOrigin)) {
    console.warn('[send-invite] rejected origin:', origin, '| referer:', referer, '| ip:', clientIp);
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
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

  if (body.type === 'demo_request') {
    return handleDemoRequest(body);
  }
  return handleStaffInvite(body);
};

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
        subject: `You've been invited to join ${esc(orgName)} on Batch'd`,
        html: `
          <div style="font-family:monospace;background:#080f12;color:#edfdf8;padding:40px;max-width:520px;margin:0 auto;border-radius:12px;">
            <div style="font-size:24px;font-weight:800;color:#34d399;margin-bottom:8px;">Batch'd</div>
            <div style="font-size:14px;color:#6aaf9e;margin-bottom:28px;">Food traceability platform</div>
            <div style="font-size:16px;font-weight:600;margin-bottom:12px;">You've been invited</div>
            <p style="font-size:13px;color:#6aaf9e;line-height:1.7;margin-bottom:24px;">
              <strong style="color:#edfdf8;">${esc(inviterEmail)}</strong> has invited you to join
              <strong style="color:#edfdf8;">${esc(orgName)}</strong> on Batch'd as a
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

// ── Demo request notification email ───────────────────────
async function handleDemoRequest({ firstName, lastName, email, organisation, orgType, stores, message }) {
  if (!isValidEmail(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email address' }) };
  }

  const orgTypeLabels = {
    retailer:     'Grocery retailer / chain',
    manufacturer: 'Food manufacturer / brand',
    distributor:  'Distributor / wholesaler',
    other:        'Other',
  };
  const orgTypeLabel = orgTypeLabels[orgType] || orgType || '—';
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Oslo', dateStyle: 'full', timeStyle: 'short' });

  try {
    // Send notification to Batch'd admin
    const notifyRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: "Batch'd <invite@batchdapp.com>",
        to: ['ian.w.race@gmail.com'],
        subject: `New demo request — ${esc(firstName)} ${esc(lastName)} from ${esc(organisation)}`,
        html: `
          <div style="font-family:monospace;background:#080f12;color:#edfdf8;padding:40px;max-width:560px;margin:0 auto;border-radius:12px;">
            <div style="font-size:22px;font-weight:800;color:#34d399;margin-bottom:4px;">Batch'd</div>
            <div style="font-size:12px;color:#6aaf9e;margin-bottom:28px;letter-spacing:0.08em;text-transform:uppercase;">New demo request</div>

            <div style="background:#0d1e1c;border:1px solid #163d37;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
              <table style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="font-size:11px;color:#6aaf9e;padding:7px 0;border-bottom:1px solid #163d37;width:140px;text-transform:uppercase;letter-spacing:0.06em;">Name</td>
                  <td style="font-size:13px;color:#edfdf8;padding:7px 0;border-bottom:1px solid #163d37;font-weight:600;">${esc(firstName)} ${esc(lastName)}</td>
                </tr>
                <tr>
                  <td style="font-size:11px;color:#6aaf9e;padding:7px 0;border-bottom:1px solid #163d37;text-transform:uppercase;letter-spacing:0.06em;">Email</td>
                  <td style="font-size:13px;padding:7px 0;border-bottom:1px solid #163d37;"><a href="mailto:${esc(email)}" style="color:#34d399;">${esc(email)}</a></td>
                </tr>
                <tr>
                  <td style="font-size:11px;color:#6aaf9e;padding:7px 0;border-bottom:1px solid #163d37;text-transform:uppercase;letter-spacing:0.06em;">Organisation</td>
                  <td style="font-size:13px;color:#edfdf8;padding:7px 0;border-bottom:1px solid #163d37;font-weight:600;">${esc(organisation)}</td>
                </tr>
                <tr>
                  <td style="font-size:11px;color:#6aaf9e;padding:7px 0;border-bottom:1px solid #163d37;text-transform:uppercase;letter-spacing:0.06em;">Type</td>
                  <td style="font-size:13px;color:#edfdf8;padding:7px 0;border-bottom:1px solid #163d37;">${esc(orgTypeLabel)}</td>
                </tr>
                <tr>
                  <td style="font-size:11px;color:#6aaf9e;padding:7px 0;border-bottom:1px solid #163d37;text-transform:uppercase;letter-spacing:0.06em;">Stores</td>
                  <td style="font-size:13px;color:#edfdf8;padding:7px 0;border-bottom:1px solid #163d37;">${esc(stores) || '—'}</td>
                </tr>
                <tr>
                  <td style="font-size:11px;color:#6aaf9e;padding:7px 0;text-transform:uppercase;letter-spacing:0.06em;vertical-align:top;padding-top:10px;">Message</td>
                  <td style="font-size:13px;color:#edfdf8;padding:7px 0;padding-top:10px;line-height:1.6;">${esc(message) || '—'}</td>
                </tr>
              </table>
            </div>

            <a href="mailto:${esc(email)}?subject=Re: Your Batch'd demo request&body=Hi ${encodeURIComponent(firstName || '')},%0A%0AThanks for your interest in Batch'd..."
               style="display:inline-block;background:#34d399;color:#080f12;font-weight:700;font-size:13px;padding:12px 24px;border-radius:8px;text-decoration:none;margin-bottom:20px;">
              Reply to ${esc(firstName)} →
            </a>

            <div style="font-size:11px;color:#6aaf9e;line-height:1.6;">
              Received: ${esc(now)}
            </div>
            <div style="border-top:1px solid #163d37;margin-top:20px;padding-top:14px;font-size:10px;color:#6aaf9e;">
              © 2026 Batch'd · <a href="https://batchdapp.com" style="color:#34d399;">batchdapp.com</a>
            </div>
          </div>
        `,
      }),
    });

    // Send confirmation to submitter
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: "Batch'd <invite@batchdapp.com>",
        to: [email],
        subject: `We received your Batch'd demo request`,
        html: `
          <div style="font-family:monospace;background:#080f12;color:#edfdf8;padding:40px;max-width:520px;margin:0 auto;border-radius:12px;">
            <div style="font-size:24px;font-weight:800;color:#34d399;margin-bottom:8px;">Batch'd</div>
            <div style="font-size:14px;color:#6aaf9e;margin-bottom:28px;">Food traceability platform</div>
            <div style="font-size:16px;font-weight:600;margin-bottom:12px;">Thanks, ${esc(firstName)}.</div>
            <p style="font-size:13px;color:#6aaf9e;line-height:1.7;margin-bottom:24px;">
              We've received your request for a Batch'd demo for
              <strong style="color:#edfdf8;">${esc(organisation)}</strong>.<br><br>
              We'll be in touch within one business day to arrange a walkthrough of the platform.
            </p>
            <div style="background:#0d1e1c;border:1px solid #163d37;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
              <div style="font-size:11px;color:#6aaf9e;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">What to expect</div>
              <div style="font-size:12px;color:#6aaf9e;line-height:2;">
                ✓ &nbsp;A live walkthrough of the full recall management workflow<br>
                ✓ &nbsp;Review of your specific compliance requirements<br>
                ✓ &nbsp;Discussion of integration with your existing systems<br>
                ✓ &nbsp;Pricing and onboarding timeline
              </div>
            </div>
            <p style="font-size:11px;color:#6aaf9e;line-height:1.6;">
              In the meantime, you can learn more at <a href="https://batchdapp.com" style="color:#34d399;">batchdapp.com</a>.
            </p>
            <div style="border-top:1px solid #163d37;margin-top:24px;padding-top:16px;font-size:10px;color:#6aaf9e;">
              © 2026 Batch'd · <a href="https://batchdapp.com" style="color:#34d399;">batchdapp.com</a>
            </div>
          </div>
        `,
      }),
    });

    if (!notifyRes.ok) {
      const errText = await notifyRes.text();
      console.error('[send-invite] notify Resend error:', notifyRes.status, errText);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to submit demo request' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('[send-invite] handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to submit demo request' }) };
  }
}
