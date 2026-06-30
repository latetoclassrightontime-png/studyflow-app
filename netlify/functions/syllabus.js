const https = require('https');

exports.handler = async function(event) {
  if(event.httpMethod === 'OPTIONS'){
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if(event.httpMethod !== 'POST'){
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { text, pdfBase64 } = JSON.parse(event.body);

    const promptText = "You are a syllabus parser. Extract ALL assignments from this syllabus.\n\nThe syllabus is from Canvas LMS. Assignments look like:\nAssignment Name\nStart Date & Time Due Date & Time Points\nJun 15, 2026, 12:00 AM Jun 17, 2026, 11:59 PM 8\n\nThe DUE DATE is always the SECOND date. Convert dates like \"Jun 17, 2026\" to \"2026-06-17\".\n\nReturn ONLY valid JSON with this structure:\n{\n  \"course\": { \"name\": \"course name\", \"code\": \"code or null\", \"credits\": 3, \"days\": [], \"start\": \"09:00\", \"end\": \"09:50\", \"room\": null },\n  \"assignments\": [{ \"title\": \"title\", \"due\": \"YYYY-MM-DD\", \"type\": \"Discussion|Essay|Exam|Project|Lab|Homework\", \"points\": 0 }]\n}\n\nRULES:\n- Extract EVERY assignment with a due date\n- Skip items with 0 points that are just acknowledgements\n- Return ONLY JSON, no markdown, no explanation";

    let messageContent;
    if(pdfBase64){
      messageContent = [
        { type:'document', source:{ type:'base64', media_type:'application/pdf', data:pdfBase64 } },
        { type:'text', text: promptText }
      ];
    } else {
      messageContent = [
        { type:'text', text: promptText + '\n\nSYLLABUS:\n' + (text||'').substring(0, 12000) }
      ];
    }

    const requestBody = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: messageContent }]
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(requestBody);
      req.end();
    });

    if(result.status !== 200){
      return {
        statusCode: result.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: result.body })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: result.body
    };

  } catch(err){
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
