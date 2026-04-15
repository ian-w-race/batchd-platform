// netlify/functions/supplier-invite.js
// Sends an email invitation to a supplier to join Batch'd.
// Creates a pending supplier_connection record and sends the invite link.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY || 're_hfJMphfo_4jQcxm42VWsQ83X9JbyaRpRB';
const BASE_URL = 'https://batchd-app.netlify.app';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { manufacturer_id, manufacturer_name, supplier_email, invited_by } = body;

  if (!manufacturer_id || !supplier_email) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'manufacturer_id and supplier_email are required' }) };
  }

  if (!SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  try {
    // Create a pending supplier_connection with invite metadata
    // The connection ID becomes the invite token
    const connRes = await sbPost('/rest/v1/supplier_connections', {
      manufacturer_id,
      supplier_id: manufacturer_id, // placeholder — overwritten on acceptance
      status: 'invited',
      invite_email: supplier_email,
      invite_sent_at: new Date().toISOString(),
    });

    if (!connRes.ok) {
      const err = await connRes.text();
      console.error('[supplier-invite] DB error:', err);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Could not create invite record' }) };
    }

    const [conn] = await connRes.json();
    const inviteToken = conn.id;
    const inviteUrl = `${BASE_URL}/supplier.html?invite=${inviteToken}`;

    // Send email via Resend
    const emailBody = {
      from: 'Batch\'d <noreply@batchdapp.com>',
      to: [supplier_email],
      subject: `${manufacturer_name || 'A food manufacturer'} has invited you to connect on Batch'd`,
      html: buildEmailHtml({ manufacturer_name, invited_by, inviteUrl, supplier_email }),
      text: buildEmailText({ manufacturer_name, invited_by, inviteUrl }),
    };

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailBody),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      console.error('[supplier-invite] Email error:', err);
      // Don't fail — the connection record was created, they can still use the URL
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, invite_token: inviteToken, invite_url: inviteUrl }),
    };

  } catch (e) {
    console.error('[supplier-invite] Error:', e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};

function buildEmailHtml({ manufacturer_name, invited_by, inviteUrl, supplier_email }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #080f12; color: #edfdf8; margin: 0; padding: 40px 20px; }
  .card { background: #0d1e1c; border: 1px solid #163d37; border-radius: 16px; max-width: 520px; margin: 0 auto; padding: 36px; }
  .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
  .logo-icon { width: 36px; height: 36px; background: #34d399; border-radius: 9px; display: flex; align-items: center; justify-content: center; }
  .logo-text { font-size: 20px; font-weight: 800; color: #34d399; }
  h2 { font-size: 20px; color: #edfdf8; margin: 0 0 12px; }
  p { color: #6aaf9e; font-size: 14px; line-height: 1.7; margin: 0 0 16px; }
  .highlight { color: #edfdf8; font-weight: 600; }
  .btn { display: inline-block; background: #34d399; color: #065f46; font-weight: 700; font-size: 15px; padding: 14px 28px; border-radius: 10px; text-decoration: none; margin: 8px 0 20px; }
  .info-box { background: #13302b; border: 1px solid #163d37; border-radius: 10px; padding: 14px 16px; margin: 16px 0; }
  .info-row { display: flex; gap: 8px; margin-bottom: 8px; font-size: 13px; color: #6aaf9e; }
  .info-row:last-child { margin-bottom: 0; }
  .info-label { color: #edfdf8; font-weight: 600; min-width: 120px; }
  .url { font-size: 11px; color: #6aaf9e; word-break: break-all; margin-top: 16px; padding-top: 16px; border-top: 1px solid #163d37; }
  .footer { font-size: 11px; color: #6aaf9e; margin-top: 24px; padding-top: 16px; border-top: 1px solid #163d37; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#065f46" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>
    <div class="logo-text">Batch'd</div>
  </div>

  <h2>You've been invited to connect as a supplier</h2>
  <p><span class="highlight">${manufacturer_name || 'A food manufacturer'}</span> is inviting you to join their ingredient traceability network on Batch'd.</p>

  <div class="info-box">
    <div class="info-row"><span class="info-label">From</span><span>${manufacturer_name || '—'}</span></div>
    ${invited_by ? `<div class="info-row"><span class="info-label">Invited by</span><span>${invited_by}</span></div>` : ''}
    <div class="info-row"><span class="info-label">Your email</span><span>${supplier_email}</span></div>
  </div>

  <p>Once connected, you can log ingredient shipments directly — creating the one-step-back traceability record required by EU 178/2002 Art. 18 and FDA FSMA 204. It takes about 2 minutes to set up.</p>

  <a href="${inviteUrl}" class="btn">Accept invitation →</a>

  <p style="font-size:13px;">Click the button above to create your free supplier account and accept this connection. The invitation expires in 30 days.</p>

  <div class="url">Or copy this link: ${inviteUrl}</div>

  <div class="footer">
    Batch'd is a food traceability platform. You received this email because ${manufacturer_name || 'a manufacturer'} entered your email address.
    If you did not expect this invitation, you can safely ignore this email.
  </div>
</div>
</body>
</html>`;
}

function buildEmailText({ manufacturer_name, invited_by, inviteUrl }) {
  return `You have been invited to join Batch'd as a supplier.

${manufacturer_name || 'A food manufacturer'} is inviting you to connect to their ingredient traceability network.

${invited_by ? `Invited by: ${invited_by}\n` : ''}
What this means: Once connected, you can log ingredient shipments to create the verified traceability records required by EU 178/2002 and FDA FSMA 204.

Accept your invitation here:
${inviteUrl}

The invitation expires in 30 days.

---
Batch'd Food Traceability · batchdapp.com
If you did not expect this email, you can safely ignore it.`;
}

async function sbPost(path, data) {
  return fetch(SUPABASE_URL + path, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
}
