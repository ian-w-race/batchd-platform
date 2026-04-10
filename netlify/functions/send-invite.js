exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const body = JSON.parse(event.body);

  // ── Route by type ──────────────────────────────────────────
  if (body.type === 'demo_request') {
    return handleDemoRequest(body);
  } else {
    return handleStaffInvite(body);
  }
};

// ── Staff invitation email ─────────────────────────────────
async function handleStaffInvite({ to, orgName, inviterEmail, role, inviteUrl }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY || 're_hfJMphfo_4jQcxm42VWsQ83X9JbyaRpRB'}`,
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
            <strong style="color:#edfdf8;">${inviterEmail}</strong> has invited you to join 
            <strong style="color:#edfdf8;">${orgName}</strong> on Batch'd as a 
            <strong style="color:#edfdf8;">${role}</strong>.
          </p>
          <a href="${inviteUrl}" style="display:inline-block;background:#34d399;color:#080f12;font-weight:700;font-size:14px;padding:14px 28px;border-radius:8px;text-decoration:none;margin-bottom:24px;">
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
    const err = await res.text();
    return { statusCode: 500, body: JSON.stringify({ error: err }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}

// ── Demo request notification email ───────────────────────
async function handleDemoRequest({ firstName, lastName, email, organisation, orgType, stores, message }) {
  const orgTypeLabels = {
    retailer:     'Grocery retailer / chain',
    manufacturer: 'Food manufacturer / brand',
    distributor:  'Distributor / wholesaler',
    other:        'Other',
  };
  const orgTypeLabel = orgTypeLabels[orgType] || orgType || '—';
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Oslo', dateStyle: 'full', timeStyle: 'short' });

  // Send notification to you (the Batch'd admin)
  const notifyRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY || 're_hfJMphfo_4jQcxm42VWsQ83X9JbyaRpRB'}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: "Batch'd <invite@batchdapp.com>",
      to: ['ian.w.race@gmail.com'],
      subject: `New demo request — ${firstName} ${lastName} from ${organisation}`,
      html: `
        <div style="font-family:monospace;background:#080f12;color:#edfdf8;padding:40px;max-width:560px;margin:0 auto;border-radius:12px;">
          <div style="font-size:22px;font-weight:800;color:#34d399;margin-bottom:4px;">Batch'd</div>
          <div style="font-size:12px;color:#6aaf9e;margin-bottom:28px;letter-spacing:0.08em;text-transform:uppercase;">New demo request</div>

          <div style="background:#0d1e1c;border:1px solid #163d37;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="font-size:11px;color:#6aaf9e;padding:7px 0;border-bottom:1px solid #163d37;width:140px;text-transform:uppercase;letter-spacing:0.06em;">Name</td>
                <td style="font-size:13px;color:#edfdf8;padding:7px 0;border-bottom:1px solid #163d37;font-weight:600;">${firstName} ${lastName}</td>
              </tr>
              <tr>
                <td style="font-size:11px;color:#6aaf9e;padding:7px 0;border-bottom:1px solid #163d37;text-transform:uppercase;letter-spacing:0.06em;">Email</td>
                <td style="font-size:13px;padding:7px 0;border-bottom:1px solid #163d37;"><a href="mailto:${email}" style="color:#34d399;">${email}</a></td>
              </tr>
              <tr>
                <td style="font-size:11px;color:#6aaf9e;padding:7px 0;border-bottom:1px solid #163d37;text-transform:uppercase;letter-spacing:0.06em;">Organisation</td>
                <td style="font-size:13px;color:#edfdf8;padding:7px 0;border-bottom:1px solid #163d37;font-weight:600;">${organisation}</td>
              </tr>
              <tr>
                <td style="font-size:11px;color:#6aaf9e;padding:7px 0;border-bottom:1px solid #163d37;text-transform:uppercase;letter-spacing:0.06em;">Type</td>
                <td style="font-size:13px;color:#edfdf8;padding:7px 0;border-bottom:1px solid #163d37;">${orgTypeLabel}</td>
              </tr>
              <tr>
                <td style="font-size:11px;color:#6aaf9e;padding:7px 0;border-bottom:1px solid #163d37;text-transform:uppercase;letter-spacing:0.06em;">Stores</td>
                <td style="font-size:13px;color:#edfdf8;padding:7px 0;border-bottom:1px solid #163d37;">${stores || '—'}</td>
              </tr>
              <tr>
                <td style="font-size:11px;color:#6aaf9e;padding:7px 0;text-transform:uppercase;letter-spacing:0.06em;vertical-align:top;padding-top:10px;">Message</td>
                <td style="font-size:13px;color:#edfdf8;padding:7px 0;padding-top:10px;line-height:1.6;">${message || '—'}</td>
              </tr>
            </table>
          </div>

          <a href="mailto:${email}?subject=Re: Your Batch'd demo request&body=Hi ${firstName},%0A%0AThanks for your interest in Batch'd..." 
             style="display:inline-block;background:#34d399;color:#080f12;font-weight:700;font-size:13px;padding:12px 24px;border-radius:8px;text-decoration:none;margin-bottom:20px;">
            Reply to ${firstName} →
          </a>

          <div style="font-size:11px;color:#6aaf9e;line-height:1.6;">
            Received: ${now}
          </div>
          <div style="border-top:1px solid #163d37;margin-top:20px;padding-top:14px;font-size:10px;color:#6aaf9e;">
            © 2026 Batch'd · <a href="https://batchdapp.com" style="color:#34d399;">batchdapp.com</a>
          </div>
        </div>
      `,
    }),
  });

  // Also send a confirmation to the person who submitted
  const confirmRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY || 're_hfJMphfo_4jQcxm42VWsQ83X9JbyaRpRB'}`,
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
          <div style="font-size:16px;font-weight:600;margin-bottom:12px;">Thanks, ${firstName}.</div>
          <p style="font-size:13px;color:#6aaf9e;line-height:1.7;margin-bottom:24px;">
            We've received your request for a Batch'd demo for 
            <strong style="color:#edfdf8;">${organisation}</strong>.<br><br>
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
    const err = await notifyRes.text();
    return { statusCode: 500, body: JSON.stringify({ error: err }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}
