// netlify/functions/supplier-invite.js
// Creates a pending supplier_connections row and sends an invite email.
// Uses fetch (no external dependencies) to match the rest of the functions.

const SUPABASE_URL    = 'https://lurxucdmrugikdlvvebc.supabase.co';
const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const FROM_ADDRESS    = "Batch'd <invites@batchdapp.com>";
const SUPPLIER_PORTAL = 'https://supplier.batchdapp.com';

const supabase = async (path, options = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        options.prefer || '',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch(e) { data = text; }
  return { ok: res.ok, status: res.status, data };
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { manufacturer_id, manufacturer_name, supplier_email, invited_by } = body;

  if (!manufacturer_id || !supplier_email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'manufacturer_id and supplier_email required' }) };
  }

  const email = supplier_email.toLowerCase().trim();

  // Check for duplicate
  const existing = await supabase(
    `supplier_connections?manufacturer_id=eq.${manufacturer_id}&supplier_email=eq.${encodeURIComponent(email)}&select=id,status`
  );
  if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ invite_url: SUPPLIER_PORTAL, already_exists: true }) };
  }

  // Insert pending connection
  const insert = await supabase('supplier_connections', {
    method: 'POST',
    prefer: 'return=representation',
    body: JSON.stringify({
      manufacturer_id,
      supplier_id:     null,
      supplier_email:  email,
      invited_by_name: invited_by || null,
      status:          'pending',
    }),
  });

  if (!insert.ok) {
    console.error('supplier-invite: insert error:', insert.data);
    return { statusCode: 500, headers, body: JSON.stringify({ error: insert.data?.message || 'DB insert failed' }) };
  }

  // Send invite email
  if (RESEND_API_KEY) {
    const mfrName = manufacturer_name || 'A manufacturer';
    const emailBody = `Hi${invited_by ? ' ' + invited_by.split(' ')[0] : ''},

${mfrName} has invited you to connect on Batch'd — a food traceability and recall management platform.

As a connected supplier, you'll be able to:
- Log your ingredient lot codes directly to ${mfrName}'s traceability records
- Record ingredient shipments for FSMA 204 and EU 178/2002 compliance
- Respond to quality investigation requests

To get started:
1. Go to: ${SUPPLIER_PORTAL}
2. Create a free account using this email address (${email})
3. Your connection to ${mfrName} will be confirmed automatically on login

If you already have a Batch'd supplier account, just log in — the connection will appear under Manufacturer Links.

---
Batch'd · food traceability · batchd.no`;

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from:    FROM_ADDRESS,
          to:      email,
          subject: `${mfrName} has invited you to connect on Batch'd`,
          text:    emailBody,
        }),
      });
    } catch(e) {
      console.error('supplier-invite: email failed:', e.message);
      // Don't fail — connection row already created
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ invite_url: SUPPLIER_PORTAL }) };
};
