// src/shared/env.js
// Database selection, same-origin links and the staging badge. One copy for
// every page since 2026-11-01 (improvement plan A2); before that the block
// below lived inline in six pages and scripts/check.mjs compared the copies.
// scripts/build.mjs bundles src/shared/index.js into /assets/batchd-shared.js,
// which each page loads before it creates its Supabase client.
//
// The real domains use production. Netlify deploy previews and branch
// deploys (any "name--site.netlify.app" host) and the local test server use
// the staging project, so testing a pull request never touches customer data.
// See CLAUDE.md, "How we work".

export const PRODUCTION_URL = 'https://lurxucdmrugikdlvvebc.supabase.co';
export const STAGING_URL = 'https://tiwrrocdwljazweveeth.supabase.co';
// Anon keys: public by design, RLS-protected (CLAUDE.md, "Golden rules").
export const PRODUCTION_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1cnh1Y2RtcnVnaWtkbHZ2ZWJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNTU5NTQsImV4cCI6MjA4OTgzMTk1NH0.ewNhBbF8nUzpF9Ve822D9t8VLwB_hjk27KuFFEXct0A';
export const STAGING_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpd3Jyb2Nkd2xqYXp3ZXZlZXRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4MzQ4ODcsImV4cCI6MjEwODQxMDg4N30.OfjEU4oprGZmvm2dLmUnZDD7k7KP9bycS7FwXqhgIjc';

// 'staging' for localhost, 127.0.0.1 and any Netlify preview or branch host;
// 'production' for everything else, including look-alike hosts elsewhere.
export function detectEnv(hostname) {
  var h = String(hostname || '');
  if (h === 'localhost' || h === '127.0.0.1' || /--[a-z0-9-]+\.netlify\.app$/.test(h)) return 'staging';
  return 'production';
}

// On a staging host, a link or window.open target aimed at a production app
// is rewritten onto this origin, so a click never leaves staging.
const PREVIEW_MAP = [
  ['https://corporate.batchdapp.com/dashboard.html', '/dashboard.html'],
  ['https://corporate.batchdapp.com/', '/dashboard.html'],
  ['https://app.batchdapp.com/dashboard.html', '/dashboard.html'],
  ['https://app.batchdapp.com/manufacturer.html', '/manufacturer.html'],
  ['https://app.batchdapp.com/retail', '/retail'],
  ['https://app.batchdapp.com/scan', '/scan'],
  ['https://app.batchdapp.com/login', '/login'],
  ['https://app.batchdapp.com/signup', '/signup'],
  ['https://batchd-app.netlify.app', '/'],
];
export function previewUrlFor(u, origin) {
  if (typeof u !== 'string') return u;
  for (var i = 0; i < PREVIEW_MAP.length; i++) {
    if (u.indexOf(PREVIEW_MAP[i][0]) === 0) {
      var rest = u.slice(PREVIEW_MAP[i][0].length);
      if (PREVIEW_MAP[i][1] === '/' && rest.charAt(0) === '/') rest = rest.slice(1);
      return origin + PREVIEW_MAP[i][1] + rest;
    }
  }
  return u;
}

function addBadge(document) {
  var b = document.createElement('div');
  b.id = 'batchd-staging-badge';
  b.textContent = 'Staging database · test data only';
  b.setAttribute('role', 'status');
  b.setAttribute('style', "position:fixed;left:12px;bottom:12px;z-index:2147483000;pointer-events:none;"
    + "font-family:'DM Mono',monospace;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;"
    + "padding:5px 10px;border-radius:999px;background:var(--warn, #F5A623);color:var(--background-base, #080F12);");
  document.body.appendChild(b);
}

// Sets up a page: returns the values the pages read as globals (BATCHD_ENV,
// SUPABASE_URL, SUPABASE_KEY, batchdLink) and, on staging, installs the badge
// and the link rewriter (window.batchdPreviewUrl). `g` is { location, document,
// window } so the tests can pass stand-ins.
export function install(g) {
  var env = detectEnv(g.location.hostname);
  var values = {
    BATCHD_ENV: env,
    SUPABASE_URL: env === 'staging' ? STAGING_URL : PRODUCTION_URL,
    SUPABASE_KEY: env === 'staging' ? STAGING_ANON_KEY : PRODUCTION_ANON_KEY,
    // Same-origin links on staging hosts; the production URL everywhere else.
    batchdLink: function (productionUrl, stagingPath) { return env === 'staging' ? stagingPath : productionUrl; },
  };
  if (env === 'staging') {
    var document = g.document, window = g.window, location = g.location;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { addBadge(document); });
    else addBadge(document);
    // location.replace cannot be intercepted; those call sites use batchdLink() directly.
    window.batchdPreviewUrl = function (u) { return previewUrlFor(u, location.origin); };
    var _open = window.open;
    window.open = function (u) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = window.batchdPreviewUrl(u);
      return _open.apply(window, args);
    };
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (a) { var r = window.batchdPreviewUrl(a.getAttribute('href')); if (r !== a.getAttribute('href')) a.setAttribute('href', r); }
    }, true);
  }
  return values;
}
