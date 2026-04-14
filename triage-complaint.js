// netlify/functions/triage-complaint.js
// v2 — enriched fields, smart matching, bilingual follow-up

const SUPABASE_URL = 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// ── Supabase REST helpers ──────────────────────────────────────

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
    method: 'POST', headers: sbHeaders(), body: JSON.stringify(row)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return Array.isArray(data) ? data[0] : data;
}

async function sbUpdate(table, matchKey, matchVal, updates) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchKey}=eq.${encodeURIComponent(matchVal)}`, {
    method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(updates)
  });
  if (!res.ok) { const d = await res.json(); throw new Error(JSON.stringify(d)); }
}

async function sbQuery(table, params) {
  const qs = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'GET', headers: sbHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data || [];
}

// ── Follow-up questions (EN + NO) ─────────────────────────────

const FUQ = {
  illness: {
    en: [
      'When exactly did you eat the product, and how soon after did symptoms begin?',
      'What symptoms did you experience? Please describe them as specifically as possible.',
      'Did you or anyone else seek medical attention? If so, what was the outcome?',
      'Did others who ate the same product also become ill?',
      'Do you still have the product, packaging, or receipt? Please do not discard anything.'
    ],
    no: [
      'Når spiste du produktet, og hvor lenge etter begynte symptomene?',
      'Hvilke symptomer opplevde du? Beskriv dem så spesifikt som mulig.',
      'Søkte du eller noen andre medisinsk hjelp? Hva ble resultatet?',
      'Ble andre som spiste samme produkt også syke?',
      'Har du fortsatt produktet, emballasjen eller kvitteringen? Ikke kast noe.'
    ]
  },
  foreign_body: {
    en: [
      'Can you describe the foreign material: approximate size, colour, and texture?',
      'Do you still have the product and the foreign material? Please do not discard either.',
      'Were you or anyone else injured by it?',
      'Can you photograph both the product and the foreign material and reply to this email with the images attached?'
    ],
    no: [
      'Kan du beskrive fremmedlegemet: omtrentlig størrelse, farge og tekstur?',
      'Har du fortsatt produktet og fremmedlegemet? Ikke kast noe.',
      'Ble du eller noen andre skadet?',
      'Kan du fotografere både produktet og fremmedlegemet og svare på denne e-posten med bildene vedlagt?'
    ]
  },
  allergen: {
    en: [
      'Which allergen do you believe was present in the product?',
      'What reaction did you or the affected person experience, and how quickly did it develop?',
      'Was medical treatment required?',
      'Does the product label list this allergen as an ingredient?'
    ],
    no: [
      'Hvilket allergen mener du var tilstede i produktet?',
      'Hvilken reaksjon opplevde du eller den berørte personen, og hvor raskt utviklet den seg?',
      'Var medisinsk behandling nødvendig?',
      'Er dette allergenet oppført som ingrediens på produktetiketten?'
    ]
  },
  spoilage: {
    en: [
      'What did you notice that indicated the product may be spoiled: odour, appearance, texture, or taste?',
      'What is the best before or use by date on the packaging?',
      'Was the product stored correctly before opening?',
      'Do you still have the product and packaging?'
    ],
    no: [
      'Hva observerte du som tydet på at produktet kan ha vært bedervet: lukt, utseende, tekstur eller smak?',
      'Hva er best-før eller siste-forbruksdato på emballasjen?',
      'Ble produktet oppbevart riktig før åpning?',
      'Har du fortsatt produktet og emballasjen?'
    ]
  },
  mislabeling: {
    en: [
      'What information on the label do you believe is incorrect or missing?',
      'Did this cause any harm, injury, or allergic reaction?',
      'Do you still have the product packaging?'
    ],
    no: [
      'Hvilken informasjon på etiketten mener du er feil eller manglende?',
      'Forårsaket dette skade, personskade eller allergisk reaksjon?',
      'Har du fortsatt produktemballasjen?'
    ]
  },
  general: {
    en: [
      'Can you provide more detail about what you found or experienced?',
      'What is the best before or use by date on the packaging?',
      'Do you still have the product or packaging?',
      'Can you provide the barcode number from the packaging?'
    ],
    no: [
      'Kan du gi mer detaljer om hva du fant eller opplevde?',
      'Hva er best-før eller siste-forbruksdato på emballasjen?',
      'Har du fortsatt produktet eller emballasjen?',
      'Kan du oppgi strekkode-nummeret fra emballasjen?'
    ]
  }
};

function selectFUQ(category, lang) {
  const c = (category || '').toLowerCase();
  const l = lang === 'no' ? 'no' : 'en';
  if (c.includes('illness') || c.includes('injury')) return FUQ.illness[l];
  if (c.includes('foreign')) return FUQ.foreign_body[l];
  if (c.includes('allergen') || c.includes('allerg')) return FUQ.allergen[l];
  if (c.includes('spoilage') || c.includes('adulter')) return FUQ.spoilage[l];
  if (c.includes('mislabel')) return FUQ.mislabeling[l];
  return FUQ.general[l];
}

// ── AI triage ─────────────────────────────────────────────────

async function runTriage(complaint) {
  const contextLines = [
    `Country: ${complaint.country || 'Unknown'}`,
    `Product: ${complaint.product_name || 'Not specified'}`,
    `Barcode: ${complaint.barcode || 'Not provided'}`,
    `Lot/Batch: ${complaint.lot_number || 'Not provided'}`,
    `Best before: ${complaint.best_before_date || 'Not provided'}`,
    `Purchase date: ${complaint.purchase_date || 'Not provided'}`,
    `Store: ${[complaint.store_name, complaint.purchase_city, complaint.purchase_state, complaint.country].filter(Boolean).join(', ') || 'Not provided'}`,
    `People affected: ${complaint.people_affected || 'Not stated'}`,
    `Medical attention: ${complaint.medical_attention || 'Not stated'}`,
    `Still has product: ${complaint.still_has_product !== null ? complaint.still_has_product : 'Unknown'}`,
    `Storage method: ${complaint.storage_method || 'Not stated'}`,
    `Complaint: "${complaint.complaint_text}"`
  ].join('\n');

  const prompt = `You are a food safety triage specialist. Analyse this complaint and return a JSON assessment.

