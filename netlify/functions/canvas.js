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
    const { canvasUrl, token } = JSON.parse(event.body);
    if (!canvasUrl || !token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'canvasUrl and token are required' }) };
    }

    // Fetch active courses
    const coursesResult = await canvasFetch(canvasUrl, '/api/v1/courses?enrollment_state=active&per_page=20&include[]=term', token);
    if (coursesResult.status !== 200) {
      let canvasMessage = '';
      try { canvasMessage = JSON.parse(coursesResult.body)?.errors?.[0]?.message || coursesResult.body.substring(0, 200); } catch(e) {}
      return {
        statusCode: coursesResult.status,
        headers: CORS,
        body: JSON.stringify({
          error: `Canvas returned ${coursesResult.status} on /courses — check your URL and token.`,
          canvasResponse: canvasMessage,
          debug: { endpoint: '/api/v1/courses', status: coursesResult.status }
        })
      };
    }

    const courses = JSON.parse(coursesResult.body);
    if (!Array.isArray(courses)) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: 'Canvas returned unexpected data for /courses', canvasResponse: coursesResult.body.substring(0, 300) })
      };
    }

    // Fetch assignments and self-submissions for each course in parallel
    // NOTE: /students/submissions requires teacher role — use /self/enrollments + per-assignment submissions instead
    const allAssigns = [];
    const allGrades = [];
    const debugLog = [];

    await Promise.all(courses.map(async cc => {
      // Assignments — works for enrolled students
      const aResult = await canvasFetch(canvasUrl, `/api/v1/courses/${cc.id}/assignments?per_page=50&order_by=due_at`, token);
      debugLog.push({ course: cc.name, courseId: cc.id, assignmentsStatus: aResult.status });

      if (aResult.status === 200) {
        const aList = JSON.parse(aResult.body);
        if (Array.isArray(aList)) {
          aList.forEach(a => { if (a.due_at) allAssigns.push({ ...a, courseName: cc.name, courseId: cc.id }); });
        }
      }

      // Use the student-accessible submissions endpoint (self only)
      const sResult = await canvasFetch(canvasUrl, `/api/v1/courses/${cc.id}/submissions/self?per_page=50`, token);
      debugLog.push({ course: cc.name, submissionsStatus: sResult.status });

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
      // 404 on submissions/self is fine — some courses don't have submissions
    }));

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ courses, assignments: allAssigns, grades: allGrades, debug: debugLog })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message, stack: err.stack })
    };
  }
};
