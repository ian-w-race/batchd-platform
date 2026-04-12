const SUPABASE_URL = 'https://lurxucdmrugikdlvvebc.supabase.co';
const RESEND_KEY = 're_hfJMphfo_4jQcxm42VWsQ83X9JbyaRpRB';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1cnh1Y2RtcnVnaWtkbHZ2ZWJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNTU5NTQsImV4cCI6MjA4OTgzMTk1NH0.ewNhBbF8nUzpF9Ve822D9t8VLwB_hjk27KuFFEXct0A';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
  }

  const {
    recallEventId,
    productName,
    lotNumber,
    barcode,
    severity,
    reason,
    manufacturerName,
    affectedStores,
    isDrill,
  } = JSON.parse(event.body);

  // Get retailer emails directly from Supabase
  let retailerEmails = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_retailer_emails`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ p_recall_event_id: recallEventId }),
      }
    );
    const emails = await res.json();
    retailerEmails = Array.isArray(emails) ? emails : [];
  } catch(e) {
    console.error('Email lookup failed:', e.message);
  }

  if (retailerEmails.length === 0) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ sent: 0, failed: 0, reason: 'No retailer emails found' }),
    };
  }

  const severityLabel = {
    class_i:   'Class I — Serious health hazard',
    class_ii:  'Class II — Potential health risk',
    class_iii: 'Class III — Minor / labelling issue',
  }[severity] || severity;

  const severityColor = {
    class_i:   '#ff5c5c',
    class_ii:  '#f5a623',
    class_iii: '#6aaf9e',
  }[severity] || '#6aaf9e';

  const drillBanner = isDrill ? `
    <div style="background:#f5a623;color:#080f12;padding:10px 16px;border-radius:6px;font-weight:700;font-size:12px;margin-bottom:20px;text-align:center;">
      ⚠ THIS IS A MOCK RECALL DRILL — No real action required
    </div>` : '';

  const html = `
    <div style="font-family:monospace;background:#080f12;color:#edfdf8;padding:40px;max-width:560px;margin:0 auto;border-radius:12px;">
      <div style="font-size:24px;font-weight:800;color:#34d399;margin-bottom:4px;">Batch'd</div>
      <div style="font-size:12px;color:#6aaf9e;margin-bottom:28px;">Food traceability platform</div>
      ${drillBanner}
      <div style="background:${isDrill?'rgba(245,166,35,0.1)':'rgba(255,92,92,0.1)'};border:1px solid ${isDrill?'rgba(245,166,35,0.3)':'rgba(255,92,92,0.3)'};border-radius:8px;padding:16px;margin-bottom:24px;">
        <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${isDrill?'#f5a623':'#ff5c5c'};margin-bottom:6px;">
          ${isDrill?'⚠ Mock Recall Drill':'🚨 Recall Alert'}
        </div>
        <div style="font-size:20px;font-weight:700;color:#edfdf8;margin-bottom:4px;">${productName}</div>
        <div style="font-size:12px;color:#6aaf9e;">
          ${lotNumber?`Lot: <strong style="color:#edfdf8;">${lotNumber}</strong>`:''}
          ${barcode?` · Barcode: <strong style="color:#edfdf8;">${barcode}</strong>`:''}
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr><td style="padding:8px 0;border-bottom:1px solid #163d37;font-size:11px;color:#6aaf9e;width:40%;">Severity</td><td style="padding:8px 0;border-bottom:1px solid #163d37;font-size:11px;color:${severityColor};font-weight:600;">${severityLabel}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #163d37;font-size:11px;color:#6aaf9e;">Reason</td><td style="padding:8px 0;border-bottom:1px solid #163d37;font-size:11px;color:#edfdf8;">${reason}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #163d37;font-size:11px;color:#6aaf9e;">Issued by</td><td style="padding:8px 0;border-bottom:1px solid #163d37;font-size:11px;color:#edfdf8;">${manufacturerName}</td></tr>
        <tr><td style="padding:8px 0;font-size:11px;color:#6aaf9e;">Stores affected</td><td style="padding:8px 0;font-size:11px;color:#edfdf8;font-weight:600;">${affectedStores} store${affectedStores!==1?'s':''} in your network</td></tr>
      </table>
      <p style="font-size:13px;color:#6aaf9e;line-height:1.7;margin-bottom:24px;">
        ${isDrill
          ?'This is a simulated recall drill. Please follow your standard recall procedure as if this were a real recall, then log your response in the dashboard.'
          :'Immediate action required. Please check your dashboard to see which stores are affected, acknowledge the recall, and confirm product removal.'}
      </p>
      <a href="https://app.batchdapp.com" style="display:inline-block;background:#34d399;color:#080f12;font-weight:700;font-size:14px;padding:14px 28px;border-radius:8px;text-decoration:none;margin-bottom:24px;">
        View recall in dashboard →
      </a>
      <p style="font-size:11px;color:#6aaf9e;line-height:1.6;">
        Recall ID: <span style="color:#edfdf8;">${recallEventId}</span>
      </p>
      <div style="border-top:1px solid #163d37;margin-top:24px;padding-top:16px;font-size:10px;color:#6aaf9e;">
        © 2026 Batch'd · <a href="https://batchdapp.com" style="color:#34d399;">batchdapp.com</a>
      </div>
    </div>`;

  const subject = isDrill
    ? `[DRILL] Mock recall: ${productName} — Action required`
    : `🚨 Recall alert: ${productName} — Immediate action required`;

  const results = await Promise.allSettled(
    retailerEmails.map(async email => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: "Batch'd <invite@batchdapp.com>",
          to: [email],
          subject,
          html,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Resend rejected ${email}: ${res.status} ${err}`);
      }
      return email;
    })
  );

  const sent   = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    results.filter(r => r.status === 'rejected').forEach(r => console.error(r.reason?.message));
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ sent, failed, emails: retailerEmails }),
  };
};
