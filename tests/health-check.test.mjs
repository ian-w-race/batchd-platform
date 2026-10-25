// Monitoring (improvement plan A4): the health check's rules and the job run
// logger. Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.SUPABASE_SERVICE_KEY = 'svc';
const { evaluate } = require('../netlify/functions/health-check.js')._test;

const NOW = Date.parse('2026-10-26T07:00:00Z');
const ago = (h) => new Date(NOW - h * 3600e3).toISOString();
const healthy = () => ({
  runs: [
    { job: 'fetch-recall-feeds', started_at: ago(1), ok: true, detail: { fda_added: 3 } },
    { job: 'recall-escalation', started_at: ago(0.4), ok: true },
    { job: 'health-check', started_at: ago(24), ok: true },
  ],
  stuck: [], failedNotices: [], newestFdaAt: ago(48),
});

test('a healthy day raises nothing', () => {
  assert.deepEqual(evaluate(NOW, healthy()), []);
});

test('a missed FDA import, a stale FDA feed and a stalled escalation are each reported', () => {
  const d = healthy();
  d.runs = d.runs.filter((r) => r.job !== 'fetch-recall-feeds');
  d.runs.find((r) => r.job === 'recall-escalation').started_at = ago(3);
  d.newestFdaAt = ago(24 * 30);
  const p = evaluate(NOW, d);
  assert.equal(p.length, 3, p.join('\n'));
  assert.match(p[0], /FDA recall import has not completed/);
  assert.match(p[1], /newest FDA recall on file/);
  assert.match(p[2], /escalation job/);
});

test('failed runs are grouped by job with the latest error', () => {
  const d = healthy();
  d.runs.unshift({ job: 'recall-escalation', started_at: ago(0.2), ok: false, status_code: 500, detail: { error: 'boom' } },
                 { job: 'recall-escalation', started_at: ago(0.7), ok: false, status_code: 500, detail: { error: 'older' } });
  const p = evaluate(NOW, d);
  assert.equal(p.length, 1);
  assert.match(p[0], /recall-escalation failed 2 times.*boom/);
});

test('a skipped health check day and stuck or failed notices are reported', () => {
  const d = healthy();
  d.runs.find((r) => r.job === 'health-check').started_at = ago(50);
  d.stuck = [{ id: 'a' }, { id: 'b' }];
  d.failedNotices = [{ id: 'c', error: 'The AI service is unavailable (529).' }];
  const p = evaluate(NOW, d);
  assert.equal(p.length, 3, p.join('\n'));
  assert.match(p.join(' '), /did not run the previous day/);
  assert.match(p.join(' '), /2 supplier recall notices have been "reading"/);
  assert.match(p.join(' '), /could not be read.*529/);
});

test('the very first run, with no history, does not complain about itself', () => {
  const d = healthy();
  d.runs = d.runs.filter((r) => r.job !== 'health-check');
  assert.deepEqual(evaluate(NOW, d), []);
});

// ── Job run logger ──────────────────────────────────────────────────────────
function loadLogger() {
  for (const p of ['../netlify/lib/job-log.js', '../netlify/lib/auth.js']) delete require.cache[require.resolve(p)];
  return require('../netlify/lib/job-log.js');
}
function captureFetch(status = 201) {
  const rows = [];
  global.fetch = async (url, opts) => { if (String(url).includes('/rest/v1/job_runs')) rows.push(JSON.parse(opts.body)); return { ok: status < 300, status }; };
  return rows;
}

test('the logger records ok and failed results without changing them', async () => {
  delete process.env.BATCHD_JOB_LOG;
  const rows = captureFetch();
  const { withJobLog } = loadLogger();
  const okRes = await withJobLog('demo', async () => ({ statusCode: 200, body: JSON.stringify({ fda_added: 2 }) }))({});
  const badRes = await withJobLog('demo', async () => ({ statusCode: 500, body: 'not json' }))({});
  assert.equal(okRes.statusCode, 200);
  assert.equal(badRes.statusCode, 500);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ok, true);
  assert.deepEqual(rows[0].detail, { fda_added: 2 });
  assert.equal(rows[1].ok, false);
  assert.deepEqual(rows[1].detail, { text: 'not json' });
});

test('skipped runs are not recorded, a thrown error is recorded and rethrown, and a failed write is harmless', async () => {
  delete process.env.BATCHD_JOB_LOG;
  let rows = captureFetch();
  const { withJobLog } = loadLogger();
  await withJobLog('demo', async () => ({ statusCode: 200, body: JSON.stringify({ skipped: 'disabled' }) }))({});
  assert.equal(rows.length, 0);
  await assert.rejects(withJobLog('demo', async () => { throw new Error('crash'); })({}), /crash/);
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].detail.error, 'crash');
  rows = captureFetch(500);
  const res = await withJobLog('demo', async () => ({ statusCode: 200, body: '{}' }))({});
  assert.equal(res.statusCode, 200);
});

test('BATCHD_JOB_LOG=off writes nothing', async () => {
  process.env.BATCHD_JOB_LOG = 'off';
  const rows = captureFetch();
  const { withJobLog } = loadLogger();
  await withJobLog('demo', async () => ({ statusCode: 200, body: '{}' }))({});
  assert.equal(rows.length, 0);
  delete process.env.BATCHD_JOB_LOG;
});
