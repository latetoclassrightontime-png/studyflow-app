const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function rawFetch(url, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body,
        finalUrl: url
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const { canvasUrl, token } = JSON.parse(event.body || '{}');
    if (!canvasUrl || !token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'canvasUrl and token required' }) };
    }

    const base = canvasUrl.replace(/\/$/, '');
    const steps = [];

    // Step 1: HEAD request to see if canvas.csudh.edu is reachable and redirects
    const r1 = await rawFetch(`${base}/api/v1/users/self`, token);
    steps.push({ step: 'GET /api/v1/users/self', status: r1.status, headers: r1.headers, body: r1.body.substring(0, 500), finalUrl: r1.finalUrl });

    // Step 2: If redirected, follow manually and show where it goes
    if ((r1.status === 301 || r1.status === 302) && r1.headers.location) {
      const redirectUrl = r1.headers.location.startsWith('http')
        ? r1.headers.location
        : `${base}${r1.headers.location}`;
      const r2 = await rawFetch(redirectUrl, token);
      steps.push({ step: `REDIRECT → ${redirectUrl}`, status: r2.status, headers: r2.headers, body: r2.body.substring(0, 500) });
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps }, null, 2)
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
