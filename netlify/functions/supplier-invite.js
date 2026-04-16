// netlify/functions/supplier-invite.js
// Called by the manufacturer portal "Invite Supplier by Email" flow.
//
// What it does:
//   1. Creates a supplier_connections row (status='pending', supplier_id=null)
//      with the supplier's email stored so it can be matched when they sign up
//   2. Sends a branded invite email via Resend
//   3. Returns the invite URL
//
// POST body:
// {
//   manufacturer_id:   string,
//   manufacturer_name: string,
//   supplier_email:    string,
//   invited_by:        string|null,   // contact name at manufacturer
// }

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL     = process.env.SUPABASE_URL     || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY   = process.env.RESEND_API_KEY;
const FROM_ADDRESS     = "Batch'd <invites@batchdapp.com>";
const SUPPLIER_PORTAL  = 'https://supplier.batchdapp.com';

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
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'manufacturer_id and supplier_email are required' }) };
  }

  // Use service role to bypass RLS for the insert (anon key can't insert without a supplier_id)
  // Fall back to anon key if service role not set
  const sb = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE || process.env.SUPABASE_ANON_KEY,
  );

  // Check for duplicate pending invite
  const { data: existing } = await sb.from('supplier_connections')
    .select('id, status')
    .eq('manufacturer_id', manufacturer_id)
    .eq('supplier_email', supplier_email)
    .maybeSingle();

  if (existing) {
    // Already invited — return the portal URL without creating a duplicate
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ invite_url: SUPPLIER_PORTAL, already_exists: true }),
    };
  }

  // Create the pending connection row
  const { data: conn, error: connErr } = await sb.from('supplier_connections').insert({
    manufacturer_id,
    supplier_id:       null,       // filled in when supplier accepts
    supplier_email:    supplier_email.toLowerCase().trim(),
    invited_by_name:   invited_by || null,
    status:            'pending',
  }).select('id').single();

  if (connErr) {
    console.error('supplier-invite: insert error:', connErr);
    return { statusCode: 500, headers, body: JSON.stringify({ error: connErr.message }) };
  }

  // Send the invite email
  if (RESEND_API_KEY) {
    const mfrName = manufacturer_name || 'A manufacturer';
    const emailText = `Hi${invited_by ? ' ' + invited_by.split(' ')[0] : ''},

${mfrName} has invited you to connect on Batch'd — the food traceability and recall management platform.

As a connected supplier, you'll be able to:
• Log your ingredient lot codes directly to ${mfrName}'s traceability records
• Record ingredient shipments so they have one-step-back traceability for FSMA 204 and EU 178/2002
• Respond to quality investigation requests from ${mfrName}

To get started:
1. Visit the Batch'd Supplier Portal: ${SUPPLIER_PORTAL}
2. Create a free supplier account using this email address (${supplier_email})
3. Your connection to ${mfrName} will be confirmed automatically

If you already have a Batch'd supplier account, just log in and the connection will appear under Manufacturer Links.

If you have any questions, reply to this email.

---
Batch'd · food traceability made simple · batchd.no`;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from:    FROM_ADDRESS,
          to:      supplier_email,
          subject: `${mfrName} has invited you to connect on Batch'd`,
          text:    emailText,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        console.error('supplier-invite: Resend error:', err);
      }
    } catch (e) {
      console.error('supplier-invite: email send failed:', e.message);
      // Don't fail the whole request if email fails — connection row is already created
    }
  } else {
    console.warn('supplier-invite: RESEND_API_KEY not set, skipping email');
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ invite_url: SUPPLIER_PORTAL }),
  };
};
