// netlify/functions/push-recall-email.js
// Sends recall alert emails to retailer org admins when a manufacturer pushes a recall.
// Called by the manufacturer portal after a successful push_recall() RPC call.
//
// Expected POST body:
// {
//   recall_event_id: string,     -- the recall_event.id just created
//   product_name:   string,
//   lot_number:     string|null,
//   severity:       string|null,  -- e.g. "class_i", "class_ii"
//   reason:         string|null,
//   description:    string|null,
//   is_drill:       boolean,
//   manufacturer_name: string,
//   retailer_emails: string[],   -- list of corp_admin emails to notify
// }

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS   = 'Batch\'d Recalls <recalls@batchdapp.com>';
const DASHBOARD_URL  = 'https://corporate.batchdapp.com/dashboard.html';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!RESEND_API_KEY) {
    console.error('push-recall-email: RESEND_API_KEY not set');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Email service not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const {
    recall_event_id,
    product_name,
    lot_number,
    severity,
    reason,
    description,
    is_drill,
    manufacturer_name,
    retailer_emails,
  } = body;

  // Validate required fields
  if (!product_name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'product_name is required' }) };
  }
  if (!Array.isArray(retailer_emails) || retailer_emails.length === 0) {
    // No recipients — not an error, just nothing to do
    return { statusCode: 200, headers, body: JSON.stringify({ sent: 0, message: 'No recipient emails provided' }) };
  }

  // Filter out any obviously invalid emails
  const validEmails = retailer_emails.filter(e => typeof e === 'string' && e.includes('@'));
  if (validEmails.length === 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ sent: 0, message: 'No valid emails after filtering' }) };
  }

  // Format severity for display
  const severityLabel = (() => {
    if (!severity) return null;
    const s = severity.toLowerCase();
    if (s.includes('i') && !s.includes('ii') && !s.includes('iii')) return 'Class I (High Risk)';
    if (s.includes('ii') && !s.includes('iii')) return 'Class II (Moderate Risk)';
    if (s.includes('iii')) return 'Class III (Low Risk)';
    if (s === 'critical') return 'Critical';
    if (s === 'serious') return 'Serious';
    return severity;
  })();

  const drillBanner = is_drill
    ? '\n\n*** THIS IS A MOCK RECALL DRILL — NO ACTION REQUIRED ON REAL PRODUCT ***\n'
    : '';

  const urgencyLine = !is_drill && (severity?.toLowerCase().includes('i') || severity?.toLowerCase().includes('critical'))
    ? '\nThis is a Class I recall. Affected product should be pulled from shelves within 2 hours of receipt of this notice.\n'
    : '';

  const subject = is_drill
    ? `[MOCK DRILL] Recall drill: ${product_name}`
    : `Recall notice: ${product_name}${lot_number ? ' — Lot ' + lot_number : ''}`;

  const emailText = `${is_drill ? '[MOCK RECALL DRILL]\n' : ''}You are receiving this notice because your organisation is a connected trading partner of ${manufacturer_name || 'a manufacturer'} on the Batch'd network.
${drillBanner}${urgencyLine}
RECALL NOTICE
=============
Product:      ${product_name}
Lot number:   ${lot_number || 'See below or contact manufacturer'}
${severityLabel ? 'Severity:     ' + severityLabel + '\n' : ''}Reason:       ${reason || 'See Batch\'d dashboard for details'}
From:         ${manufacturer_name || 'Unknown manufacturer'}
${description ? '\nAdditional details:\n' + description + '\n' : ''}
WHAT TO DO
==========
1. Log in to your Batch'd dashboard to review the full recall details
2. Check which of your stores received the affected lot code
3. Acknowledge receipt and begin your 5-step response chain
4. Confirm removal once product has been pulled from shelves

Dashboard: ${DASHBOARD_URL}
${recall_event_id ? '\nRecall reference: ' + recall_event_id : ''}

---
This is an automated notification from the Batch'd food traceability platform.
Notification to regulatory authorities remains the responsibility of your organisation.
Do not reply to this email.`;

  // Send to all valid recipients
  let sent = 0;
  const errors = [];

  for (const email of validEmails) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from:    FROM_ADDRESS,
          to:      email,
          subject,
          text:    emailText,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error(`push-recall-email: Resend error for ${email}:`, data);
        errors.push({ email, error: data?.message || `HTTP ${res.status}` });
      } else {
        sent++;
      }
    } catch (e) {
      console.error(`push-recall-email: Exception sending to ${email}:`, e.message);
      errors.push({ email, error: e.message });
    }
  }

  console.log(`push-recall-email: sent=${sent}, failed=${errors.length}, recall=${recall_event_id}`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      sent,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    }),
  };
};
