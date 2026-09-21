// netlify/lib/auth.js
// Shared authentication for Netlify functions. Every check runs with the
// service-role key, so this module is the tenant boundary for functions.
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lurxucdmrugikdlvvebc.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const SVC_HEADERS  = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const UUID_RE      = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AI_PLANS     = ['pov', 'active'];

function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }

async function sbGet(pathAndQuery) {
  if (!SERVICE_KEY) return [];
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: SVC_HEADERS });
  return r.ok ? r.json() : [];
}

// Bearer JWT -> { id, email } or null. Verified server-side by Supabase Auth.
async function verifyUser(event) {
  const raw = event.headers?.authorization || event.headers?.Authorization || '';
  const jwt = raw.replace(/^Bearer\s+/i, '').trim();
  if (!jwt || !SERVICE_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id, email: (u.email || '').toLowerCase() } : null;
  } catch { return null; }
}

// Active membership row for user in org, or null.
async function activeMembership(userId, orgId) {
  if (!isUuid(userId) || !isUuid(orgId)) return null;
  const rows = await sbGet(`organisation_members?user_id=eq.${userId}&organisation_id=eq.${orgId}&active=not.is.false&select=role,is_batched_admin&limit=1`);
  return rows[0] || null;
}

async function isPlatformAdmin(userId) {
  if (!isUuid(userId)) return false;
  const rows = await sbGet(`organisation_members?user_id=eq.${userId}&is_batched_admin=eq.true&active=not.is.false&select=user_id&limit=1`);
  return rows.length > 0;
}

// The commercial flag: organisations.plan in ('pov','active').
async function orgAiEnabled(orgId) {
  if (!isUuid(orgId)) return false;
  const rows = await sbGet(`organisations?id=eq.${orgId}&select=plan&limit=1`);
  return !!rows[0] && AI_PLANS.includes(rows[0].plan);
}

// JWT + active membership in orgId (+ optional role list). No plan check.
async function requireMember(event, orgId, roles) {
  if (!isUuid(orgId)) return { status: 400, error: 'org_id required.' };
  const user = await verifyUser(event);
  if (!user) return { status: 401, error: 'Sign in required.' };
  const membership = await activeMembership(user.id, orgId);
  if (!membership || (roles && !roles.includes(membership.role))) {
    return { status: 403, error: 'Not a member of this organisation.' };
  }
  return { user, membership };
}

// requireMember + the org must be on a POV or Paying plan.
async function requireAi(event, orgId, roles) {
  const gate = await requireMember(event, orgId, roles);
  if (gate.error) return gate;
  if (!(await orgAiEnabled(orgId))) {
    return { status: 403, code: 'ai_disabled', error: 'AI features are not enabled for this organisation.' };
  }
  return gate;
}

// Server-to-server shared secret, constant-time. Fails closed when unset.
function internalSecretOk(given) {
  const expected = process.env.INTERNAL_NOTIFY_SECRET || '';
  if (!expected || typeof given !== 'string' || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'));
}

function json(statusCode, body, extraHeaders) {
  return { statusCode, headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) }, body: JSON.stringify(body) };
}

module.exports = { SUPABASE_URL, SERVICE_KEY, SVC_HEADERS, isUuid, sbGet, verifyUser, activeMembership,
                   isPlatformAdmin, orgAiEnabled, requireMember, requireAi, internalSecretOk, json };
