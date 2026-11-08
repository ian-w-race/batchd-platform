// src/shared/index.js
// Entry point of the shared bundle (/assets/batchd-shared.js, built by
// scripts/build.mjs). It is a classic script loaded synchronously near the
// top of every page, before the page creates its Supabase client, so it
// publishes what the pages read as plain globals. New shared rules are added
// here as modules under src/shared/ and exposed on window.Batchd.
import { install } from './env.js';
import * as fsma from './fsma.js';
import * as gs1 from './gs1.js';
import * as ftl from './ftl.js';
import * as recall from './recall-match.js';
import * as activeRecalls from './active-recalls.js';

const env = install({ location, document, window });
// The pages keep reading BATCHD_ENV, SUPABASE_URL, SUPABASE_KEY and
// batchdLink by name, exactly as when the block was inline.
Object.assign(window, env);
// FSMA 204 rules (A2 part 2): export headers, citations, applicability bands
// and copy, thresholds, the supplier completeness rule and the CSV cell guard.
// A2 part 3: the GS1 parser (gs1), the listed-food categories and detector
// (ftl) and the recall matcher (recall). B4 stage 4: the one list of active
// recalls (activeRecalls) that the rows of batchd_active_recalls become.
window.Batchd = Object.assign(window.Batchd || {}, { env, fsma, gs1, ftl, recall, activeRecalls });
