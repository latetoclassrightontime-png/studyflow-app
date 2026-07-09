// Serves a .ics calendar feed from base64-encoded event data passed as ?data=
exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const data = event.queryStringParameters?.data;
  if (!data) {
    return { statusCode: 400, body: 'Missing ?data= parameter' };
  }

  try {
    const decoded = Buffer.from(data, 'base64').toString('utf8');
    const { events } = JSON.parse(decoded);
    if (!Array.isArray(events)) throw new Error('Invalid payload');

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//StudyFlow//StudyFlow Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:StudyFlow',
      'X-WR-CALDESC:Your StudyFlow assignments and study blocks',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
    ];

    for (const ev of events) {
      // due: YYYY-MM-DD, dt: HH:MM (optional)
      const dateStr = ev.due.replace(/-/g, '');
      const timeStr = (ev.dt || '23:59').replace(':', '') + '00';
      const dtStart = `${dateStr}T${timeStr}00`;
      // end = start + 1 hour
      const endHour = String(parseInt(timeStr.substring(0, 2)) + 1).padStart(2, '0');
      const dtEnd = `${dateStr}T${endHour}${timeStr.substring(2)}`;
      const uid = `sf-${ev.id || (ev.title + ev.due).replace(/\W/g, '')}@studyflow`;
      const summary = (ev.courseName ? `[${ev.courseName}] ` : '') + ev.title;

      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:.]/g, '').substring(0, 15)}Z`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${summary.replace(/,/g, '\\,')}`,
        ev.type ? `CATEGORIES:${ev.type}` : '',
        'END:VEVENT'
      );
    }

    lines.push('END:VCALENDAR');
    const icsBody = lines.filter(Boolean).join('\r\n');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="studyflow.ics"',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
      body: icsBody,
    };
  } catch (err) {
    return { statusCode: 400, body: 'Invalid data: ' + err.message };
  }
};
