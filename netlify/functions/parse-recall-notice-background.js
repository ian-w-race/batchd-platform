// netlify/functions/parse-recall-notice-background.js
//
// Improvement plan B1: read a supplier recall notice into a draft recall.
// A Netlify background function (the "-background" suffix): Netlify answers
// the caller 202 at once and lets this run for up to 15 minutes, so a long
// PDF never hits the 10 s limit of ordinary functions. The result is written
// to the recall_notices row, which the dashboard polls.
//
// Request: POST { notice_id }, Authorization: Bearer <user JWT>.
// The caller must be an active corp_admin of the notice's organization, and
// the organization must be on a plan with AI (pov or active), the same gate
// as ocr.js and ai-analyze.js. Every outcome, including refusal, lands on the
// row as status ready or failed.

const Anthropic = require('@anthropic-ai/sdk');
const { SUPABASE_URL, SVC_HEADERS, verifyUser, activeMembership, orgAiEnabled, isUuid } = require('../lib/auth');
const { MODEL, MAX_FILE_BYTES, NOTICE_SCHEMA, SYSTEM_PROMPT, buildContent, normalizeExtraction } = require('../lib/recall-notice');

const BUCKET = 'scan-photos';

async function loadNotice(id) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/recall_notices?id=eq.${id}&select=*&limit=1`, { headers: SVC_HEADERS });
  if (!r.ok) throw new Error('Could not load the notice (' + r.status + ')');
  return (await r.json())[0] || null;
}

async function updateNotice(id, patch) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/recall_notices?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...SVC_HEADERS, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) console.error('[parse-recall-notice] update failed', r.status, (await r.text()).slice(0, 200));
}

async function downloadFile(path) {
  const safe = String(path).split('/').map(encodeURIComponent).join('/');
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${safe}`, { headers: SVC_HEADERS });
  if (!r.ok) throw new Error('Could not read the uploaded file (' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_FILE_BYTES) throw new Error('The file is larger than 15 MB.');
  return buf.toString('base64');
}

async function readNotice(notice, client) {
  const fileBase64 = notice.file_path ? await downloadFile(notice.file_path) : null;
  const content = buildContent({ fileBase64, fileType: notice.file_type, fileName: notice.file_name, text: notice.raw_text });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: NOTICE_SCHEMA } },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The AI declined to read this document.');
  if (response.stop_reason === 'max_tokens') throw new Error('The notice is too long to read in one pass.');
  const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('The AI answer was not valid JSON.'); }
  return { extracted: normalizeExtraction(parsed), model: response.model || MODEL };
}

async function handler(event, deps = {}) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: '' }; }
  const id = body && body.notice_id;
  if (!isUuid(id)) return { statusCode: 400, body: '' };

  const notice = await loadNotice(id).catch(() => null);
  if (!notice || notice.status !== 'processing') return { statusCode: 404, body: '' };

  const user = await verifyUser(event);
  const member = user ? await activeMembership(user.id, notice.organisation_id) : null;
  if (!member || member.role !== 'corp_admin') {
    await updateNotice(id, { status: 'failed', error: 'Only a corporate admin of this organization can read notices.' });
    return { statusCode: 403, body: '' };
  }
  if (!(await orgAiEnabled(notice.organisation_id))) {
    await updateNotice(id, { status: 'failed', error: 'Reading notices with AI needs a pilot or paid plan. Enter the recall in the composer instead.' });
    return { statusCode: 403, body: '' };
  }

  try {
    const client = deps.client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { extracted, model } = await readNotice(notice, client);
    await updateNotice(id, { status: 'ready', extracted, model, error: null });
    return { statusCode: 200, body: '' };
  } catch (e) {
    console.error('[parse-recall-notice]', e && e.message);
    const msg = e instanceof Anthropic.APIError
      ? 'The AI service is unavailable (' + (e.status || 'error') + '). Try again in a few minutes.'
      : (e && e.message) || 'Reading the notice failed.';
    await updateNotice(id, { status: 'failed', error: String(msg).slice(0, 300) });
    return { statusCode: 500, body: '' };
  }
}

exports.handler = (event) => handler(event);
exports._test = { handler, readNotice };
