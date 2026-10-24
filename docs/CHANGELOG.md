# Batch'd changelog

Newest first. One entry per change Ian ships: the date, what changed,
how it was verified and what is still unverified. Everything before
2026-10-24 is in docs/HISTORY.md.

## 2026-10-24
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
