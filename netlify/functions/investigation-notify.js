// netlify/functions/investigation-notify.js
// Sends investigation request emails to retailer admins
// Also handles AI photo analysis for investigation responses

const RESEND_KEY = process.env.RESEND_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { type } = body;

  try {
    if (type === 'notify_retailers')    return await notifyRetailers(body);
    if (type === 'analyze_photo')       return await analyzePhoto(body);
    if (type === 'summarize_findings')  return await summarizeFindings(body);
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown type: ' + type }) };
  } catch (e) {
    console.error('[investigation-notify]', type, e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};

// ── 1. Notify retailer admins about a new investigation request ──
async function notifyRetailers(body) {
  const { investigation_id, product_name, lot_number, issue_type, issue_description,
          instructions, urgency_class, deadline_at, manufacturer_name, retailer_emails } = body;

  if (!retailer_emails?.length) return ok({ sent: 0 });

  const urgencyLabels = { 1: '🔴 URGENT — 24-hour response required', 2: '🟡 Priority — 72-hour response required', 3: '🟢 Standard — 7-day response requested' };
  const issueLabels = {
    foreign_object: 'Foreign Object Contamination',
    mold: 'Mold / Fungal Growth',
    mislabeling: 'Mislabeling / Wrong Product',
    allergen: 'Undeclared Allergen',
    contamination: 'Physical/Chemical Contamination',
    discoloration: 'Discoloration / Quality Issue',
    pest: 'Pest Contamination',
    packaging: 'Packaging Defect',
    other: 'Product Quality Issue',
  };

  const deadlineStr = deadline_at ? new Date(deadline_at).toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', timeZoneName:'short' }) : 'As soon as possible';
  const urgencyLabel = urgencyLabels[urgency_class] || urgencyLabels[2];
  const issueLabel = issueLabels[issue_type] || 'Product Issue';
  const responseUrl = `https://app.batchdapp.com/dashboard.html#investigations`;

  const subject = `[${urgency_class === 1 ? 'URGENT' : 'ACTION REQUIRED'}] Product Investigation — ${product_name}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
  .card { background: #fff; border-radius: 10px; max-width: 580px; margin: 0 auto; overflow: hidden; }
  .header { background: ${urgency_class === 1 ? '#ff5c5c' : urgency_class === 2 ? '#f5a623' : '#34d399'}; padding: 24px 28px; }
  .header h1 { color: #fff; margin: 0; font-size: 18px; font-weight: 700; }
  .header p { color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 13px; }
  .body { padding: 28px; }
  .field { margin-bottom: 16px; }
  .field label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; display: block; margin-bottom: 4px; }
  .field value { font-size: 14px; color: #111; font-weight: 600; }
  .instructions { background: #f8f9fa; border-left: 3px solid #ccc; padding: 12px 16px; border-radius: 4px; font-size: 13px; color: #444; line-height: 1.6; margin: 16px 0; }
  .deadline { background: ${urgency_class === 1 ? '#fff5f5' : '#fffbf0'}; border: 1px solid ${urgency_class === 1 ? '#fcc' : '#fde68a'}; border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 13px; }
  .cta { display: block; background: #34d399; color: #065f46; text-decoration: none; font-weight: 700; font-size: 14px; text-align: center; padding: 14px 20px; border-radius: 8px; margin: 20px 0 0; }
  .footer { padding: 16px 28px; background: #f8f9fa; font-size: 11px; color: #999; }
</style></head>
<body>
  <div class="card">
    <div class="header">
      <h1>🔍 Product Investigation Request</h1>
      <p>${urgencyLabel}</p>
    </div>
    <div class="body">
      <p style="font-size:14px;color:#333;margin-top:0;"><strong>${manufacturer_name}</strong> has launched a product investigation and is requesting your stores to inspect and report back.</p>

      <div class="field"><label>Product</label><value>${product_name || 'See details'}</value></div>
      ${lot_number ? `<div class="field"><label>Lot / Batch Number</label><value style="font-family:monospace">${lot_number}</value></div>` : ''}
      <div class="field"><label>Issue Type</label><value>${issueLabel}</value></div>
      <div class="field"><label>Issue Description</label><value style="font-weight:400;font-size:13px;color:#444;">${issue_description}</value></div>

      ${instructions ? `<div class="instructions"><strong>What to inspect:</strong><br>${instructions}</div>` : ''}

      <div class="deadline">
        <strong>⏰ Response required by:</strong> ${deadlineStr}
      </div>

      <p style="font-size:13px;color:#666;">Please inspect the product in your stores, take photos of any issues found, and submit your findings through the Batch'd corporate dashboard. Your response — whether you find an issue or not — is important to the investigation.</p>

      <a href="${responseUrl}" class="cta">Respond in Batch'd Dashboard →</a>
    </div>
    <div class="footer">
      This investigation was initiated through the Batch'd food safety platform. Investigation ID: ${investigation_id}
    </div>
  </div>
</body>
</html>`;

  let sent = 0;
  for (const email of retailer_emails) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Batch\'d <alerts@batchdapp.com>', to: email, subject, html }),
      });
      if (res.ok) sent++;
      else console.warn('[notify] Failed to send to', email, await res.text());
    } catch (e) { console.warn('[notify] Error sending to', email, e.message); }
  }

  return ok({ sent });
}

