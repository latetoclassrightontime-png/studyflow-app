const https = require('https');

function canvasFetch(canvasUrl, path, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(canvasUrl);
    const req = https.request({
      hostname: urlObj.hostname,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
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
    const { canvasUrl, token, courseIds } = JSON.parse(event.body);
    if (!canvasUrl || !token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'canvasUrl and token are required' }) };
    }

    // Fetch active courses
    const coursesResult = await canvasFetch(canvasUrl, '/api/v1/courses?enrollment_state=active&per_page=20', token);
    if (coursesResult.status !== 200) {
      return {
        statusCode: coursesResult.status,
        headers: CORS,
        body: JSON.stringify({ error: `Canvas error ${coursesResult.status} — check your URL and token.` })
      };
    }
    const courses = JSON.parse(coursesResult.body);

    // Fetch assignments and submissions for each course in parallel
    const allAssigns = [];
    const allGrades = [];

    await Promise.all(courses.map(async cc => {
      const [aResult, sResult] = await Promise.all([
        canvasFetch(canvasUrl, `/api/v1/courses/${cc.id}/assignments?per_page=50&order_by=due_at`, token),
        canvasFetch(canvasUrl, `/api/v1/courses/${cc.id}/students/submissions?include[]=assignment&per_page=50`, token)
      ]);

      if (aResult.status === 200) {
        const aList = JSON.parse(aResult.body);
        if (Array.isArray(aList)) {
          aList.forEach(a => { if (a.due_at) allAssigns.push({ ...a, courseName: cc.name, courseId: cc.id }); });
        }
      }
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
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
