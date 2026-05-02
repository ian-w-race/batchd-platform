// netlify/functions/supplier-invite.js
// Creates a pending supplier_connections row and sends an invite email.
// Uses fetch (no external dependencies) to match the rest of the functions.
//
// Security boundaries:
//  - Origin must come from a trusted Batch'd domain.
//  - manufacturer_id is validated against the organisations table.
//  - manufacturer_name is taken from the DB, not the request body (prevents impersonation).
//  - URL params are encodeURIComponent'd.
//  - Email format validated server-side (rejects header-injection chars).
//  - invited_by is sanitized before storage and interpolation.
//  - DB / Resend errors are logged server-side; clients get generic messages.

const SUPABASE_URL    = 'https://lurxucdmrugikdlvvebc.supabase.co';
const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const FROM_ADDRESS    = "Batch'd <invites@batchdapp.com>";
const SUPPLIER_PORTAL = 'https://supplier.batchdapp.com';

// ── Helpers ─────────────────────────────────────────────────
// Reject control chars, quotes, angle brackets, backslashes — common email-header-injection vectors.
const isValidEmail = (e) => /^[^\s@<>"'\\]+@[^\s@<>"'\\]+\.[^\s@<>"'\\]+$/.test(String(e || ''));

// Strip control chars and dangerous chars; keep printable text incl. apostrophes (O'Brien etc.).
const sanitizeName = (s, max) => String(s == null ? '' : s)
  .replace(/[\r\n\x00-\x1F\x7F<>"\\]/g, '')
  .trim()
  .slice(0, max || 100);

const ALLOWED_ORIGINS = [
  'https://app.batchdapp.com',
  'https://batchdapp.com',
  'https://www.batchdapp.com',
  'https://manufacturer.batchdapp.com',
];

const isAllowedOrigin = (o) => !!o && ALLOWED_ORIGINS.includes(o);

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
  // Reflect a trusted origin; default to app.batchdapp.com if origin not in allowlist
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const corsOrigin = isAllowedOrigin(origin) ? origin : 'https://app.batchdapp.com';

  const headers = {
    'Access-Control-Allow-Origin':  corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Origin allowlist check
  const referer = event.headers?.referer || event.headers?.Referer || '';
  let refererOrigin = '';
  try { if (referer) refererOrigin = new URL(referer).origin; } catch {}
  const clientIp = ((event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'] || '').split(',')[0] || '').trim() || 'unknown';

  if (!isAllowedOrigin(origin) && !isAllowedOrigin(refererOrigin)) {
    console.warn('[supplier-invite] rejected origin:', origin, '| referer:', referer, '| ip:', clientIp);
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // Verify Supabase config
  if (!SUPABASE_KEY) {
    console.error('[supplier-invite] SUPABASE_SERVICE_KEY env var not set');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { manufacturer_id, supplier_email, invited_by } = body;
  // NOTE: manufacturer_name from the request body is intentionally ignored — the authoritative
  // name is fetched from the organisations table to prevent impersonation in the invite email.

  if (!manufacturer_id || !supplier_email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'manufacturer_id and supplier_email required' }) };
  }

  // UUID-shape check before sending to Supabase
  if (!/^[0-9a-fA-F-]{36}$/.test(String(manufacturer_id))) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid manufacturer_id format' }) };
  }

  const email = String(supplier_email).toLowerCase().trim();
  if (!isValidEmail(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid supplier email' }) };
  }

  // Validate manufacturer exists — and pull authoritative name from DB
  const orgLookup = await supabase(
    `organisations?id=eq.${encodeURIComponent(manufacturer_id)}&select=id,name&limit=1`
  );
  if (!orgLookup.ok || !Array.isArray(orgLookup.data) || orgLookup.data.length === 0) {
    console.warn('[supplier-invite] rejected unknown manufacturer_id:', manufacturer_id, '| ip:', clientIp);
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid manufacturer reference' }) };
  }
  const mfrName = sanitizeName(orgLookup.data[0].name, 100) || 'A manufacturer';

  // Sanitize invited_by (used in DB row and email greeting)
  const inviterFullName = sanitizeName(invited_by, 100);
  const inviterFirstName = inviterFullName ? inviterFullName.split(/\s+/)[0].slice(0, 50) : '';

  // Check for duplicate
  const existing = await supabase(
    `supplier_connections?manufacturer_id=eq.${encodeURIComponent(manufacturer_id)}&supplier_email=eq.${encodeURIComponent(email)}&select=id,status`
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
      invited_by_name: inviterFullName || null,
      status:          'pending',
    }),
  });

  if (!insert.ok) {
    console.error('[supplier-invite] insert error:', insert.data);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not create invitation' }) };
  }

  // Send invite email (best-effort — connection row already exists)
  if (RESEND_API_KEY) {
    const greeting = inviterFirstName ? ` ${inviterFirstName}` : '';
    const emailBody = `Hi${greeting},

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
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from:    FROM_ADDRESS,
          to:      email,
          subject: `${mfrName} has invited you to connect on Batch'd`,
          text:    emailBody,
        }),
      });
      if (!emailRes.ok) {
        const errText = await emailRes.text();
        console.error('[supplier-invite] Resend error:', emailRes.status, errText);
        // Don't fail — connection row already created
      }
    } catch(e) {
      console.error('[supplier-invite] email failed:', e.message);
      // Don't fail — connection row already created
    }
  } else {
    console.warn('[supplier-invite] RESEND_API_KEY not set — skipping email');
  }

  return { statusCode: 200, headers, body: JSON.stringify({ invite_url: SUPPLIER_PORTAL }) };
};
