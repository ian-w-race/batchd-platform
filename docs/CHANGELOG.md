# Batch'd changelog

Newest first. One entry per change Ian ships: the date, what changed,
how it was verified and what is still unverified. Everything before
2026-10-24 is in docs/HISTORY.md.

## 2026-10-24
- Migration 032 (photo bucket) applied to STAGING only. Removes the six
  scan-photos storage policies (four of them let anyone list, upload,
  overwrite and delete) and adds three: a signed-in member may read,
  upload and overwrite only under orgs/<own org id prefix>/, nobody may
  delete through the API, photos keep loading by public URL. Verified on
  staging in rolled-back transactions: member uploads to own folder
  allowed, to another org or the bucket root denied, sees only own org's
  photos, overwrites own but not others or legacy photos, deletes 0;
  logged-out lists 0, uploads denied, overwrites 0, deletes 0. Control:
  with production's old rules restored, a logged-out visitor deleted 2 of
  2 test photos. Applied to PRODUCTION the same day: production's
  storage policies now match staging's exactly (same three rules, same
  fingerprints), all 108 photos remain, three sample photos (two in the
  org folder, one old root file) still load by public link with the same
  byte sizes, and logged-out listing dropped from 83 entries to 0. Not
  verified: a real signed-in scanner upload after the change.
- Migration 031 applied to production through the Supabase connector.
  It revokes public access to push_recall, create_organisation and
  get_retailer_emails, and anon access to sweep_recall_matches.
  push_recall had let any signed-in user push recalls into every
  retailer's dashboard; recall_events showed no sign of abuse. Verified:
  privilege check (anon and signed-in false on the first three, signed-in
  true on the sweep), anon REST probes answer 42501, and
  get_invitation_by_token still answers 200 for the join page. Not
  verified: a signed-in scanner session calling the sweep.
- Moved to a git workflow. The repo is cloned at ~/Desktop/batchd-platform,
  changes go through a branch, a pull request and a Netlify deploy
  preview, and Ian merges.
- CLAUDE.md cut from 2,175 lines to rules, current state and gotchas.
  The old file is kept word for word in docs/HISTORY.md.
- Shipped to main earlier the same day (commit a22ad17): the scanner
  design pass, the dashboard's styled confirm dialogs, CTA icons and
  keyboard support, and SMOKE.md checks 46 and 47. Verified live:
  dashboard byte for byte, scanner apart from Netlify's link rewrite.
  Smoke checks 46 and 47 not yet run.
