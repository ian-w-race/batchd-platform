// netlify/lib/job-log.js
// Wraps a scheduled function so each run is recorded in public.job_runs
// (migration 041): job name, Netlify site, start and finish, ok, HTTP status
// and the parsed result body. The daily health check reads these rows.
// Logging never changes the job's own result: a failed write is only logged
// to the console. Set BATCHD_JOB_LOG=off to disable (tests do).

const { SUPABASE_URL, SVC_HEADERS } = require('./auth');

async function writeRun(row) {
  if (process.env.BATCHD_JOB_LOG === 'off' || !process.env.SUPABASE_SERVICE_KEY) return;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/job_runs`, {
      method: 'POST',
      headers: { ...SVC_HEADERS, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) console.warn('[job-log] write failed', r.status);
  } catch (e) {
    console.warn('[job-log] write failed', e && e.message);
  }
}

function parseBody(body) {
  if (typeof body !== 'string' || !body) return null;
  try {
    const o = JSON.parse(body);
    const s = JSON.stringify(o);
    return s.length > 4000 ? { truncated: s.slice(0, 4000) } : o;
  } catch { return { text: body.slice(0, 500) }; }
}

function withJobLog(job, run) {
  return async (event, context) => {
    const started = new Date().toISOString();
    let res;
    try {
      res = await run(event, context);
    } catch (e) {
      await writeRun({ job, site: process.env.SITE_NAME || null, started_at: started,
        finished_at: new Date().toISOString(), ok: false, status_code: 500,
        detail: { error: String(e && e.message || e).slice(0, 500) } });
      throw e;
    }
    const detail = parseBody(res && res.body);
    // A run that skipped because scheduled functions are disabled on this
    // site is not recorded: only the site that really runs jobs reports.
    if (!(detail && detail.skipped)) {
      await writeRun({ job, site: process.env.SITE_NAME || null, started_at: started,
        finished_at: new Date().toISOString(), ok: !!res && res.statusCode < 400,
        status_code: res ? res.statusCode : null, detail });
    }
    return res;
  };
}

module.exports = { withJobLog, writeRun };
