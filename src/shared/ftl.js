// src/shared/ftl.js
// The FDA Food Traceability List categories (21 CFR Part 1 Subpart S), the
// product-name detector and the product key normalizer (improvement plan A2
// part 3, 2026-11-01), moved from index.html. The dashboard and signup used
// to keep their own copies of the category labels "in step" by hand; every
// surface now reads ftlLabels(). Exposed as window.Batchd.ftl.
// Resolution order in the scanner: ftl_overrides by GTIN, by normalized name,
// products_public.is_ftl, then detectFtlCategory on the name. A pattern that
// contains a literal backspace is the old broken-\b defect (the tests check).

export const FTL_CATEGORIES = {
  // Fresh produce
  leafy_greens: {
    label: 'Leafy greens',
    patterns: /\b(lettuce|romaine|spinach|kale|arugula|chard|collard|mustard green|watercress|endive|escarole|radicchio|iceberg|butterhead|mixed green|salad green|baby green|mesclun|rucola|rocket)\b/i
  },
  fresh_cut_produce: {
    label: 'Fresh-cut produce',
    patterns: /\bfresh.?cut\b|\bpre.?cut\b|\bready.?to.?eat (fruit|veg|salad)\b/i
  },
  tomatoes: {
    label: 'Tomatoes',
    patterns: /\btomato|\btomatoes\b|\btomat/i
  },
  peppers: {
    label: 'Peppers',
    patterns: /\bbell pepper|\bsweet pepper|\bchili pepper|\bchile pepper|\bcapsicum|\bjalapeno|\bjalapeño|\bhabanero|\bpoblano|\bserrano|\bpeppers?\b/i,
    // Phase 6 (2026-10-07): known misfires. Checked before the pattern.
    exclude: /dr\.?\s*pepper|pepperoni|peppermint|peppercorn|pepper jack|peppered|pepper spray|pepper steak|pepper sauce|salt (and|&) pepper/i
  },
  cucumbers: {
    label: 'Cucumbers',
    patterns: /\bcucumber|\bgurk/i
  },
  melons: {
    label: 'Melons',
    patterns: /\bmelon\b|\bcantaloupe\b|\bhoneydew\b|\bwatermelon\b/i
  },
  sprouts: {
    label: 'Sprouts',
    patterns: /\bsprout\b|\balfalfa sprout|\bbean sprout|\bbroccoli sprout/i
  },
  herbs: {
    label: 'Fresh herbs',
    patterns: /\b(fresh |cut )?(basil|cilantro|coriander|parsley|dill|mint|chive|tarragon|thyme|rosemary|sage|oregano)\b/i
  },
  tropical_fruits: {
    label: 'Tropical tree fruits',
    patterns: /\b(mango|papaya|guava|pineapple|passion fruit|starfruit|carambola|lychee|rambutan|jackfruit|durian|cherimoya)\b/i
  },
  // Dairy
  soft_cheese: {
    label: 'Soft and semi-soft cheese',
    patterns: /\b(ricotta|feta|mozzarella|brie|camembert|blue cheese|gorgonzola|roquefort|havarti|fontina|gouda|manchego|gruyere|raclette|taleggio|limburger|munster|queso fresco|paneer|halloumi|chevre|fromage)\b/i
  },
  // Eggs
  shell_eggs: {
    label: 'Shell eggs',
    // Phase 6 (2026-10-07): word boundary so eggplant and eggnog do not match.
    patterns: /\b(egg|eggs)\b(?! noodle| pasta| powder| substitute| replacement| salad| roll| white| whites)/i,
    exclude: /eggplant|eggnog|liquid egg|egg beaters|egg salad|egg roll|egg white/i
  },
  // Seafood
  // Phase 6 (2026-10-07): smoked finfish must be tested before finfish, or 'smoked salmon' lands in finfish.
  smoked_finfish: {
    label: 'Smoked finfish',
    patterns: /\bsmoked.{0,10}(salmon|trout|mackerel|herring|eel|fish)\b|\b(salmon|trout|fish).{0,10}smoked\b/i
  },
  finfish: {
    label: 'Finfish',
    patterns: /\b(tuna|salmon|cod|tilapia|halibut|snapper|mahi|grouper|flounder|sole|bass|trout|catfish|pollock|haddock|sardine|mackerel|herring|anchov|swordfish|sea bass|branzino|laks|torsk|sei|ørret|skrei)\b/i
  },
  crustaceans: {
    label: 'Crustaceans',
    patterns: /\b(shrimp|prawn|crab|lobster|crayfish|langoustine|scampi|reke)\b/i
  },
  bivalves: {
    label: 'Bivalve mollusks',
    patterns: /\b(oyster|clam|mussel|scallop|cockle|abalone)\b/i
  },
  // Nut products
  nut_butters: {
    label: 'Nut butters',
    patterns: /\b(peanut butter|almond butter|cashew butter|sunflower butter|tahini|nut butter|peanut spread)\b/i
  },
  // Deli salads
  deli_salads: {
    label: 'Deli salads',
    patterns: /\b(pasta salad|potato salad|coleslaw|egg salad|tuna salad|chicken salad|macaroni salad|deli salad|prepared salad)\b/i
  }
};

// Returns { isFtl: bool, category: string|null, label: string|null }
export function detectFtlCategory(productName) {
  if (!productName) return { isFtl: false, category: null, label: null };
  for (const [key, { label, patterns, exclude }] of Object.entries(FTL_CATEGORIES)) {
    if (exclude && exclude.test(productName)) continue;   // Phase 6: per-category misfire list
    if (patterns.test(productName)) {
      return { isFtl: true, category: key, label };
    }
  }
  return { isFtl: false, category: null, label: null };
}

// Normalise a product name to a stable lookup key.
// DESIGN DECISION: We keep the size/volume as part of the key.
// "Tine Helmelk 1L" and "Tine Helmelk 2L" are different SKUs with
// different packaging — possibly different lot code locations.
// Stripping the size was causing them to share a pattern, which
// could direct staff to the wrong place on the label.
// We do strip pure unit strings (ml, dl, kg, g) but keep the number.
export function normaliseProductKey(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    // Strip standalone unit strings but keep the number: "1L" → "1", "500ml" → "500"
    .replace(/(\d+)\s*(ml|dl|cl|l|kg|g|mg|liter|litre)/g, '$1')
    // Strip pure unit words with no number
    .replace(/\b(pk|stk|pcs|x)\b/g, '')
    // Normalise Norwegian special chars for matching
    .replace(/[^a-z0-9æøå\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ').slice(0, 5).join(' '); // max 5 words (was 4 — size now counts)
}

// { key: label } for pickers and tables (dashboard suppliers and focus
// categories, signup focus chips, the scanner's badges).
export function ftlLabels() {
  return Object.fromEntries(Object.entries(FTL_CATEGORIES).map(([k, c]) => [k, c.label]));
}
