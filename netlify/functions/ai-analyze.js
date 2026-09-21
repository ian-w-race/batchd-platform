// netlify/functions/ai-analyze.js
// General-purpose Anthropic analysis proxy for Batch'd intelligence features
// Tasks: synthesize_investigation | nl_query
//        (weekly_digest task retired 2026-05-27.)
//
// Auth (added 2026-05-27 after audit flagged this as an unauthenticated
// paid LLM endpoint — wallet-drain risk):
//   Caller must include `Authorization: Bearer <supabase_jwt>`. The JWT
//   is resolved to a Supabase user via /auth/v1/user, the user must be an
//   active member of the org named in the body, and that org must be on a
//   POV or Paying plan (organisations.plan). Public/unauth callers
//   get 401; valid sessions that aren't org members get 403.
//
// Body size cap: 200KB. nl_query schema strings can be large but never
// approach this; anything bigger is abuse.

const SUPABASE_URL         = 'https://lurxucdmrugikdlvvebc.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MAX_BODY_BYTES       = 200 * 1024; // 200 KB

const { requireAi, json } = require('../lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  // Body size cap — reject oversized payloads BEFORE parsing/forwarding to
  // the LLM. Stops a caller from burning Anthropic budget on huge prompts.
  const rawBody = event.body || '';
  if (rawBody.length > MAX_BODY_BYTES) {
    return { statusCode: 413, body: JSON.stringify({ error: 'Payload too large' }) };
  }

  let body;
  try { body = JSON.parse(rawBody); } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Auth: an active member of the org named in the body, and that org must be
  // on a POV or Paying plan. Anthropic spend is billed to Batch'd, so a JWT
  // alone is not enough — see netlify/lib/auth.js.
  const gate = await requireAi(event, body.org_id);
  if (gate.error) return json(gate.status, gate);

  const { task, data } = body;
  if (!task || !data) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing task or data' }) };
  }

  let prompt = '';
  let maxTokens = 800;
  let systemPrompt = "You are Batch'd, an AI assistant specialising in food traceability, recall management, and supply chain intelligence. Be precise, actionable, and concise. Write in plain English — no markdown headers, no bullet lists unless specifically requested.";

  if (task === 'synthesize_investigation') {
    const { investigation, responses } = data;
    if (!Array.isArray(responses)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'responses must be an array.' }) };
    }
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

  // 'weekly_digest' task removed 2026-05-27 along with the
  // dashboard's Weekly Digest panel and loadWeeklyDigest() function.
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
      console.error('[ai-analyze] anthropic error', res.status, (await res.text()).slice(0, 300));
      return { statusCode: 502, body: JSON.stringify({ error: 'Anthropic API error', detail: 'upstream error' }) };
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
