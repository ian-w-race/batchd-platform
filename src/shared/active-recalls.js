// src/shared/active-recalls.js
// The one list of active recalls (improvement plan B4, stage 4, 2026-11-08).
// The database function batchd_active_recalls(p_org) returns manual, pushed
// and feed recalls in one row shape (migration 043); this module turns those
// rows into the shape the scanner has always cached (_cachedActiveRecalls)
// and keeps the two small rules every reader shares. Exposed as
// window.Batchd.activeRecalls.
//
//   normalizeActiveRecalls(rows, opts)  function rows -> cache objects
//   exactIdentifierHit(scan, recall)    the strict equal-lot-or-barcode rule
//                                       the reports use (CLAUDE.md counting rule)
//   matchIdColumns(recall, linkedId)    which id columns a scan_recall_matches
//                                       row carries for this recall
//
// A cache object: { id, _kind, product_name, lot_number, lots, barcode_number,
// gtins, description, reason, severity, source, published_at, recalling_firm,
// active: true, _dismissed, _matched, _linkedRecalls }. `id` is the recalls
// id (manual), the recall_events id (pushed) or the recall_catalog id (feed).
// `lots` holds every lot: a pushed recall's linked rows, a feed entry's parsed
// lots; `lot_number` stays the first one for screens that show one.

import lotCodes from './lot-codes.cjs';

const clean = (v) => (v === undefined || v === null || v === '' ? null : v);
const rangeList = (v) => (Array.isArray(v) ? v.filter((r) => r && typeof r.from === 'string' && typeof r.to === 'string') : []);
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim() !== '') : []);

export function kindId(row) {
  if (!row) return null;
  if (row.kind === 'manual') return row.recall_id || null;
  if (row.kind === 'pushed') return row.event_id || null;
  if (row.kind === 'feed') return row.catalog_id || null;
  return null;
}

export function normalizeActiveRecalls(rows, opts = {}) {
  const includeDismissed = !!opts.includeDismissed;
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const id = kindId(row);
    if (!id || seen.has(id)) continue;
    if (row.kind === 'feed' && row.dismissed && !includeDismissed) continue;
    seen.add(id);
    const lots = list(row.lots);
    out.push({
      id,
      _kind: row.kind,
      product_name: clean(row.product_name),
      lot_number: clean(row.lot_number) || lots[0] || null,
      lots,
      barcode_number: clean(row.barcode),
      gtins: list(row.gtins),
      // B5 stage 1: what else a store can match on, and where the entry came from.
      lot_ranges: rangeList(row.lot_ranges),
      best_by_from: clean(row.best_by_from),
      best_by_to: clean(row.best_by_to),
      all_lots: !!row.all_lots,
      match_terms: list(row.match_terms),
      _feedKind: clean(row.kind),
      notice_url: clean(row.notice_url),
      _covered: !!row.covered,
      description: clean(row.description),
      reason: clean(row.reason),
      severity: clean(row.severity),
      source: clean(row.source) || (row.kind === 'pushed' ? 'manufacturer_push' : 'manual'),
      published_at: clean(row.published_at),
      recalling_firm: clean(row.recalling_firm),
      active: true,
      _dismissed: !!row.dismissed,
      _matched: !!row.matched,
      _linkedRecalls: [],
    });
  }
  return out;
}

// Every lot a recall names, lower-cased and trimmed: the lots list when it
// has one, else the single lot_number.
export function recallLots(recall) {
  const src = recall && Array.isArray(recall.lots) && recall.lots.length ? recall.lots : [recall && recall.lot_number];
  return src.map((l) => (l || '').toString().toLowerCase().trim()).filter(Boolean);
}

// Every barcode a recall names: barcode_number plus any GTINs.
export function recallBarcodes(recall) {
  const src = [recall && recall.barcode_number].concat((recall && Array.isArray(recall.gtins)) ? recall.gtins : []);
  return src.map((b) => (b || '').toString().toLowerCase().trim()).filter(Boolean);
}

// The strict rule the multi-store tile, the shift summary and the audit
// report apply: the scan's lot equals one of the recall's lots or sits inside
// one of its printed lot ranges, or the scan's barcode equals one of its
// barcodes. No substring, no product match, no dates.
export function exactIdentifierHit(scan, recall) {
  if (!scan || !recall) return false;
  const sLot = (scan.lot_number || '').toString().toLowerCase().trim();
  const sBc = (scan.barcode_number || '').toString().toLowerCase().trim();
  if (sLot && recallLots(recall).includes(sLot)) return true;
  if (sLot && Array.isArray(recall.lot_ranges) && recall.lot_ranges.some((r) => lotCodes.lotInRange(sLot, r))) return true;
  return !!sBc && recallBarcodes(recall).includes(sBc);
}

// Which id columns a scan_recall_matches row carries (CLAUDE.md, "two paths",
// plus the catalog path since migration 043):
//   manual  recall_id = recalls.id
//   pushed  recall_id = the linked recalls row for the lot (the foreign key),
//           recall_event_id = the event; without a linked row no row can be
//           written, so null is returned
//   feed    catalog_id = recall_catalog.id
export function matchIdColumns(recall, linkedRecallId) {
  if (!recall || !recall.id) return null;
  const kind = recall._kind || (recall.source === 'manufacturer_push' ? 'pushed' : 'manual');
  if (kind === 'pushed') {
    return linkedRecallId ? { recall_id: linkedRecallId, recall_event_id: recall.id, catalog_id: null } : null;
  }
  if (kind === 'feed') return { recall_id: null, recall_event_id: null, catalog_id: recall.id };
  return { recall_id: recall.id, recall_event_id: null, catalog_id: null };
}
