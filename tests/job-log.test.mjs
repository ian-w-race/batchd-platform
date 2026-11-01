// Monitoring (improvement plan A4): the on-demand email functions record a
// failed send in job_runs through logFailure. Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.SUPABASE_SERVICE_KEY = 'svc';
process.env.SITE_NAME = 'test-site';
delete process.env.BATCHD_JOB_LOG;
const { failureRow, logFailure } = require('../netlify/lib/job-log.js');

test('a failure row is ok=false with the job, the site and a trimmed error', () => {
  const row = failureRow('push-recall-email', { error: 'x'.repeat(900), org: 'QA Grocer' }, 422);
  assert.equal(row.job, 'push-recall-email');
  assert.equal(row.site, 'test-site');
  assert.equal(row.ok, false);
  assert.equal(row.status_code, 422);
  assert.equal(row.detail.error.length, 500);
  assert.equal(row.detail.org, 'QA Grocer');
  assert.ok(row.started_at && row.finished_at);
  // A bare string or an Error becomes the error text; no status means 500.
  assert.deepEqual(failureRow('notify-event', 'boom').detail, { error: 'boom' });
  assert.equal(failureRow('notify-event', 'boom').status_code, 500);
});

test('logFailure posts the row to job_runs and never throws', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  try {
    await logFailure('send-invite', { error: 'Resend 500' }, 500);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rest\/v1\/job_runs$/);
    assert.equal(calls[0].body.job, 'send-invite');
    assert.equal(calls[0].body.ok, false);
    // A failing write is swallowed: the email function's own answer is unchanged.
    globalThis.fetch = async () => { throw new Error('network down'); };
    await logFailure('send-invite', { error: 'again' });
  } finally {
    globalThis.fetch = realFetch;
  }
});
