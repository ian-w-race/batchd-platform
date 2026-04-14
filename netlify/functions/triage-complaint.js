// netlify/functions/triage-complaint.js
// Receives a complaint, saves to Supabase via REST, runs AI triage, sends follow-up email

const SUPABASE_URL = 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Prefer': 'return=representation'
  };
}

async function sbInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify(row)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return Array.isArray(data) ? data[0] : data;
}

async function sbUpdate(table, matchKey, matchVal, updates) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchKey}=eq.${encodeURIComponent(matchVal)}`, {
    method: 'PATCH',
    headers: sbHeaders(),
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(JSON.stringify(data));
  }
}

async function sbSelectOne(table, matchKey, matchVal) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchKey}=eq.${encodeURIComponent(matchVal)}&limit=1`, {
    method: 'GET',
    headers: sbHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data?.[0] || null;
}

const FOLLOW_UP_QUESTIONS = {
  illness: [
    'When exactly did you eat the product, and how soon after did symptoms begin?',
    'What symptoms did you experience? Please describe them as specifically as possible.',
    'Did you seek medical attention? If so, what was the diagnosis?',
    'Did anyone else who ate the same product also become ill?',
    'Do you still have the product, packaging, or receipt?'
  ],
  foreign_body: [
    'Can you describe the foreign material: what colour, size, and texture does it appear to be?',
    'Do you still have the product and the foreign material? Please do not discard either.',
    'Were you or anyone else injured by it?',
    'Can you photograph the product and the foreign material and reply to this email with the images attached?'
  ],
  allergen: [
    'Which allergen do you believe was present in the product?',
    'What symptoms or reaction did you or the affected person experience?',
    'Was medical treatment required?',
    'Does the product label list this allergen as an ingredient?'
  ],
  spoilage: [
    'What did you notice that indicated the product may be spoiled: odour, appearance, texture, or taste?',
    'What is the best before or use by date printed on the packaging?',
    'Was the product stored correctly before opening?',
    'Do you still have the product and packaging?'
  ],
  mislabeling: [
    'What information on the label do you believe is incorrect?',
    'Did this cause any harm, injury, or allergic reaction?',
    'Do you still have the product packaging?'
  ],
  general: [
    'Can you provide more detail about what you found or experienced?',
    'What is the best before or use by date on the packaging?',
    'Where did you purchase the product, and approximately when?',
    'Do you still have the product or packaging?'
  ]
};

function selectFollowUpQuestions(category) {
  const c = (category || '').toLowerCase();
  if (c.includes('illness') || c.includes('injury')) return FOLLOW_UP_QUESTIONS.illness;
  if (c.includes('foreign')) return FOLLOW_UP_QUESTIONS.foreign_body;
  if (c.includes('allergen') || c.includes('allerg')) return FOLLOW_UP_QUESTIONS.allergen;
  if (c.includes('spoilage') || c.includes('adulter')) return FOLLOW_UP_QUESTIONS.spoilage;
  if (c.includes('mislabel')) return FOLLOW_UP_QUESTIONS.mislabeling;
  return FOLLOW_UP_QUESTIONS.general;
}

