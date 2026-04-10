// netlify/functions/ocr.js
// Proxies all Anthropic vision API calls server-side so the API key never touches the browser.
// Handles three tasks: identify_product, read_barcode, extract_codes

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { task, image, extra } = body;

  if (!task || !image) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing task or image' }) };
  }

  const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  try {
    let requestBody;

    if (task === 'identify_product') {
      requestBody = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            { type: 'text', text: 'This is a food product label. Reply with ONLY the product name (brand + product), nothing else. Example: "Tine Helmelk" or "Pepsi Cola 330ml". If you cannot identify it, reply "Unknown Product".' }
          ]
        }]
      };

    } else if (task === 'read_barcode') {
      requestBody = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            { type: 'text', text: 'Read the barcode number printed below the barcode stripes on this product. The number is typically 8-14 digits. Reply with ONLY the barcode number digits, no spaces, no other text. If you cannot read it, reply "null".' }
          ]
        }]
      };

    } else if (task === 'localise_lot') {
      const isUS = extra?.isUSRegion || false;
      requestBody = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 60,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            { type: 'text', text: `This is ${isUS ? 'US' : 'Norwegian/EU'} food packaging. Locate the lot number, batch number, or production code (NOT the best-before date, NOT a barcode number${isUS ? ', NOT USDA establishment numbers (EST. XXXX)' : ', NOT "NO XXXX EF" plant codes'}). Where is it vertically in the image? Reply ONLY with JSON: {"y_start": 0.0, "y_end": 1.0, "found": true} using fractions 0-1 from top. If you cannot find any lot code, reply {"found": false}.` }
          ]
        }]
      };

    } else if (task === 'extract_codes') {
      const prompt = extra?.prompt;
      if (!prompt) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt for extract_codes' }) };
      }
      requestBody = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            { type: 'text', text: prompt }
          ]
        }]
      };

    } else {
      return { statusCode: 400, body: JSON.stringify({ error: `Unknown task: ${task}` }) };
    }

    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error('Anthropic API error:', data);
      return {
        statusCode: resp.status,
        body: JSON.stringify({ error: data.error?.message || 'Anthropic API error' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: data.content }),
    };

  } catch (err) {
    console.error('OCR function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Internal error' })
    };
  }
};
