// netlify/functions/notify-consumers.js
// Sends recall notification emails to customers who may have purchased recalled products.
// Two modes:
//   matched  — purchase history was uploaded; only customers matching the recalled product/lot
//   broadcast — full customer list; all customers receive the notice
//
// Expected POST body:
// {
//   recall_event_id: string|null,
//   org_id:          string,
//   org_name:        string,
//   customers:       Array<{ email, name, mode: 'matched'|'broadcast' }>,
//   product_name:    string,
//   lot_number:      string|null,
//   reason:          string|null,
// }

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS   = 'Batch\'d Recalls <recalls@batchdapp.com>';
const BATCH_SIZE     = 50; // send in batches to avoid rate limits

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  if (!RESEND_API_KEY) {
    console.error('notify-consumers: RESEND_API_KEY not set');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Email service not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { org_name, customers, product_name, lot_number, reason } = body;

  if (!Array.isArray(customers) || customers.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No customers provided' }) };
  }
  if (!product_name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'product_name required' }) };
  }

  const validCustomers = customers.filter(c => c.email && c.email.includes('@'));
  if (validCustomers.length === 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ sent: 0, message: 'No valid emails' }) };
  }

  const subject = `Important: Product recall notice — ${product_name}`;

  let sent = 0;
  const errors = [];

  // Process in batches
  for (let i = 0; i < validCustomers.length; i += BATCH_SIZE) {
    const batch = validCustomers.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (customer) => {
      const greeting = customer.name ? `Dear ${customer.name.split(' ')[0]},` : 'Dear Customer,';
      const modeNote = customer.mode === 'broadcast'
        ? 'We are proactively notifying all our registered customers about this recall.'
        : 'Our records indicate you may have purchased this product recently.';

      const emailText = `${greeting}

We are writing with an important product safety notice from ${org_name || 'your retailer'}.

PRODUCT RECALL NOTICE
=====================
Product:    ${product_name}
${lot_number ? `Lot number: ${lot_number}\n` : ''}${reason ? `Reason:     ${reason}\n` : ''}

${modeNote}

WHAT TO DO
==========
If you have purchased this product, please:
1. Stop using or consuming the product immediately
2. Do not return the product to the shelf — set it aside
3. Return it to any of our stores for a full refund — no receipt needed
4. If you have consumed the product and have any health concerns, contact your healthcare provider

We sincerely apologise for any inconvenience this causes. Food safety is our highest priority and we are working to remove all affected products from our stores as quickly as possible.

If you have any questions, please contact ${org_name || 'us'} directly.

---
This is an official recall notification from ${org_name || 'your retailer'}, powered by Batch'd food traceability.
Do not reply to this email.`;

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from:    FROM_ADDRESS,
            to:      customer.email,
            subject,
            text:    emailText,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          console.error(`notify-consumers: Resend error for ${customer.email}:`, data);
          errors.push({ email: customer.email, error: data?.message || `HTTP ${res.status}` });
        } else {
          sent++;
        }
      } catch (e) {
        console.error(`notify-consumers: Exception for ${customer.email}:`, e.message);
        errors.push({ email: customer.email, error: e.message });
      }
    }));

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < validCustomers.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`notify-consumers: sent=${sent}, failed=${errors.length}, product="${product_name}"`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      sent,
      failed: errors.length,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    }),
  };
};