// ── 2. Analyze a single investigation photo with Claude Vision ──
async function analyzePhoto(body) {
  const { photo_b64, issue_type, product_name, media_type } = body;
  if (!photo_b64 || !ANTHROPIC_KEY) return ok({ analysis: null, issue_detected: null });

  const issuePrompts = {
    foreign_object: 'Look for any foreign objects, debris, metal fragments, glass, plastic, insects, or anything that should not be in the food.',
    mold: 'Look for mold, fungal growth, discoloration, white/green/black fuzzy patches, or signs of spoilage.',
    mislabeling: 'Check if the product visible matches the expected product. Look for wrong contents, mismatched label, or signs this is not the stated product.',
    allergen: 'Check for visible traces of allergen-containing ingredients (nuts, dairy, gluten traces) that may indicate cross-contamination or mislabeling.',
    contamination: 'Look for signs of physical or chemical contamination — unusual residue, staining, discoloration, or foreign substances.',
    discoloration: 'Note any unusual coloring, browning, graying, or unnatural appearance compared to what the product should look like.',
    pest: 'Look for pest activity — droppings, bite marks, insect parts, webbing, or other evidence of pest contamination.',
    packaging: 'Examine the packaging for damage — tears, leaks, bulging, improper sealing, or other integrity issues.',
  };

  const issueGuidance = issuePrompts[issue_type] || 'Look for any visible quality or safety issue.';

  const prompt = `You are a food safety inspector analyzing a product photo submitted as part of a ${issue_type} investigation for "${product_name || 'a food product'}".

${issueGuidance}

Provide a structured assessment:
1. ISSUE_DETECTED: yes / no / uncertain
2. CONFIDENCE: high / medium / low
3. FINDINGS: What do you see? Be specific and objective. 2-3 sentences.
4. SEVERITY: none / minor / moderate / serious (if issue detected)

Respond in this exact JSON format:
{"issue_detected": boolean, "confidence": "high|medium|low", "findings": "...", "severity": "none|minor|moderate|serious"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: photo_b64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!res.ok) throw new Error('Claude API error ' + res.status);
  const data = await res.json();
  const text = data.content?.[0]?.text || '{}';
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return ok(parsed);
  } catch {
    return ok({ issue_detected: null, confidence: 'low', findings: text.slice(0, 300), severity: 'none' });
  }
}

// ── 3. AI summary of all investigation findings ──
async function summarizeFindings(body) {
  const { investigation_id, product_name, issue_type, issue_description, responses } = body;
  if (!responses?.length || !ANTHROPIC_KEY) return ok({ summary: null });

  const responseText = responses.map((r, i) =>
    `Store ${i+1} (${r.store_name || 'Unknown'}): ` +
    `Inspected ${r.units_inspected || '?'} units. ` +
    `Issue found: ${r.issue_found ? 'YES' : 'NO'}. ` +
    (r.issue_description ? `Notes: ${r.issue_description}` : '') +
    (r.ai_analysis ? ` AI analysis: ${r.ai_analysis}` : '')
  ).join('\n');

  const prompt = `You are a food safety investigation analyst. Summarize the following investigation responses for a food safety decision-maker.

Investigation: ${issue_type} concern with "${product_name}"
Issue reported: ${issue_description}

Retailer responses (${responses.length} stores):
${responseText}

Write a concise 3-4 sentence investigative summary covering:
1. How many stores found the issue vs did not
2. Any patterns in the findings (locations, lot codes, severity)
3. Recommended next step (close investigation / escalate to recall / gather more data)

Be direct and fact-based.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
  });

  if (!res.ok) throw new Error('Claude API error ' + res.status);
  const data = await res.json();
  const summary = data.content?.[0]?.text || '';
  return ok({ summary });
}

function ok(data) { return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, ...data }) }; }
