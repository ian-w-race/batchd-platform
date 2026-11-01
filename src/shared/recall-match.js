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

// Match levels:
//   'exact'    red alert: the recall's barcode equals the scan's, or the recall
//              lot is a substring of raw_capture (case-insensitive). Product
//              corroboration is not required for an exact identifier hit, but a
//              lot shorter than 4 characters needs it.
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
  if (recall.barcode_number && scanRecord.barcode_number &&
      recall.barcode_number.toLowerCase().trim() === scanRecord.barcode_number.toLowerCase().trim()) {
    if (log) log(scanRecord, recall, 'red', 'barcode');
    return { level: 'exact', recall, matched_on: 'barcode' };
  }

  // Red — recall lot is a substring of scan.raw_capture (case-insensitive).
  // The brief mandates raw_capture as the search field; lot_number on new
  // scans is set equal to raw_capture by submitScan, so the fallback to
  // lot_number below is functionally identical for new data and a
  // partial-credit lifeline for legacy scans where raw_capture is null.
  if (recall.lot_number) {
    const recallLotLow = recall.lot_number.toLowerCase().trim();
    // When the product name does NOT corroborate, require a lot code of
    // real length: a 2-3 character code would substring-match half the
    // shelf and bury staff in false alarms.
    const MIN_UNCORROBORATED_LOT = 4;
    if (recallLotLow && (productMatches || recallLotLow.length >= MIN_UNCORROBORATED_LOT)) {
      const rawLow = (scanRecord.raw_capture || scanRecord.lot_number || '').toLowerCase();
      if (rawLow && rawLow.includes(recallLotLow)) {
        if (log) log(scanRecord, recall, 'red', 'substring');
        return { level: 'exact', recall, matched_on: 'substring' };
      }
    }
  }

  // No exact identifier hit and the product name doesn't corroborate — not
  // a match at any level.
  if (!productMatches) {
    if (log) log(scanRecord, recall, 'none', null);
    return { level: null };
  }

  // Orange — product fuzzy-matches but no lot substring confirmed. Includes:
  //   - recalls without a lot identifier (product-only recall)
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
