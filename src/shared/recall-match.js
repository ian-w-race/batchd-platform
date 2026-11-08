// src/shared/recall-match.js
// How a scan is matched against a recall (improvement plan A2 part 3,
// 2026-11-01), moved verbatim from index.html. Exposed as window.Batchd.recall.
//   recallMatchLevel(scan, recall, log?)  'exact' (red) | 'possible' (orange) | null
//   checkRecordAgainstRecalls(scan, recalls, log?)  the highest level over a list
//   fuzzyProductMatch, levenshtein          the product-name corroboration
// `log` is an optional callback (scan, recall, matchType, matchedOn) the
// scanner uses for its debug match log. CLAUDE.md's counting rule: a recall
// requires action on an exact lot or barcode match to an on-shelf scan.
// The Norwegian stop words are part of the frozen NO layer; leave them.
// B5 stage 1 (2026-11-08): a recall's lot ranges and best-by window match
// too (src/shared/lot-codes.cjs; Ian's decisions 2 and 3 of the B5 plan).
import { extractBestBefore } from './gs1.js';
import lotCodes from './lot-codes.cjs';

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({length: m+1}, (_, i) => Array.from({length: n+1}, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

export function fuzzyProductMatch(recallProduct, scanProduct) {
  if (!recallProduct) return false; // recall with no product name should not match anything
  if (!scanProduct)   return false;

  const a = recallProduct.toLowerCase();
  const b = scanProduct.toLowerCase();

  // Description-style recall product_names (FDA / Mattilsynet feed entries
  // that stuff the entire recall notice into product_name) are too noisy to
  // drive a fuzzy match alone. Pre-fix this would loosely match any scan
  // sharing a common English word with the description, producing false-
  // positive "possible" matches like a milk scan triggering a beef recall.
  // For these long entries, we ONLY trust the lot substring path in
  // recallMatchLevel — fuzzyProductMatch returns false here and the caller
  // can still match if the recall lot is found in raw_capture.
  if (a.length > 80) return false;

  // 1. Exact substring match (both directions, stripped)
  const STOP_RE = /\b(tilbakekaller?|recalls?|sa\b|as\b|aps\b|ltd\b|inc\b|og\b|av\b|med\b|fra\b|til\b|for\b|the\b|and\b|de\b|la\b|le\b|van\b)/g;
  const aCore = a.replace(STOP_RE, '').replace(/\s+/g,' ').trim();
  const bCore = b.replace(STOP_RE, '').replace(/\s+/g,' ').trim();
  // Guard against empty cores — `''.includes('')` returns true and would
  // false-match every scan if either core ended up empty after stopword
  // stripping.
  if (aCore && bCore && (bCore.includes(aCore) || aCore.includes(bCore))) return true;

  // 2. Shared meaningful words — require an EXACT whole-word match (case-
  //    insensitive). The pre-fix substring rule (`bw.includes(w)` either
  //    direction) was the main false-positive vector: a recall token like
  //    "expires" could substring-match any scan word containing those
  //    letters, and reversed even short scan words could substring-match
  //    long recall tokens. Whole-word equality eliminates this.
  const BRAND_STOPWORDS = new Set(['nortura','tine','gilde','coop','bama','rema','kiwi','meny','asko','orkla',
    'lerøy','marine','farms','foods','brand','group','nordic','norge','norsk','fresh','daily','royal',
    'premium','select','extra','super','light','store','little','great','best','good','fine',
    // Generic feed-description noise words — these appear in long FDA /
    // Mattilsynet entries and were producing cross-product false positives.
    'frozen','shelf','life','days','date','manufactur','expires','product','products','contains',
    'manufactured','distributed','grunn','produktene','inneholde','tilbake','gjelder','følgende']);
  const aWords = a.split(/[^a-z0-9æøå]+/).filter(w => w.length >= 5 && !BRAND_STOPWORDS.has(w));
  const bWords = b.split(/[^a-z0-9æøå]+/).filter(w => w.length >= 5 && !BRAND_STOPWORDS.has(w));

  if (aWords.length === 0 || bWords.length === 0) return false;

  const bSet = new Set(bWords);
  for (const w of aWords) {
    if (bSet.has(w)) return true;
  }
  return false;
}

// Every lot a recall names (the `lots` list when it has one, else the single
// lot_number) and every barcode (barcode_number plus GTINs), lower-cased.
// B4 stage 4 (2026-11-08): a pushed recall with several lots and a feed entry
// with parsed lots match on any of them, not only the first.
function _lots(recall) {
  const src = Array.isArray(recall.lots) && recall.lots.length ? recall.lots : [recall.lot_number];
  return src.map(l => (l || '').toString().toLowerCase().trim()).filter(Boolean);
}
function _barcodes(recall) {
  const src = [recall.barcode_number].concat(Array.isArray(recall.gtins) ? recall.gtins : []);
  return src.map(b => (b || '').toString().toLowerCase().trim()).filter(Boolean);
}

// Match levels:
//   'exact'    red alert: one of the recall's barcodes equals the scan's, or one
//              of the recall's lots is a substring of raw_capture
//              (case-insensitive). Product corroboration is not required for an
//              exact identifier hit, but a lot shorter than 4 characters needs it.
//   'possible' orange alert: the product fuzzy-matches but no lot substring
//              confirmed (recalls without a lot, skip-path scans, legacy scans).
//   null       no match.
export function recallMatchLevel(scanRecord, recall, log) {
  // 2026-09-09 audit fix. The exact-identifier checks below used to sit
  // behind an early `if (!fuzzyProductMatch(...)) return {level:null}`.
  // That contradicted both fuzzyProductMatch's own comment ("the caller can
  // still match if the recall lot is found in raw_capture") and the
  // CLAUDE.md counting rule, which keys on exact lot OR barcode with no
  // product-name condition. Because fuzzyProductMatch deliberately returns
  // false for product names over 80 chars, and the FDA importer writes
  // product_name = product_description.slice(0,120), an exact lot hit on an
  // FDA/Mattilsynet feed recall could never fire anywhere in the scanner.
  const productMatches = fuzzyProductMatch(recall.product_name, scanRecord.product_name);

  // Red — exact barcode match (legacy compat). Kept because pre-rebuild
  // scans have barcode_number populated; new scans always have it null.
  // A feed entry's GTINs count as barcodes.
  const scanBc = (scanRecord.barcode_number || '').toString().toLowerCase().trim();
  if (scanBc && _barcodes(recall).includes(scanBc)) {
    if (log) log(scanRecord, recall, 'red', 'barcode');
    return { level: 'exact', recall, matched_on: 'barcode' };
  }

  // Red — a recall lot is a substring of scan.raw_capture (case-insensitive).
  // The brief mandates raw_capture as the search field; lot_number on new
  // scans is set equal to raw_capture by submitScan, so the fallback to
  // lot_number below is functionally identical for new data and a
  // partial-credit lifeline for legacy scans where raw_capture is null.
  // When the product name does NOT corroborate, require a lot code of real
  // length: a 2-3 character code would substring-match half the shelf and
  // bury staff in false alarms.
  const MIN_UNCORROBORATED_LOT = 4;
  const rawLow = (scanRecord.raw_capture || scanRecord.lot_number || '').toString().toLowerCase();
  if (rawLow) {
    for (const recallLotLow of _lots(recall)) {
      if (!(productMatches || recallLotLow.length >= MIN_UNCORROBORATED_LOT)) continue;
      if (rawLow.includes(recallLotLow)) {
        if (log) log(scanRecord, recall, 'red', 'substring');
        return { level: 'exact', recall, matched_on: 'substring', matched_lot: recallLotLow };
      }
    }
  }

  // Red — a code inside one of the recall's printed lot ranges ("PB24105
  // through PB24150") appears in the raw capture. The same length rule as a
  // single lot applies when the product does not corroborate.
  if (rawLow && Array.isArray(recall.lot_ranges)) {
    for (const range of recall.lot_ranges) {
      const hit = lotCodes.findRangeHit(rawLow, range);
      if (hit && (productMatches || hit.length >= MIN_UNCORROBORATED_LOT)) {
        if (log) log(scanRecord, recall, 'red', 'lot_range');
        return { level: 'exact', recall, matched_on: 'lot_range', matched_lot: hit };
      }
    }
  }

  // Red — the scan's best-before date falls inside the recall's best-by
  // window and the product corroborates (decision 3). A date alone, with no
  // product agreement, is not a hit: half the shelf shares a date.
  if (productMatches && recall.best_by_from) {
    const scanDate = extractBestBefore(scanRecord.raw_capture || scanRecord.lot_number || '');
    const to = recall.best_by_to || recall.best_by_from;
    if (scanDate && scanDate >= recall.best_by_from && scanDate <= to) {
      if (log) log(scanRecord, recall, 'red', 'best_by');
      return { level: 'exact', recall, matched_on: 'best_by', matched_lot: scanDate };
    }
  }

  // No exact identifier hit and the product name doesn't corroborate — not
  // a match at any level.
  if (!productMatches) {
    if (log) log(scanRecord, recall, 'none', null);
    return { level: null };
  }

  // Orange — product fuzzy-matches but no lot substring confirmed. Includes:
  //   - recalls without a lot identifier (product-only recall), and "all
  //     lots" recalls, which never go red on the product name alone
  //     (decision 2); a GTIN hit above still makes them red
  //   - skip-path scans (raw_capture null)
  //   - legacy scans where the captured lot doesn't match the recalled lot
  if (log) log(scanRecord, recall, 'orange', 'product_name_only');
  return { level: 'possible', recall, matched_on: 'product_name_only' };
}

// Check a scan record against ALL active recalls.
// Returns highest level found: 'exact' (red) | 'possible' (orange) | null.
// 'raw' was retired in the raw-capture rebuild — recallMatchLevel no longer
// emits it, so the branch was dead.
export function checkRecordAgainstRecalls(scanRecord, recalls, log) {
  let best = null;
  for (const recall of recalls) {
    const { level } = recallMatchLevel(scanRecord, recall, log);
    if (level === 'exact') return 'exact';
    if (level === 'possible') best = 'possible';
  }
  return best;
}
