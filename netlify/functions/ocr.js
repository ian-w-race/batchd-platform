// netlify/functions/ocr.js
// Batch'd AI OCR proxy — calls Anthropic API directly via fetch (no SDK dependency)
// Tasks: identify_product | read_barcode | localise_lot | extract_codes
//
// Speed strategy:
//   - localise_lot     -> haiku (fast localisation pass)
//   - extract_codes    -> haiku by default (useHaiku:true), sonnet for escalation
//   - identify_product -> haiku
//   - read_barcode     -> haiku

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_HAIKU  = 'claude-haiku-4-5-20251001';
const MODEL_SONNET = 'claude-sonnet-4-20250514';

async function callAnthropic(model, maxTokens, prompt, imageB64) {
  const resp = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
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
        model = MODEL_HAIKU;
        maxTokens = 80;
        prompt = 'You are identifying a food product from a photo of its packaging.\nReturn ONLY the product name (brand + product, e.g. "TINE Helmelk 1.5L" or "Gilde Kjottdeig 400g").\nNo explanations. Just the product name. If you cannot identify it, return "Unknown Product".';
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
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
