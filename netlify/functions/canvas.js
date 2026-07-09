const https = require('https');

// Follows up to 3 redirects so csudh.instructure.com → canvas.csudh.edu works transparently
function canvasFetch(urlString, path, token, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(path.startsWith('http') ? path : urlString + path);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirectsLeft > 0) {
        // Follow redirect, preserving auth header
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : urlObj.origin + res.headers.location;
        resolve(canvasFetch(next, '', token, redirectsLeft - 1));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

function parseError(body) {
  try {
    const j = JSON.parse(body);
    return j?.errors?.[0]?.message || j?.message || body.substring(0, 300);
  } catch(e) { return body.substring(0, 300); }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { canvasUrl, token } = JSON.parse(event.body);
    if (!canvasUrl || !token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'canvasUrl and token are required' }) };
    }

    // Normalize URL — strip trailing slash
    const baseUrl = canvasUrl.replace(/\/$/, '');

    // Step 1: Verify token works at all with the simplest endpoint
    const selfResult = await canvasFetch(baseUrl, '/api/v1/users/self', token);
    if (selfResult.status === 401) {
      return {
        statusCode: 401, headers: CORS,
        body: JSON.stringify({ error: 'Invalid API token. Go to Canvas → Account → Settings → New Access Token and generate a fresh one.' })
      };
    }
    if (selfResult.status !== 200) {
      return {
        statusCode: selfResult.status, headers: CORS,
        body: JSON.stringify({
          error: `Canvas rejected the request (${selfResult.status}). Try using https://canvas.csudh.edu instead of csudh.instructure.com.`,
          canvasResponse: parseError(selfResult.body)
        })
      };
    }

    // Step 2: Fetch active courses
    const coursesResult = await canvasFetch(baseUrl, '/api/v1/courses?enrollment_state=active&per_page=30', token);
    if (coursesResult.status !== 200) {
      return {
        statusCode: coursesResult.status, headers: CORS,
        body: JSON.stringify({
          error: `Could not fetch courses (${coursesResult.status}).`,
          canvasResponse: parseError(coursesResult.body)
        })
      };
    }

    const courses = JSON.parse(coursesResult.body);
    if (!Array.isArray(courses)) {
      return {
        statusCode: 502, headers: CORS,
        body: JSON.stringify({ error: 'Canvas returned unexpected data for /courses', canvasResponse: coursesResult.body.substring(0, 300) })
      };
    }

    // Step 3: Fetch assignments + self submissions per course
    const allAssigns = [];
    const allGrades = [];

    await Promise.all(courses.map(async cc => {
      const aResult = await canvasFetch(baseUrl, `/api/v1/courses/${cc.id}/assignments?per_page=50&order_by=due_at`, token);
      if (aResult.status === 200) {
        const aList = JSON.parse(aResult.body);
        if (Array.isArray(aList)) {
          aList.forEach(a => { if (a.due_at) allAssigns.push({ ...a, courseName: cc.name, courseId: cc.id }); });
        }
      }

      // /submissions/self works for students; skip gracefully if not supported
      const sResult = await canvasFetch(baseUrl, `/api/v1/courses/${cc.id}/submissions/self?per_page=50`, token);
      if (sResult.status === 200) {
        const sList = JSON.parse(sResult.body);
        if (Array.isArray(sList)) {
          sList.forEach(s => {
            if (s.score !== null && s.score !== undefined && s.graded_at) {
              allGrades.push({ ...s, courseName: cc.name });
            }
          });
        }
      }
    }));

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ courses, assignments: allAssigns, grades: allGrades })
    };

  } catch (err) {
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