${contextLines}

Triage levels:
- CRITICAL: Illness, injury, hospitalisation, allergic reaction to undeclared allergen, hard/sharp foreign body (glass, metal, plastic, bone, wire, stone), suspected adulteration, pathogenic contamination risk. One such complaint requires immediate action.
- SERIOUS: Soft foreign material, spoilage signs (off odour, mould, unusual texture/colour), possible mislabelling, product unfit but no confirmed injury, multiple indicators suggesting pattern.
- MONITOR: Cosmetic or quality complaints with no safety implication. Preference complaints. Packaging damage with no product safety risk.

Categories: Illness/Injury, Allergic Reaction, Foreign Body, Adulteration, Spoilage, Mislabeling, Packaging Defect, Quality, Cosmetic

"Adulterated" means the product contains a contaminant, spoilage agent, or foreign substance making it unfit or unsafe.

Also assess: should this trigger a recall recommendation? Consider: severity, whether product is in commerce, lot number available, multiple people affected, medical attention sought.

Return ONLY valid JSON:
{"triage_level":"critical","triage_category":"Foreign Body","triage_summary":"One precise sentence.","keywords_detected":["word1"],"follow_up_type":"foreign_body","recall_flag":true,"recall_flag_reason":"Brief reason or null","severity_factors":["foreign body reported","injury possible","product still in possession"]}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  const raw = (data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim();
  try { return JSON.parse(raw); }
  catch { return { triage_level: 'serious', triage_category: 'Quality', triage_summary: 'Manual review required.', keywords_detected: [], follow_up_type: 'general', recall_flag: false, recall_flag_reason: null, severity_factors: [] }; }
}

// ── Smart matching ─────────────────────────────────────────────

