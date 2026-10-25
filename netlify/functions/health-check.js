// netlify/functions/health-check.js
//
// Improvement plan A4: a daily health check (07:00 UTC, an hour after the FDA
// import; schedule in netlify.toml). It reads job_runs (migration 041) and a
// few tables, and emails Batch'd's platform admins (organisation_members with
// is_batched_admin) only when something is wrong:
//   - the FDA import has not completed in 26 hours, or its newest recall is
//     older than 21 days (the feed itself may have stopped);
//   - the escalation job has not completed in 2 hours;
//   - any job run failed in the last 24 hours;
//   - the health check itself did not run the day before;
//   - supplier notices are stuck "reading" for over 30 minutes, or failed.
// ALERT_EMAIL (comma separated) adds or replaces recipients when set.
// Honors SCHEDULED_FUNCTIONS_DISABLED, so only the site that runs the
// scheduled jobs sends alerts. Deletes job_runs rows older than 90 days.

const { SUPABASE_URL, SVC_HEADERS } = require('../lib/auth');
const { withJobLog } = require('../lib/job-log');

const HOUR = 3600e3;
const LIMITS = { fdaImportHours: 26, escalationHours: 2, healthHours: 26, stuckNoticeMinutes: 30, fdaStaleDays: 21 };

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SVC_HEADERS, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`${path.split('?')[0]} ${r.status}`);
  return r.json();
}

async function gather(now) {
  const since = new Date(now - 3 * 24 * HOUR).toISOString();
  const [runs, stuck, failedNotices, newestFda] = await Promise.all([
    sbGet(`job_runs?started_at=gte.${encodeURIComponent(since)}&select=job,site,started_at,finished_at,ok,status_code,detail&order=started_at.desc&limit=1000`),
    sbGet(`recall_notices?status=eq.processing&created_at=lt.${encodeURIComponent(new Date(now - LIMITS.stuckNoticeMinutes * 60e3).toISOString())}&select=id,created_at&limit=50`),
    sbGet(`recall_notices?status=eq.failed&updated_at=gte.${encodeURIComponent(new Date(now - 24 * HOUR).toISOString())}&select=id,error&limit=50`),
    sbGet(`recalls?source=eq.fda&select=created_at&order=created_at.desc&limit=1`),
  ]);
  return { runs, stuck, failedNotices, newestFdaAt: newestFda[0]?.created_at || null };
}

// Pure: turn the gathered data into a list of problems (plain sentences).
function evaluate(now, { runs, stuck, failedNotices, newestFdaAt }) {
  const problems = [];
  const fmt = (iso) => iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'never in the last 3 days';
  const lastOk = (job) => runs.filter((r) => r.job === job && r.ok).sort((a, b) => b.started_at.localeCompare(a.started_at))[0];

  const fda = lastOk('fetch-recall-feeds');
  if (!fda || now - Date.parse(fda.started_at) > LIMITS.fdaImportHours * HOUR) {
    problems.push(`The daily FDA recall import has not completed since ${fmt(fda?.started_at)}.`);
  }
  if (newestFdaAt && now - Date.parse(newestFdaAt) > LIMITS.fdaStaleDays * 24 * HOUR) {
    problems.push(`The newest FDA recall on file is from ${newestFdaAt.slice(0, 10)}. The FDA feed may have stopped publishing or changed format.`);
  }
  const esc = lastOk('recall-escalation');
  if (!esc || now - Date.parse(esc.started_at) > LIMITS.escalationHours * HOUR) {
    problems.push(`The recall escalation job (every 30 minutes) has not completed since ${fmt(esc?.started_at)}. Stores with unacknowledged recalls are not being chased.`);
  }
  const prevHealth = runs.filter((r) => r.job === 'health-check').sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  if (runs.length && prevHealth && now - Date.parse(prevHealth.started_at) > LIMITS.healthHours * HOUR) {
    problems.push(`The health check did not run the previous day (last run ${fmt(prevHealth.started_at)}).`);
  }
  const dayAgo = now - 24 * HOUR;
  const failed = runs.filter((r) => r.ok === false && Date.parse(r.started_at) >= dayAgo);
  const byJob = {};
  failed.forEach((r) => { (byJob[r.job] = byJob[r.job] || []).push(r); });
  Object.entries(byJob).forEach(([job, list]) => {
    const err = list[0].detail?.error || list[0].detail?.text || `HTTP ${list[0].status_code}`;
    problems.push(`${job} failed ${list.length} time${list.length === 1 ? '' : 's'} in the last 24 hours. Latest error: ${String(err).slice(0, 200)}`);
  });
  if (stuck.length) {
    problems.push(`${stuck.length} supplier recall notice${stuck.length === 1 ? ' has' : 's have'} been "reading" for over ${LIMITS.stuckNoticeMinutes} minutes. The notice-reading function may be failing.`);
  }
  if (failedNotices.length) {
    const reasons = [...new Set(failedNotices.map((n) => n.error).filter(Boolean))].slice(0, 3).join(' | ');
    problems.push(`${failedNotices.length} supplier recall notice${failedNotices.length === 1 ? '' : 's'} could not be read in the last 24 hours. ${reasons}`);
  }
  return problems;
}

async function recipients() {
  if (process.env.ALERT_EMAIL) {
    return process.env.ALERT_EMAIL.split(',').map((s) => s.trim()).filter((s) => /@/.test(s));
  }
  const admins = await sbGet('organisation_members?is_batched_admin=eq.true&active=not.is.false&select=user_id');
  const ids = [...new Set(admins.map((a) => a.user_id))].slice(0, 10);
  const emails = [];
  for (const id of ids) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers: SVC_HEADERS, signal: AbortSignal.timeout(5000) });
    if (r.ok) { const u = await r.json(); if (u?.email) emails.push(u.email); }
  }
  return [...new Set(emails)];
}

async function sendAlert(to, problems) {
  const lines = problems.map((p, i) => `${i + 1}. ${p}`).join('\n');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: "Batch'd Monitoring <alerts@batchdapp.com>",
      to,
      subject: `Batch'd health check: ${problems.length} problem${problems.length === 1 ? '' : 's'}`,
      text: `The daily Batch'd health check found:\n\n${lines}\n\nDetails are in the job_runs table and the Netlify function logs.\nThis email is sent only when something needs attention.`,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error('Alert email refused: ' + r.status);
}

async function prune(now) {
  const cutoff = new Date(now - 90 * 24 * HOUR).toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/job_runs?started_at=lt.${encodeURIComponent(cutoff)}`, {
    method: 'DELETE', headers: { ...SVC_HEADERS, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

const run = async () => {
  if (process.env.SCHEDULED_FUNCTIONS_DISABLED === 'true') {
    return { statusCode: 200, body: JSON.stringify({ skipped: 'scheduled functions disabled on this site' }) };
  }
  const now = Date.now();
  const problems = evaluate(now, await gather(now));
  let alerted = [];
  if (problems.length) {
    alerted = await recipients();
    if (alerted.length) await sendAlert(alerted, problems);
  }
  await prune(now);
  return { statusCode: 200, body: JSON.stringify({ problems, alerted: alerted.length }) };
};

exports.handler = withJobLog('health-check', run);
exports._test = { evaluate, run, LIMITS };
