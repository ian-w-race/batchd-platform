exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { to, orgName, inviterEmail, role, inviteUrl } = JSON.parse(event.body);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer re_hfJMphfo_4jQcxm42VWsQ83X9JbyaRpRB',
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
};