async function runSmartMatching(complaint, orgId) {
  const matches = { products: [], stores: [], shipments: [] };

  try {
    // 1. Product match by barcode (most reliable)
    if (complaint.barcode) {
      const products = await sbQuery('products', { 'barcode=eq': complaint.barcode, 'select': 'id,name,barcode,manufacturer_id', 'limit': '3' });
      if (products.length) matches.products = products.map(p => ({ id: p.id, name: p.name, barcode: p.barcode, confidence: 'high', reason: 'Barcode match' }));
    }

    // 2. Product match by name (fuzzy - partial match using ilike)
    if (!matches.products.length && complaint.product_name) {
      const namePart = complaint.product_name.toLowerCase().split(' ')[0]; // first word
      const products = await sbQuery('products', { 'name=ilike': `*${namePart}*`, 'select': 'id,name,barcode,manufacturer_id', 'limit': '5' });
      if (products.length) matches.products = products.map(p => ({ id: p.id, name: p.name, barcode: p.barcode, confidence: 'medium', reason: 'Product name partial match' }));
    }

    // 3. Store match by name + city
    if (complaint.store_name && complaint.purchase_city) {
      const stores = await sbQuery('stores', { 'name=ilike': `*${complaint.store_name.split(' ')[0]}*`, 'select': 'id,name,address,organisation_id', 'limit': '5' });
      if (stores.length) {
        matches.stores = stores
          .filter(s => !complaint.purchase_city || (s.address || '').toLowerCase().includes(complaint.purchase_city.toLowerCase()))
          .map(s => ({ id: s.id, name: s.name, address: s.address, confidence: 'medium', reason: 'Store name + city match' }));
        if (!matches.stores.length) matches.stores = stores.map(s => ({ id: s.id, name: s.name, address: s.address, confidence: 'low', reason: 'Store name partial match' }));
      }
    }

    // 4. Lot/shipment match
    if (complaint.lot_number) {
      const shipments = await sbQuery('shipments', { 'lot_number=eq': complaint.lot_number, 'select': 'id,lot_number,product_id,manufacturer_id,retailer_id,store_id,quantity,unit,shipped_at', 'limit': '10' });
      if (shipments.length) matches.shipments = shipments.map(s => ({ id: s.id, lot_number: s.lot_number, manufacturer_id: s.manufacturer_id, retailer_id: s.retailer_id, store_id: s.store_id, quantity: s.quantity, unit: s.unit, shipped_at: s.shipped_at, confidence: 'high', reason: 'Exact lot number match in shipment records' }));
    }
  } catch (e) {
    console.error('Smart matching error:', e.message);
  }

  return matches;
}

// ── Email helpers ──────────────────────────────────────────────

async function sendFollowUpEmail(complaint, triage, orgName) {
  if (!complaint.customer_email) return;
  const lang = complaint.lang || 'en';
  const questions = selectFUQ(triage.triage_category, lang);
  const questionList = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
  const isUrgent = triage.triage_level === 'critical';
  const firstName = complaint.customer_name ? complaint.customer_name.split(' ')[0] : null;

  const strings = {
    en: {
      greeting: firstName ? `Dear ${firstName},` : 'Dear Customer,',
      intro: `Thank you for contacting us. We have received your report regarding${complaint.product_name ? ' ' + complaint.product_name : ' our product'} and assigned it reference number ${complaint.complaint_number}.`,
      urgent: '\nWe have flagged your report as a priority concern and our food safety team has been alerted immediately. If you or anyone else is experiencing a medical emergency, please contact emergency services now.\n',
      followup: 'To help us investigate thoroughly, we have a few follow-up questions:',
      reply: 'Please reply directly to this email with as much detail as you can. If you have photographs of the product or packaging, please attach them.',
      team: `${orgName ? orgName + ' Food Safety Team' : 'Food Safety Team'}`,
      footer: `This report is managed through Batch'd Triage.\nReference: ${complaint.complaint_number}`
    },
    no: {
      greeting: firstName ? `Hei ${firstName},` : 'Hei,',
      intro: `Takk for at du kontaktet oss. Vi har mottatt din rapport vedrørende${complaint.product_name ? ' ' + complaint.product_name : ' vårt produkt'} og tildelt den referansenummer ${complaint.complaint_number}.`,
      urgent: '\nVi har flagget rapporten din som et prioritert problem og mattrygghetsteamet vårt er varslet umiddelbart. Hvis du eller noen andre opplever en medisinsk nødsituasjon, kontakt nødetatene nå.\n',
      followup: 'For å hjelpe oss med å etterforske grundig, har vi noen oppfølgingsspørsmål:',
      reply: 'Vennligst svar direkte på denne e-posten med så mye detaljer du kan. Hvis du har fotografier av produktet eller emballasjen, legg dem ved.',
      team: `${orgName ? orgName + ' mattrygghets-team' : 'Mattrygghetsteamet'}`,
      footer: `Denne rapporten administreres gjennom Batch'd Triage.\nReferanse: ${complaint.complaint_number}`
    }
  };

  const s = strings[lang] || strings.en;
  const subject = lang === 'no'
    ? (isUrgent ? `Viktig: Din rapport er mottatt [${complaint.complaint_number}]` : `Din rapport er mottatt [${complaint.complaint_number}]`)
    : (isUrgent ? `Important: Your report has been received [${complaint.complaint_number}]` : `Your report has been received [${complaint.complaint_number}]`);

  const body = `${s.greeting}\n\n${s.intro}\n${isUrgent ? s.urgent : ''}\n${s.followup}\n\n${questionList}\n\n${s.reply}\n\n${s.team}\n\n---\n${s.footer}`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: "Batch'd Triage <triage@batchdapp.com>", to: complaint.customer_email, subject, text: body })
  });
}

