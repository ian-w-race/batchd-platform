// netlify/functions/ocr.js
// Batch'd AI OCR proxy — calls Anthropic API directly via fetch (no SDK dependency)
// Tasks: identify_product | read_barcode | localise_lot | extract_codes
//
// Speed strategy:
//   - localise_lot     -> haiku (fast localisation pass — only used for stored crops)
//   - extract_codes    -> sonnet (lot code reading needs visual reasoning)
//   - identify_product -> sonnet (variant accuracy: Helmelk vs Mellommelk requires reading)
//   - read_barcode     -> haiku

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
        // Sonnet — not Haiku. Dairy variant words ("Helmelk" vs "Mellommelk" vs "Lettmelk")
        // differ by one printed word. Haiku pattern-matches visually and confuses them.
        // Sonnet reads what is actually printed on the label. Worth the extra ~600ms.
        model = MODEL_SONNET;
        maxTokens = 80;
        prompt = [
          'Read the exact product name as printed on this food packaging label.',
          'Do NOT guess or approximate — read the actual text on the label.',
          'Distinguish carefully between similar variants: pay close attention to words like',
          '"Helmelk", "Mellommelk", "Lettmelk", "Skummet", "Lett", "Original", "Økologisk",',
          '"Extra", "Light", fat percentages, and size/weight.',
          'Return ONLY: Brand + exact product name + size (e.g. "Gilde Bacon 150g" or "Kavli Rekesalat 200g").',
          'No explanations. Just the product name. If the label is unreadable, return "Unknown Product".',
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
