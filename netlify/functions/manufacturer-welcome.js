// netlify/functions/manufacturer-welcome.js
// Sends a branded welcome email to new manufacturer sign-ups via Resend

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM       = 'Batch\'d <invite@batchdapp.com>';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { email, orgName, firstName, apiKey, portalUrl } = body;

  if (!email || !orgName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing email or orgName' }) };
  }

  const name    = firstName || email.split('@')[0];
  const portal  = portalUrl || 'https://app.batchdapp.com/manufacturer.html';
  const docs    = 'https://docs.batchdapp.com';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr><td style="background:#040c0e;padding:28px 36px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="font-weight:800;font-size:20px;color:#34d399;letter-spacing:-0.02em;">Batch'd</div>
        <div style="font-size:11px;color:#6aaf9e;margin-top:2px;letter-spacing:0.08em;text-transform:uppercase;">Manufacturer Portal</div>
      </td>
      <td align="right" style="font-size:11px;color:#6aaf9e;letter-spacing:0.08em;text-transform:uppercase;">Welcome</td>
    </tr></table>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:32px 36px 24px;">
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#111;line-height:1.2;">
      Welcome to Batch'd, ${name}
    </h1>
    <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.7;">
      <strong>${orgName}</strong> is now connected to the Batch'd recall management network.
      Your manufacturer portal is ready — you can start logging products, registering lot codes,
      connecting to retail partners, and pushing recall events immediately.
    </p>

    <!-- Quick start steps -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      ${[
        ['1', 'Add your products', 'Register the products you manufacture — names, barcodes, and lot code formats.'],
        ['2', 'Connect retail partners', 'Search for your retail customers and send connection requests. Once accepted, you can push recalls directly to them.'],
        ['3', 'Log shipments', 'Record which lot codes shipped to which retailers. This creates the traceability chain required by FSMA 204 and EU 178/2002.'],
        ['4', 'Run a mock drill', 'Simulate a recall to test your retailer network\'s response before a real event.'],
      ].map(([n, title, desc]) => `
      <tr><td style="padding:8px 0;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="width:32px;height:32px;background:#ecfdf5;border-radius:50%;text-align:center;vertical-align:middle;font-size:12px;font-weight:700;color:#059669;flex-shrink:0;">${n}</td>
          <td style="padding-left:12px;">
            <div style="font-size:13px;font-weight:600;color:#111;margin-bottom:2px;">${title}</div>
            <div style="font-size:12px;color:#6b7280;">${desc}</div>
          </td>
        </tr></table>
      </td></tr>`).join('')}
    </table>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:28px;">
      <a href="${portal}"
        style="background:#34d399;color:#065f46;font-weight:700;font-size:14px;padding:13px 32px;border-radius:8px;text-decoration:none;display:inline-block;box-shadow:0 4px 16px rgba(52,211,153,0.3);">
        Open manufacturer portal →
      </a>
    </div>

    ${apiKey ? `
    <!-- API key -->
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">Your ERP API key</div>
      <div style="font-family:'Courier New',monospace;font-size:12px;color:#111;background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;word-break:break-all;">${apiKey}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:8px;line-height:1.6;">
        Use this key to push recall events directly from your ERP system via the Batch'd webhook API.
        Send it in the <strong>X-Batchd-Api-Key</strong> header. Keep it confidential.
      </div>
    </div>` : ''}

    <!-- Support note -->
    <p style="font-size:12px;color:#6b7280;line-height:1.6;margin:0;">
      Questions? Reply to this email or visit <a href="https://batchd.no" style="color:#34d399;text-decoration:none;">batchd.no</a>.
      We're here to make your first recall — real or drill — as fast and defensible as possible.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 36px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9ca3af;">
      Batch'd · <a href="https://batchd.no" style="color:#34d399;text-decoration:none;">batchd.no</a> ·
      Food traceability and recall management
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  const text = `Welcome to Batch'd, ${name}\n\n${orgName} is now connected to the Batch'd recall management network.\n\nOpen your manufacturer portal: ${portal}\n${apiKey ? '\nYour ERP API key: ' + apiKey + '\n' : ''}\nBatch'd · batchd.no`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    FROM,
        to:      [email],
        subject: `Welcome to Batch'd — ${orgName} is connected`,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Email send failed', detail: err }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sent: true }),
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