async function sendCriticalAlert(complaint, triage, matches, orgId, orgName) {
  const orgs = await sbQuery('organisations', { 'id=eq': orgId, 'select': 'contact_email', 'limit': '1' });
  const alertEmail = orgs?.[0]?.contact_email;
  if (!alertEmail) return;

  const matchSummary = [];
  if (matches.products?.length) matchSummary.push(`Product match: ${matches.products[0].name} (${matches.products[0].reason})`);
  if (matches.stores?.length) matchSummary.push(`Store match: ${matches.stores[0].name} (${matches.stores[0].reason})`);
  if (matches.shipments?.length) matchSummary.push(`Lot match: ${matches.shipments.length} shipment record(s) found for lot ${complaint.lot_number}`);

  const location = [complaint.store_name, complaint.purchase_city, complaint.purchase_state, complaint.country].filter(Boolean).join(', ');

  const body = `CRITICAL complaint received — immediate attention required.

Reference: ${complaint.complaint_number}
Product: ${complaint.product_name || 'Not specified'}${complaint.barcode ? ' (barcode: ' + complaint.barcode + ')' : ''}
Lot/Batch: ${complaint.lot_number || 'Not provided'}
Best before: ${complaint.best_before_date || 'Not provided'}
Category: ${triage.triage_category}
Severity factors: ${(triage.severity_factors || []).join(', ') || 'See summary'}
Summary: ${triage.triage_summary}
${triage.recall_flag ? '\nRECALL FLAG: ' + triage.recall_flag_reason : ''}

Location: ${location || 'Not provided'}
People affected: ${complaint.people_affected || 'Not stated'}
Medical attention: ${complaint.medical_attention || 'Not stated'}
Product retained: ${complaint.still_has_product !== null ? complaint.still_has_product : 'Unknown'}

Original complaint:
"${complaint.complaint_text}"

Customer: ${complaint.customer_name || 'Anonymous'}${complaint.customer_email ? ' | ' + complaint.customer_email : ''}${complaint.customer_phone ? ' | ' + complaint.customer_phone : ''}

${matchSummary.length ? 'BATCH\'D MATCHES FOUND:\n' + matchSummary.join('\n') + '\n' : ''}
Review and take action: https://manufacturer.batchdapp.com
Reference: ${complaint.complaint_number}`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: "Batch'd Triage <triage@batchdapp.com>",
      to: alertEmail,
      subject: `CRITICAL complaint: ${complaint.product_name || 'Unknown product'} [${complaint.complaint_number}]`,
      text: body
    })
  });
}

