// netlify/functions/triage-complaint.js
// Receives a complaint, saves to Supabase, runs AI triage, sends follow-up email

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Follow-up questions calibrated to complaint type
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

function selectFollowUpQuestions(category, triageLevel) {
  const catLower = (category || '').toLowerCase();
  if (catLower.includes('illness') || catLower.includes('injury')) return FOLLOW_UP_QUESTIONS.illness;
  if (catLower.includes('foreign')) return FOLLOW_UP_QUESTIONS.foreign_body;
  if (catLower.includes('allergen') || catLower.includes('allerg')) return FOLLOW_UP_QUESTIONS.allergen;
  if (catLower.includes('spoilage') || catLower.includes('adulter')) return FOLLOW_UP_QUESTIONS.spoilage;
  if (catLower.includes('mislabel')) return FOLLOW_UP_QUESTIONS.mislabeling;
  return FOLLOW_UP_QUESTIONS.general;
}

async function runTriage(complaintText, productName) {
  const prompt = `You are a food safety triage specialist. Analyse this customer complaint about a food product and return a structured JSON assessment.

Product (if known): ${productName || 'Not specified'}
Complaint text: "${complaintText}"

Triage rules:
- CRITICAL: Any report of illness, injury, hospitalisation, allergic reaction to undeclared allergen, hard/sharp foreign body (glass, metal, plastic, bone, wire), suspected adulteration, or contamination with pathogenic risk. One such complaint requires immediate action.
- SERIOUS: Soft foreign material, spoilage signs (off odour, mould, unusual texture/colour), possible mislabelling, product clearly unfit but no confirmed injury, or multiple complaints suggesting a pattern.
- MONITOR: Cosmetic or quality complaints with no safety implication. Preference complaints ("too salty", "not enough flavour", "texture is off"). Packaging damage with no product safety risk.

Categories (pick the single most accurate):
Illness/Injury, Allergic Reaction, Foreign Body, Adulteration, Spoilage, Mislabeling, Packaging Defect, Quality, Cosmetic

Key terminology: "Adulterated" means the product contains a contaminant, spoilage agent, or foreign substance that makes it unfit or unsafe.

Return ONLY valid JSON, no markdown, no preamble:
{
  "triage_level": "critical" | "serious" | "monitor",
  "triage_category": "<single category from list above>",
  "triage_summary": "<one sentence: what the complaint describes and why this triage level was assigned>",
  "keywords_detected": ["<word1>", "<word2>"],
  "follow_up_type": "illness" | "foreign_body" | "allergen" | "spoilage" | "mislabeling" | "general",
  "recall_flag": true | false,
  "recall_flag_reason": "<brief reason if recall_flag is true, otherwise null>"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
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

  const data = await response.json();
  const raw = data.content?.[0]?.text || '{}';
  try {
    return JSON.parse(raw);
  } catch {
    // Fallback if parsing fails
    return {
      triage_level: 'serious',
      triage_category: 'Quality',
      triage_summary: 'Triage parsing failed — manual review required.',
      keywords_detected: [],
      follow_up_type: 'general',
      recall_flag: false,
      recall_flag_reason: null
    };
  }
}

async function sendFollowUpEmail(complaint, triage, orgName, resend) {
  if (!complaint.customer_email) return;

  const questions = selectFollowUpQuestions(triage.triage_category, triage.triage_level);
  const questionList = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');

  const isUrgent = triage.triage_level === 'critical';
  const subject = isUrgent
    ? `Important: Your complaint has been received — ${orgName || 'Food Safety Team'} [${complaint.complaint_number}]`
    : `Your complaint has been received — ${orgName || 'Food Safety Team'} [${complaint.complaint_number}]`;

  const greeting = complaint.customer_name ? `Dear ${complaint.customer_name.split(' ')[0]},` : 'Dear Customer,';

  const urgencyNote = isUrgent
    ? `\nWe have flagged your complaint as a priority concern and our food safety team has been alerted immediately. If you or anyone else is experiencing a medical emergency, please contact emergency services or seek medical attention now.\n`
    : '';

  const emailBody = `${greeting}

Thank you for taking the time to contact us. We have received your complaint regarding${complaint.product_name ? ' ' + complaint.product_name : ' our product'} and have assigned it reference number ${complaint.complaint_number}.
${urgencyNote}
To help us investigate this properly, we have a few follow-up questions:

${questionList}

Please reply directly to this email with as much detail as you can. If you have photographs of the product or packaging, please attach them to your reply.

We take every complaint seriously. Our team will review your response and follow up with you directly.

${orgName ? orgName + ' Food Safety Team' : 'Food Safety Team'}

---
This complaint is being managed through Batch'd Triage, a food safety and traceability platform.
Reference: ${complaint.complaint_number}`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'Batch\'d Triage <triage@batchdapp.com>',
      to: complaint.customer_email,
      reply_to: 'triage@batchdapp.com',
      subject,
      text: emailBody
    })
  });
}

async function alertOrgAdmins(complaint, triage, supabase) {
  if (triage.triage_level !== 'critical') return;

  // Get org admin emails
  const orgId = complaint.receiving_org_id || complaint.manufacturer_id;
  if (!orgId) return;

  const { data: members } = await supabase
    .from('organisation_members')
    .select('user_id')
    .eq('organisation_id', orgId)
    .in('role', ['corp_admin', 'mfr_admin']);

  if (!members?.length) return;

  const { data: org } = await supabase
    .from('organisations')
    .select('name, contact_email')
    .eq('id', orgId)
    .single();

  const alertEmail = org?.contact_email;
  if (!alertEmail) return;

  const emailBody = `A CRITICAL complaint has been submitted and requires immediate attention.

Reference: ${complaint.complaint_number}
Product: ${complaint.product_name || 'Not specified'}
Category: ${triage.triage_category}
Summary: ${triage.triage_summary}
${triage.recall_flag ? '\nRECALL FLAG: ' + triage.recall_flag_reason : ''}

Original complaint:
"${complaint.complaint_text}"

Customer: ${complaint.customer_name || 'Anonymous'}${complaint.customer_email ? ' | ' + complaint.customer_email : ''}${complaint.customer_phone ? ' | ' + complaint.customer_phone : ''}

Log in to Batch'd to review and take action:
https://manufacturer.batchdapp.com

Reference: ${complaint.complaint_number}`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'Batch\'d Triage <triage@batchdapp.com>',
      to: alertEmail,
      subject: `CRITICAL complaint received — ${complaint.product_name || 'Unknown product'} [${complaint.complaint_number}]`,
      text: emailBody
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
    const {
      source,
      receiving_org_id,
      manufacturer_id,
      org_name,
      product_name,
      barcode,
      lot_number,
      complaint_text,
      customer_name,
      customer_email,
      customer_phone,
      purchase_store,
      purchase_date,
      incident_date,
      still_has_product,
      linked_scan_id,
      submitted_by_user_id,
      submitted_by_label
    } = body;

    if (!complaint_text || complaint_text.trim().length < 5) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Complaint text is required.' }) };
    }
    if (!source) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Source is required.' }) };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. Insert complaint
    const { data: complaint, error: insertError } = await supabase
      .from('complaints')
      .insert({
        source,
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
      })
      .select()
      .single();

    if (insertError) throw new Error('Failed to save complaint: ' + insertError.message);

    // 2. Save original complaint as first message
    await supabase.from('complaint_messages').insert({
      complaint_id: complaint.id,
      direction: 'inbound',
      channel: source === 'phone' ? 'phone' : 'form',
      content: complaint_text.trim(),
      sent_by: customer_name || 'Anonymous'
    });

    // 3. Audit log: received
    await supabase.from('complaint_audit_log').insert({
      complaint_id: complaint.id,
      action: 'complaint_received',
      actor_id: submitted_by_user_id || null,
      actor_label: submitted_by_label || (source === 'widget' ? 'Customer (web)' : source === 'phone' ? 'Staff (phone intake)' : 'System'),
      details: { source, product_name, customer_email: customer_email || null }
    });

    // 4. Run AI triage
    const triage = await runTriage(complaint_text, product_name);

    // 5. Update complaint with triage results
    await supabase
      .from('complaints')
      .update({
        triage_level: triage.triage_level,
        triage_category: triage.triage_category,
        triage_summary: triage.triage_summary,
        keywords_detected: triage.keywords_detected || [],
        status: 'triaged'
      })
      .eq('id', complaint.id);

    // 6. Audit log: triaged
    await supabase.from('complaint_audit_log').insert({
      complaint_id: complaint.id,
      action: 'ai_triage_complete',
      actor_label: 'Batch\'d AI',
      details: {
        triage_level: triage.triage_level,
        triage_category: triage.triage_category,
        recall_flag: triage.recall_flag,
        recall_flag_reason: triage.recall_flag_reason || null
      }
    });

    // 7. Send follow-up email to customer (if email provided)
    if (customer_email) {
      await sendFollowUpEmail(
        { ...complaint, product_name, customer_name, customer_email, complaint_text },
        triage,
        org_name,
        RESEND_API_KEY
      );

      // Save follow-up as outbound message
      const questions = selectFollowUpQuestions(triage.triage_category, triage.triage_level);
      await supabase.from('complaint_messages').insert({
        complaint_id: complaint.id,
        direction: 'outbound',
        channel: 'email',
        content: `Automated follow-up sent to ${customer_email}. Questions: ${questions.join(' | ')}`,
        sent_by: 'Batch\'d Triage (automated)'
      });

      await supabase.from('complaints').update({ status: 'follow_up_sent' }).eq('id', complaint.id);

      await supabase.from('complaint_audit_log').insert({
        complaint_id: complaint.id,
        action: 'follow_up_email_sent',
        actor_label: 'Batch\'d Triage (automated)',
        details: { recipient: customer_email }
      });
    }

    // 8. Alert org admins if critical
    if (triage.triage_level === 'critical') {
      await alertOrgAdmins({ ...complaint, product_name, complaint_text, customer_name, customer_email, customer_phone }, triage, supabase);

      await supabase.from('complaint_audit_log').insert({
        complaint_id: complaint.id,
        action: 'critical_alert_sent',
        actor_label: 'Batch\'d Triage (automated)',
        details: { org_id: receiving_org_id || manufacturer_id }
      });
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
        recall_flag: triage.recall_flag,
        recall_flag_reason: triage.recall_flag_reason || null
      })
    };

  } catch (err) {
    console.error('triage-complaint error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal error: ' + err.message })
    };
  }
};
