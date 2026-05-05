// netlify/functions/ocr.js
// Batch'd AI OCR proxy — calls Anthropic API directly via fetch (no SDK dependency)
// Tasks: identify_product | read_barcode | localise_lot | extract_codes | extract_raw_cluster
//
// Speed strategy:
//   - localise_lot        -> haiku (fast localisation pass — only used for stored crops)
//   - extract_codes       -> sonnet (lot code reading needs visual reasoning)
//   - extract_raw_cluster -> sonnet (verbatim inkjet character cluster — accuracy drives recall substring matching)
//   - identify_product    -> haiku (fast; staff can correct; lot code is what matters)
//   - read_barcode        -> haiku

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_HAIKU  = 'claude-haiku-4-5-20251001';
const MODEL_SONNET = 'claude-sonnet-4-20250514';

async function callAnthropic(model, maxTokens, prompt, imageB64) {
  // 25-second timeout — Netlify background functions allow 26s; leave 1s buffer
  const resp = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(25000),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 },
          },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error('Anthropic API error ' + resp.status + ': ' + err);
  }
  return resp.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { task, image, extra = {} } = JSON.parse(event.body);

    if (!task || !image) {
      return { statusCode: 400, body: JSON.stringify({ error: 'task and image required' }) };
    }

    let model, prompt, maxTokens;

    switch (task) {

      case 'identify_product': {
        // Haiku for speed (~200ms vs ~1000ms for Sonnet).
        // Staff review and correct the name if needed — the lot code matters more for traceability.
        model = MODEL_HAIKU;
        maxTokens = 80;
        prompt = [
          'Read the exact product name from this food packaging label. Include brand, product name, and variant — distinguish carefully between similar types: Helmelk/Mellommelk/Lettmelk/Skummet, Lett/Original/Økologisk/Extra, fat percentages, and weight/size.',
          'Return ONLY: "Brand ProductName Size" (e.g. "Gilde Bacon 150g"). If unreadable: "Unknown Product". No explanations.',
        ].join('\n');
        break;
      }

      case 'read_barcode': {
        model = MODEL_HAIKU;
        maxTokens = 200;
        prompt = 'Read all barcodes visible in this image. Return ONLY a JSON array of strings, e.g. ["1234567890123"]. No markdown. If no barcode is readable, return [].';
        break;
      }

      case 'localise_lot': {
        model = MODEL_HAIKU;
        maxTokens = 150;
        const isUS = extra.isUSRegion;
        prompt = isUS
          ? 'Locate the Traceability Lot Code (TLC) region on this US food packaging. Look for: LOT, L#, BATCH, PACK DATE, MFG DATE, GS1 AI(10).\nReturn ONLY valid JSON: {"found": true, "y_start": 0.0, "y_end": 1.0, "description": "brief note"}\ny_start/y_end are fractions of image height. No markdown.'
          : 'Locate the lot/batch number (partinummer) region on this Norwegian/EU food packaging. Look for: L, Parti, LOT, or inkjet codes near the expiry date.\nReturn ONLY valid JSON: {"found": true, "y_start": 0.0, "y_end": 1.0, "description": "brief note"}\ny_start/y_end are fractions of image height. No markdown.';
        break;
      }

      case 'extract_codes': {
        // Always use Sonnet for main extraction — lot code ID needs proper visual reasoning.
        // Haiku is fast but misses ambiguous codes on Norwegian/EU packaging.
        // Sonnet with a short prompt is faster AND more accurate than Haiku with a long one.
        const useHaiku = extra.useHaiku === true; // only use haiku if explicitly requested
        model = useHaiku ? MODEL_HAIKU : MODEL_SONNET;
        maxTokens = useHaiku ? 300 : 400;
        prompt = extra.prompt || 'Extract lot codes from this food packaging. Return JSON with lot, expiry, lot_confidence fields.';
        break;
      }

      case 'extract_raw_cluster': {
        // Capture-everything-match-later flow: read the inkjet date/lot cluster
        // verbatim, no parsing. Substring matching at recall time depends on
        // character-level fidelity, so use Sonnet rather than Haiku.
        //
        // Prompt is intentionally aggressive about completeness — the failure
        // modes seen in pilot testing are all omission:
        //   1) dropping an asterisk-prefixed segment (e.g. "*1599") that
        //      looked like trailing metadata
        //   2) reading only the top line of a 2-line stacked cluster (e.g.
        //      capturing "06.06.26*1599" but skipping "10:48-7" beneath it)
        // The prompt directly names both failure modes and tells the model
        // they are wrong. Stating that "returning only one of two lines is
        // wrong" works better than describing the desired behavior.
        model = MODEL_SONNET;
        maxTokens = 200;
        prompt = [
          'You are reading an inkjet-printed lot/date cluster from food packaging. This is for product traceability — every character matters because it will be substring-matched against recall records. Missing characters means missing recalls.',
          '',
          'Find the inkjet-printed character cluster: a sequence of digits, dots, slashes, asterisks, colons, dashes, and sometimes letters, printed near the bottom, side, or back of the pack.',
          '',
          'Return EVERY character you can see, exactly as printed, in reading order:',
          '- Single-line cluster: read left-to-right.',
          '- Stacked / multi-line cluster (2 or more lines): read top line first, then the next line(s), separated by a single space. Read EVERY line — even if a line looks shorter, fainter, or less prominent than another. Multi-line clusters very often have 2 lines (e.g. "06.06.26*1599" on top, "10:48-7" below). RETURNING ONLY ONE OF TWO LINES IS WRONG.',
          '- Include ALL separator characters (* . / - : space) and ALL segments. Do NOT assume an asterisk-prefixed or trailing portion is metadata to skip.',
          '- If a character is faint, partially obscured, or uncertain: include your best guess. NEVER skip a character because you are unsure — the user will verify and edit.',
          '',
          'Do NOT parse the result. Do NOT split into date / lot / time fields. Do NOT normalize formats.',
          '',
          'Return ONE single raw string with the verbatim text. No labels, no JSON, no commentary.',
          '',
          'If you see multiple unrelated inkjet clusters in the image, return only the lot/date cluster (usually the longest sequence near the expiry date). If you cannot read any inkjet-printed characters at all, return an empty string.',
        ].join('\n');
        break;
      }

      default:
        return { statusCode: 400, body: JSON.stringify({ error: 'Unknown task: ' + task }) };
    }

    const response = await callAnthropic(model, maxTokens, prompt, image);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };

  } catch (err) {
    console.error('OCR function error:', err);
    // Don't expose internal error details (may contain API key validation info)
    const safeMsg = err.message?.startsWith('Anthropic API error') ? 'OCR service unavailable' : (err.message || 'Internal error');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: safeMsg }),
    };
  }
};