async function runTriage(complaintText, productName) {
  const prompt = `You are a food safety triage specialist. Analyse this customer complaint about a food product and return a structured JSON assessment.

Product (if known): ${productName || 'Not specified'}
Complaint text: "${complaintText}"

Triage rules:
- CRITICAL: Any report of illness, injury, hospitalisation, allergic reaction to undeclared allergen, hard or sharp foreign body (glass, metal, plastic, bone, wire), suspected adulteration, or contamination with pathogenic risk. One such complaint requires immediate action.
- SERIOUS: Soft foreign material, spoilage signs (off odour, mould, unusual texture or colour), possible mislabelling, product clearly unfit but no confirmed injury.
- MONITOR: Cosmetic or quality complaints with no safety implication. Preference complaints. Packaging damage with no product safety risk.

Categories: Illness/Injury, Allergic Reaction, Foreign Body, Adulteration, Spoilage, Mislabeling, Packaging Defect, Quality, Cosmetic

Return ONLY valid JSON, no markdown, no preamble:
{"triage_level":"critical","triage_category":"Foreign Body","triage_summary":"One sentence summary.","keywords_detected":["plastic"],"follow_up_type":"foreign_body","recall_flag":true,"recall_flag_reason":"Reason or null"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  const raw = (data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { triage_level: 'serious', triage_category: 'Quality', triage_summary: 'Manual review required.', keywords_detected: [], follow_up_type: 'general', recall_flag: false, recall_flag_reason: null };
  }
}

async function sendFollowUpEmail(complaint, triage, orgName) {
  if (!complaint.customer_email) return;
  const questions = selectFollowUpQuestions(triage.triage_category);
  const questionList = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
  const isUrgent = triage.triage_level === 'critical';
  const firstName = complaint.customer_name ? complaint.customer_name.split(' ')[0] : null;
  const greeting = firstName ? `Dear ${firstName},` : 'Dear Customer,';
  const urgencyNote = isUrgent ? '\nWe have flagged your complaint as a priority concern and our food safety team has been alerted immediately. If you or anyone else is experiencing a medical emergency, please contact emergency services now.\n' : '';
  const subject = isUrgent
    ? `Important: Your complaint has been received [${complaint.complaint_number}]`
    : `Your complaint has been received [${complaint.complaint_number}]`;

  const body = `${greeting}

Thank you for contacting us. We have received your complaint regarding${complaint.product_name ? ' ' + complaint.product_name : ' our product'} and assigned it reference number ${complaint.complaint_number}.
${urgencyNote}
To help us investigate, we have a few follow-up questions:

${questionList}

Please reply directly to this email with as much detail as you can. If you have photographs of the product or packaging, please attach them.

${orgName ? orgName + ' Food Safety Team' : 'Food Safety Team'}

---
This complaint is managed through Batch'd Triage.
Reference: ${complaint.complaint_number}`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: "Batch'd Triage <triage@batchdapp.com>",
      to: complaint.customer_email,
      subject,
      text: body
    })
  });
}

async function sendCriticalAlert(complaint, triage, orgId, orgName) {
  const org = await sbSelectOne('organisations', 'id', orgId);
  const alertEmail = org?.contact_email;
  if (!alertEmail) return;

  const body = `A CRITICAL complaint has been received and requires immediate attention.

Reference: ${complaint.complaint_number}
Product: ${complaint.product_name || 'Not specified'}
Category: ${triage.triage_category}
Summary: ${triage.triage_summary}
${triage.recall_flag ? '\nRECALL FLAG: ' + triage.recall_flag_reason : ''}

Original complaint:
"${complaint.complaint_text}"

Customer: ${complaint.customer_name || 'Anonymous'}${complaint.customer_email ? ' | ' + complaint.customer_email : ''}${complaint.customer_phone ? ' | ' + complaint.customer_phone : ''}

Log in to review and take action: https://manufacturer.batchdapp.com
Reference: ${complaint.complaint_number}`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: "Batch'd Triage <triage@batchdapp.com>",
      to: alertEmail,
      subject: `CRITICAL complaint received: ${complaint.product_name || 'Unknown product'} [${complaint.complaint_number}]`,
      text: body
    })
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const { source, receiving_org_id, manufacturer_id, org_name, product_name, barcode, lot_number, complaint_text, customer_name, customer_email, customer_phone, purchase_store, purchase_date, incident_date, still_has_product, linked_scan_id, submitted_by_user_id, submitted_by_label } = body;

    if (!complaint_text || complaint_text.trim().length < 5) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Complaint text is required.' }) };
    }

    // 1. Insert complaint
    const complaint = await sbInsert('complaints', {
      source: source || 'phone',
      receiving_org_id: receiving_org_id || null,
      manufacturer_id: manufacturer_id || null,
      product_name: product_name || null,
      barcode: barcode || null,
      lot_number: lot_number || null,
      complaint_text: complaint_text.trim(),
      customer_name: customer_name || null,
      customer_email: customer_email || null,
      customer_phone: customer_phone || null,
      purchase_store: purchase_store || null,
      purchase_date: purchase_date || null,
      incident_date: incident_date || null,
      still_has_product: still_has_product ?? null,
      linked_scan_id: linked_scan_id || null,
      triage_level: 'pending',
      status: 'new'
    });

    // 2. Original complaint as first inbound message
    await sbInsert('complaint_messages', {
      complaint_id: complaint.id,
      direction: 'inbound',
      channel: source === 'phone' ? 'phone' : 'form',
      content: complaint_text.trim(),
      sent_by: customer_name || 'Anonymous'
    });

    // 3. Audit: received
    await sbInsert('complaint_audit_log', {
      complaint_id: complaint.id,
      action: 'complaint_received',
      actor_id: submitted_by_user_id || null,
      actor_label: submitted_by_label || (source === 'widget' ? 'Customer (web)' : 'Staff (phone intake)'),
      details: { source, product_name: product_name || null }
    });

    // 4. AI triage
    const triage = await runTriage(complaint_text, product_name);

    // 5. Update with triage results
    await sbUpdate('complaints', 'id', complaint.id, {
      triage_level: triage.triage_level,
      triage_category: triage.triage_category,
      triage_summary: triage.triage_summary,
      keywords_detected: triage.keywords_detected || [],
      status: 'triaged'
    });

    // 6. Audit: triaged
    await sbInsert('complaint_audit_log', {
      complaint_id: complaint.id,
      action: 'ai_triage_complete',
      actor_label: "Batch'd AI",
      details: { triage_level: triage.triage_level, triage_category: triage.triage_category, recall_flag: triage.recall_flag || false }
    });

    // 7. Follow-up email
    if (customer_email) {
      try {
        await sendFollowUpEmail({ ...complaint, product_name, customer_name, customer_email, complaint_text }, triage, org_name);
        const questions = selectFollowUpQuestions(triage.triage_category);
        await sbInsert('complaint_messages', {
          complaint_id: complaint.id,
          direction: 'outbound',
          channel: 'email',
          content: `Automated follow-up sent to ${customer_email}. Questions: ${questions.join(' | ')}`,
          sent_by: "Batch'd Triage (automated)"
        });
        await sbUpdate('complaints', 'id', complaint.id, { status: 'follow_up_sent' });
        await sbInsert('complaint_audit_log', {
          complaint_id: complaint.id,
          action: 'follow_up_email_sent',
          actor_label: "Batch'd Triage (automated)",
          details: { recipient: customer_email }
        });
      } catch (e) {
        console.error('Follow-up email failed:', e.message);
      }
    }

    // 8. Critical alert
    if (triage.triage_level === 'critical' && (manufacturer_id || receiving_org_id)) {
      try {
        await sendCriticalAlert(
          { ...complaint, product_name, customer_name, customer_email, customer_phone, complaint_text },
          triage,
          manufacturer_id || receiving_org_id,
          org_name
        );
        await sbInsert('complaint_audit_log', {
          complaint_id: complaint.id,
          action: 'critical_alert_sent',
          actor_label: "Batch'd Triage (automated)",
          details: { org_id: manufacturer_id || receiving_org_id }
        });
      } catch (e) {
        console.error('Critical alert failed:', e.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        complaint_id: complaint.id,
        complaint_number: complaint.complaint_number,
        triage_level: triage.triage_level,
        triage_category: triage.triage_category,
        triage_summary: triage.triage_summary,
        recall_flag: triage.recall_flag || false,
        recall_flag_reason: triage.recall_flag_reason || null
      })
    };

  } catch (err) {
    console.error('triage-complaint error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
