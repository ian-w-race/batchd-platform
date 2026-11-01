// src/shared/index.js
// Entry point of the shared bundle (/assets/batchd-shared.js, built by
// scripts/build.mjs). It is a classic script loaded synchronously near the
// top of every page, before the page creates its Supabase client, so it
// publishes what the pages read as plain globals. New shared rules are added
// here as modules under src/shared/ and exposed on window.Batchd.
import { install } from './env.js';
import * as fsma from './fsma.js';

const env = install({ location, document, window });
// The pages keep reading BATCHD_ENV, SUPABASE_URL, SUPABASE_KEY and
// batchdLink by name, exactly as when the block was inline.
Object.assign(window, env);
// FSMA 204 rules (A2 part 2): export headers, citations, applicability bands
// and copy, thresholds, the supplier completeness rule and the CSV cell guard.
window.Batchd = Object.assign(window.Batchd || {}, { env, fsma });
