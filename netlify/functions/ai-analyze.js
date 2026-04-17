// netlify/functions/ai-analyze.js
// General-purpose Anthropic analysis proxy for Batch'd intelligence features
// Tasks: synthesize_investigation | weekly_digest | nl_query

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { task, data } = body;
  if (!task || !data) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing task or data' }) };
  }

  let prompt = '';
  let maxTokens = 800;
  let systemPrompt = "You are Batch'd, an AI assistant specialising in food traceability, recall management, and supply chain intelligence. Be precise, actionable, and concise. Write in plain English — no markdown headers, no bullet lists unless specifically requested.";

  if (task === 'synthesize_investigation') {
    const { investigation, responses } = data;
    const foundCount   = responses.filter(r => r.issue_found).length;
    const totalCount   = responses.length;
    const issueDetails = responses.filter(r => r.issue_found).map(r =>
      `${r.store_name||'Unknown store'}: ${r.issue_description||'Issue found, no details given'}${r.units_affected ? ` (${r.units_affected} units affected)` : ''}`
    ).join('\n');
    const cleanDetails = responses.filter(r => !r.issue_found).map(r =>
      `${r.store_name||'Unknown store'}: ${r.issue_description||'No issue found'}`
    ).join('\n');

    prompt = `You are analysing a field investigation for a food product issue.

INVESTIGATION DETAILS:
Product: ${investigation.product_name || 'Unknown'}
Lot number: ${investigation.lot_number || 'Not specified'}
Issue type: ${investigation.issue_type || 'Not specified'}
Description: ${investigation.issue_description || 'Not specified'}
Urgency: Class ${investigation.urgency_class || '—'}
${investigation.instructions ? `Inspector instructions: ${investigation.instructions}` : ''}

FIELD RESPONSES (${totalCount} total):
Stores reporting issues (${foundCount}):
${issueDetails || 'None'}

Stores reporting clean (${totalCount - foundCount}):
${cleanDetails || 'None'}

Write a concise findings summary (3-4 sentences maximum) that:
1. States whether the issue is confirmed, partial, or unconfirmed
2. Describes the geographic/store pattern if any
3. States the recommended next action (recall escalation, close, or continue monitoring)

Do not use any markdown, headers, or bullet points. Write as a single paragraph.`;
    maxTokens = 300;

  } else if (task === 'weekly_digest') {
    const { orgName, region, weekData } = data;
    const isUS = region === 'us';
    prompt = `You are writing a weekly intelligence digest for ${orgName}, a grocery retailer using Batch'd for food traceability.

WEEK IN REVIEW (last 7 days):
- New scans: ${weekData.newScans}
- Active recalls: ${weekData.activeRecalls}
- Recall response rate: ${weekData.responseRate}%
- Dark stores (no scanning): ${weekData.darkStores?.join(', ') || 'None'}
- New complaints: ${weekData.newComplaints}
- Complaint clusters detected: ${weekData.clusters || 0}
- Investigations open: ${weekData.openInvestigations}
- Drill compliance: ${weekData.drillCompliant ? 'Current' : 'Overdue'}
- Lot capture rate: ${weekData.lotCaptureRate}%
- Regulatory framework: ${isUS ? 'FDA / FSMA 204' : 'EU 178/2002 / Mattilsynet'}

Write a 2-3 sentence weekly digest that reads like a briefing from a food safety officer. Lead with the most important item. Be direct — if something needs attention, say so plainly. End with one forward-looking sentence about what to watch next week. No markdown, no headers, no bullet points. Plain paragraph only.`;
    maxTokens = 200;

  } else if (task === 'nl_query') {
    const { question, schema } = data;
    prompt = `You are a Supabase SQL query assistant for Batch'd, a food traceability platform. The user wants to query their data in plain English.

DATABASE SCHEMA (relevant tables only):
${schema}

USER QUESTION: "${question}"

Respond with a JSON object only, no markdown, no explanation:
{
  "understood": "one sentence describing what you understood the user wants",
  "table": "primary table to query (scans|complaints|shipments|recalls|recall_acknowledgements|stores)",
  "filters": { "column": "value" },
  "orderBy": { "column": "created_at", "ascending": false },
  "limit": 50,
  "select": "columns to select",
  "summary": "one sentence describing what the results will show"
}

If the question cannot be answered from available data, return:
{"error": "brief explanation of why this cannot be answered"}`;
    maxTokens = 400;

  } else {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown task: ' + task }) };
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Anthropic API error', detail: err }) };
    }

    const json = await res.json();
    const text = json.content?.[0]?.text || '';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ result: text }),
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
