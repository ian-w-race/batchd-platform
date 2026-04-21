// ================================================================
// notify-consumers.js — Batch'd Netlify serverless function
// Sends recall notification emails to a list of customers.
// Called from the dashboard Consumer Notification flow (Step 3).
//
// Expects POST body:
//   recall_event_id  — the recall being notified about
//   org_id           — retailer org ID
//   org_name         — retailer display name
//   customers        — array of { email, name?, _product, _lot, _reason }
//   product_name     — recalled product name
//   lot_number       — recalled lot (may be null for broad recalls)
//   reason           — recall reason summary
// ================================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_hfJMphfo_4jQcxm42VWsQ83X9JbyaRpRB';
const FROM_EMAIL     = 'no-reply@batchdapp.com';
const FROM_NAME      = "Important product notice";

// Max batch size per Resend call — stay under their 100/call limit
const BATCH_SIZE = 50;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { recall_event_id, org_id, org_name, customers, product_name, lot_number, reason } = body;

  if (!customers || !Array.isArray(customers) || customers.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'customers array required' }) };
  }

  if (!product_name) {
    return { statusCode: 400, body: JSON.stringify({ error: 'product_name required' }) };
  }

  // Deduplicate by email
  const seen = new Set();
  const uniqueCustomers = customers.filter(c => {
    if (!c.email || seen.has(c.email.toLowerCase())) return false;
    seen.add(c.email.toLowerCase());
    return true;
  });

  if (uniqueCustomers.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, skipped: 'no valid emails' }) };
  }

  const subject    = `Important: Product recall notice — ${product_name}`;
  const today      = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const senderName = org_name || "Your retailer";

  let sent   = 0;
  let failed = 0;
  const errors = [];

  // Send in batches
  for (let i = 0; i < uniqueCustomers.length; i += BATCH_SIZE) {
    const batch = uniqueCustomers.slice(i, i + BATCH_SIZE);

    // Build individual sends (personalised greeting, same body)
    const sends = batch.map(customer => ({
      from:    `${FROM_NAME} <${FROM_EMAIL}>`,
      to:      [customer.email],
      subject,
      html:    buildNoticeHtml({
        customerName: customer.name || null,
        orgName:      senderName,
        productName:  product_name,
        lotNumber:    lot_number,
        reason:       reason,
        today,
      }),
    }));

    try {
      // Resend supports batch sends via /emails/batch
      const res = await fetch('https://api.resend.com/emails/batch', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify(sends),
      });

      const data = await res.json();

      if (res.ok && Array.isArray(data)) {
        // data is array of { id } for each sent email
        sent += data.length;
      } else if (res.ok && data.data) {
        sent += data.data.length;
      } else {
        // Batch endpoint not available — fall back to individual sends
        console.warn('[notify-consumers] Batch send failed, falling back to individual:', data);
        for (const send of sends) {
          try {
            const r = await fetch('https://api.resend.com/emails', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
              body:    JSON.stringify(send),
            });
            if (r.ok) sent++;
            else { failed++; const d = await r.json(); errors.push(d.message || 'send error'); }
          } catch(e) { failed++; errors.push(e.message); }
        }
      }
    } catch(e) {
      console.error('[notify-consumers] Batch error:', e.message);
      failed += batch.length;
      errors.push(e.message);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      sent,
      failed,
      total:   uniqueCustomers.length,
      errors:  errors.length > 0 ? errors.slice(0, 5) : undefined,
    }),
  };
};

// ── Email HTML builder ────────────────────────────────────────────
function buildNoticeHtml({ customerName, orgName, productName, lotNumber, reason, today }) {
  const greeting = customerName ? `Dear ${customerName},` : 'Dear Customer,';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Product recall notice</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr><td style="background:#b91c1c;padding:22px 32px;">
        <div style="font-size:13px;font-weight:700;color:#fff;letter-spacing:0.05em;text-transform:uppercase;">⚠ Important product recall notice</div>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:32px;">

        <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">${greeting}</p>

        <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
          We are contacting you because you may have purchased a product that has been recalled.
          For your safety, please stop using this product immediately.
        </p>

        <!-- Product details box -->
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px 20px;margin:20px 0;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#b91c1c;font-weight:700;margin-bottom:10px;">Recalled product</div>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size:11px;color:#666;padding:3px 0;width:120px;">Product name</td>
              <td style="font-size:13px;font-weight:700;color:#111;padding:3px 0;">${productName}</td>
            </tr>
            ${lotNumber ? `<tr>
              <td style="font-size:11px;color:#666;padding:3px 0;">Lot number</td>
              <td style="font-size:13px;font-family:monospace;color:#111;padding:3px 0;">${lotNumber}</td>
            </tr>` : ''}
            ${reason ? `<tr>
              <td style="font-size:11px;color:#666;padding:3px 0;vertical-align:top;">Reason</td>
              <td style="font-size:12px;color:#333;padding:3px 0;line-height:1.5;">${reason}</td>
            </tr>` : ''}
          </table>
        </div>

        <!-- What to do -->
        <div style="margin:20px 0 16px;font-size:13px;font-weight:700;color:#111;text-transform:uppercase;letter-spacing:0.04em;">What you should do</div>
        ${['Stop using this product immediately — do not consume it.',
           'Return the product to any of our stores for a <strong>full refund</strong>.',
           'If you have already consumed the product and have health concerns, contact a healthcare professional.',
           'Keep the packaging if possible — the lot number is printed on the label.']
          .map((s, i) => `<div style="display:flex;align-items:flex-start;margin-bottom:10px;">
            <div style="width:22px;height:22px;border-radius:50%;background:#b91c1c;color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:10px;">${i+1}</div>
            <div style="font-size:13px;color:#333;line-height:1.5;padding-top:2px;">${s}</div>
          </div>`).join('')}

        <p style="margin:20px 0 8px;font-size:13px;color:#333;line-height:1.6;">
          We sincerely apologise for any inconvenience this may cause. The safety and wellbeing of our customers is our highest priority.
        </p>

        <p style="margin:8px 0 24px;font-size:13px;color:#333;line-height:1.6;">
          If you have any questions, please contact us at ${orgName}.
        </p>

      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f8f8f8;padding:20px 32px;border-top:1px solid #eee;">
        <div style="font-size:11px;color:#888;text-align:center;line-height:1.6;">
          This notice was issued by <strong>${orgName}</strong> on ${today}.<br>
          Recall management powered by <a href="https://batchd.no" style="color:#34d399;text-decoration:none;">Batch'd</a>.
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}