// ── Main handler ───────────────────────────────────────────────

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
      source, receiving_org_id, manufacturer_id, org_name,
      // Core
      product_name, barcode, lot_number, complaint_text, lang,
      // Contact
      customer_name, customer_email, customer_phone,
      // Location
      country, store_name, purchase_city, purchase_state,
      // Product evidence
      best_before_date, purchase_date,
      // Health signals
      people_affected, medical_attention, still_has_product, storage_method,
      // Meta
      linked_scan_id, submitted_by_user_id, submitted_by_label
    } = body;

    if (!complaint_text || complaint_text.trim().length < 5) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Complaint text is required.' }) };
    }

    // 1. Insert complaint with all new fields
    const complaint = await sbInsert('complaints', {
      source: source || 'widget',
      receiving_org_id: receiving_org_id || null,
      manufacturer_id: manufacturer_id || null,
      product_name: product_name || null,
      barcode: barcode || null,
      lot_number: lot_number || null,
      complaint_text: complaint_text.trim(),
      customer_name: customer_name || null,
      customer_email: customer_email || null,
      customer_phone: customer_phone || null,
      purchase_store: store_name || null,
      purchase_date: purchase_date || null,
      incident_date: purchase_date || null,
      still_has_product: still_has_product ?? null,
      linked_scan_id: linked_scan_id || null,
      triage_level: 'pending',
      status: 'new'
    });

    // 2. Original complaint as inbound message
    const locationStr = [store_name, purchase_city, purchase_state, country].filter(Boolean).join(', ');
    const contextStr = [
      complaint_text.trim(),
      country ? `Country: ${country}` : '',
      locationStr ? `Location: ${locationStr}` : '',
      best_before_date ? `Best before: ${best_before_date}` : '',
      people_affected ? `People affected: ${people_affected}` : '',
      medical_attention ? `Medical attention: ${medical_attention}` : '',
      storage_method ? `Storage: ${storage_method}` : '',
    ].filter(Boolean).join('\n');

    await sbInsert('complaint_messages', {
      complaint_id: complaint.id,
      direction: 'inbound',
      channel: source === 'phone' ? 'phone' : 'form',
      content: contextStr,
      sent_by: customer_name || 'Anonymous'
    });

    // 3. Audit: received
    await sbInsert('complaint_audit_log', {
      complaint_id: complaint.id,
      action: 'complaint_received',
      actor_id: submitted_by_user_id || null,
      actor_label: submitted_by_label || (source === 'widget' ? 'Customer (web widget)' : source === 'phone' ? 'Staff (phone intake)' : 'Customer (web form)'),
      details: { source, country, product_name: product_name || null, barcode: barcode || null, lot_number: lot_number || null }
    });

    // 4. AI triage
    const triageInput = { country, product_name, barcode, lot_number, best_before_date, purchase_date, store_name, purchase_city, purchase_state, people_affected, medical_attention, still_has_product, storage_method, complaint_text: complaint_text.trim() };
    const triage = await runTriage(triageInput);

    // 5. Smart matching
    const matches = await runSmartMatching({ product_name, barcode, lot_number, store_name, purchase_city }, manufacturer_id || receiving_org_id);

    // 6. Update complaint with triage results
    await sbUpdate('complaints', 'id', complaint.id, {
      triage_level: triage.triage_level,
      triage_category: triage.triage_category,
      triage_summary: triage.triage_summary,
      keywords_detected: triage.keywords_detected || [],
      status: 'triaged'
    });

    // 7. Audit: triaged
    await sbInsert('complaint_audit_log', {
      complaint_id: complaint.id,
      action: 'ai_triage_complete',
      actor_label: "Batch'd AI",
      details: {
        triage_level: triage.triage_level,
        triage_category: triage.triage_category,
        recall_flag: triage.recall_flag || false,
        severity_factors: triage.severity_factors || [],
        matches_found: { products: matches.products.length, stores: matches.stores.length, shipments: matches.shipments.length }
      }
    });

    // 8. Follow-up email
    if (customer_email) {
      try {
        await sendFollowUpEmail({ ...complaint, product_name, customer_name, customer_email, complaint_text, lang: lang || 'en' }, triage, org_name);
        const questions = selectFUQ(triage.triage_category, lang || 'en');
        await sbInsert('complaint_messages', {
          complaint_id: complaint.id, direction: 'outbound', channel: 'email',
          content: `Automated follow-up sent to ${customer_email}. Questions: ${questions.join(' | ')}`,
          sent_by: "Batch'd Triage (automated)"
        });
        await sbUpdate('complaints', 'id', complaint.id, { status: 'follow_up_sent' });
        await sbInsert('complaint_audit_log', {
          complaint_id: complaint.id, action: 'follow_up_email_sent',
          actor_label: "Batch'd Triage (automated)", details: { recipient: customer_email, lang: lang || 'en' }
        });
      } catch (e) { console.error('Follow-up email failed:', e.message); }
    }

    // 9. Critical alert
    if (triage.triage_level === 'critical' && (manufacturer_id || receiving_org_id)) {
      try {
        await sendCriticalAlert(
          { ...complaint, product_name, barcode, lot_number, best_before_date, customer_name, customer_email, customer_phone, complaint_text, store_name, purchase_city, purchase_state, country, people_affected, medical_attention, still_has_product },
          triage, matches, manufacturer_id || receiving_org_id, org_name
        );
        await sbInsert('complaint_audit_log', {
          complaint_id: complaint.id, action: 'critical_alert_sent',
          actor_label: "Batch'd Triage (automated)", details: { org_id: manufacturer_id || receiving_org_id }
        });
      } catch (e) { console.error('Critical alert failed:', e.message); }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        complaint_id: complaint.id,
        complaint_number: complaint.complaint_number,
        triage_level: triage.triage_level,
        triage_category: triage.triage_category,
        triage_summary: triage.triage_summary,
        recall_flag: triage.recall_flag || false,
        recall_flag_reason: triage.recall_flag_reason || null,
        severity_factors: triage.severity_factors || [],
        matches
      })
    };

  } catch (err) {
    console.error('triage-complaint error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
