/* Google Apps Script — WhatsApp SaaS Webhook Receiver
   Deploy as Web App → Execute as: Me, Who has access: Anyone
   Handles: text, image, video, audio, document, sticker messages + media files
*/

const SHEET_NAME = 'WebhookLog';
const EVENT_LIMIT = 30;

function doGet() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('EVENTS') || '[]';
  const events = JSON.parse(raw);
  const mediaRaw = props.getProperty('MEDIA') || '[]';
  const mediaItems = JSON.parse(mediaRaw);

  const eventRows = events.map(e =>
    '<div class="border-bottom py-2"><strong>' + e.event + '</strong> <span class="text-muted">' + e.time + '</span><br><pre class="mb-0 mt-1" style="font-size:11px;max-height:80px;overflow:auto">' + e.data + '</pre></div>'
  ).join('');

  const mediaRows = mediaItems.map(m =>
    '<div class="border-bottom py-2 d-flex align-items-start gap-2">' +
    (m.type === 'image'
      ? '<a href="' + m.url + '" target="_blank"><img src="' + m.url + '" style="width:60px;height:60px;object-fit:cover;border-radius:4px" loading="lazy"></a>'
      : '<div class="flex-shrink-0" style="width:60px;height:60px;background:#f0f0f0;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:24px">' +
        (m.type === 'video' ? '🎥' : m.type === 'audio' ? '🎵' : m.type === 'document' ? '📄' : m.type === 'sticker' ? '🎭' : '📎') +
        '</div>') +
    '<div class="flex-grow-1 small"><strong>' + (m.fileName || m.type) + '</strong><br><span class="text-muted">' + m.direction + ' &middot; ' + m.time + '</span><br><a href="' + m.url + '" target="_blank" class="text-break" style="font-size:10px">' + m.url + '</a></div></div>'
  ).join('') || '<p class="text-muted mb-0">No media yet.</p>';

  return HtmlService.createHtmlOutput(`
    <!DOCTYPE html><html><head><title>Webhook Receiver</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>body{background:#f5f5f5}pre{white-space:pre-wrap;word-break:break-all}a{color:#0d6efd;text-decoration:none}a:hover{text-decoration:underline}</style>
    </head><body>
    <div class="container py-4">
      <h4 class="mb-3">Webhook Receiver</h4>
      <ul class="nav nav-tabs mb-3" id="tabNav">
        <li class="nav-item"><a class="nav-link active" href="#" onclick="showTab('events')">Events</a></li>
        <li class="nav-item"><a class="nav-link" href="#" onclick="showTab('media')">Media</a></li>
      </ul>
      <div id="tab-events">
        <div class="card"><div class="card-body">
          <p class="text-success mb-2"><strong>Elapsed:</strong> <span id="elapsed">${events.length ? events[0].time + ' &mdash; ' + (new Date(events[0].ts).toLocaleString()) : '&mdash;'}</span></p>
          <p class="text-muted mb-2">Last ${EVENT_LIMIT} events (newest first):</p>
          <div id="log" class="small">${eventRows || '<p class="text-muted mb-0">No events yet.</p>'}</div>
          <button class="btn btn-sm btn-outline-primary mt-2" onclick="location.reload()"><i class="fas fa-sync"></i> Refresh</button>
        </div></div>
      </div>
      <div id="tab-media" style="display:none">
        <div class="card"><div class="card-body">
          <p class="text-muted mb-2">Last ${EVENT_LIMIT} media files (newest first):</p>
          <div id="mediaLog" class="small">${mediaRows}</div>
          <button class="btn btn-sm btn-outline-primary mt-2" onclick="location.reload()"><i class="fas fa-sync"></i> Refresh</button>
        </div></div>
      </div>
    </div>
    <script>
    function showTab(name) {
      document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
      document.getElementById('tab-' + name).style.display = 'block';
      document.querySelectorAll('#tabNav .nav-link').forEach(el => el.classList.remove('active'));
      event.target.classList.add('active');
    }
    </script>
    </body></html>
  `).setTitle('Webhook Receiver').addMetaTag('viewport', 'width=device-width,initial-scale=1');
}

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond({ error: 'Invalid JSON' }, 400);
  }

  const event = payload.event || 'unknown';
  const data = payload.data || {};
  const instanceId = payload.instanceId || '';
  const timestamp = payload.timestamp || '';

  // Save to PropertiesService (last 30)
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('EVENTS') || '[]';
  let events = JSON.parse(raw);
  events.unshift({
    event: event,
    data: JSON.stringify(data, null, 2),
    time: new Date().toLocaleTimeString(),
    ts: Date.now(),
  });
  if (events.length > EVENT_LIMIT) events = events.slice(0, EVENT_LIMIT);
  props.setProperty('EVENTS', JSON.stringify(events));

  // --- Handle specific events ---
  try {
    switch (event) {
      case 'webhook.test':
        break;

      case 'message.received':
      case 'message.sent': {
        const from = data.from?.split('@')[0] || data.from || '';
        const to = data.to?.split('@')[0] || data.to || '';
        const msgText = data.content?.text || data.content?.caption || '';
        const msgType = data.messageType || 'text';
        const mediaUrl = data.content?.mediaUrl || '';
        const fileName = data.content?.fileName || '';
        const direction = data.direction || '';
        appendToSheet(event, from, to, msgText, msgType, mediaUrl, fileName, direction, timestamp);
        // Log media separately
        if (mediaUrl && ['image','video','audio','document','sticker'].includes(msgType)) {
          saveMedia(event, msgType, mediaUrl, fileName, direction, timestamp);
        }
        break;
      }

      case 'message.delivered':
        break;

      case 'instance.connected':
        appendToSheet(event, instanceId, '', 'Instance connected', 'text', '', '', '', timestamp);
        break;

      case 'instance.disconnected':
        appendToSheet(event, instanceId, '', 'Instance disconnected', 'text', '', '', '', timestamp);
        break;
    }
  } catch (err) {
    Logger.log('Handler error: ' + err.message);
  }

  return respond({ ok: true, event: event });
}

function saveMedia(event, type, url, fileName, direction, timestamp) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('MEDIA') || '[]';
  let items = JSON.parse(raw);
  items.unshift({
    event: event,
    type: type,
    url: url,
    fileName: fileName || type,
    direction: direction,
    time: new Date().toLocaleTimeString(),
    ts: Date.now(),
  });
  if (items.length > EVENT_LIMIT) items = items.slice(0, EVENT_LIMIT);
  props.setProperty('MEDIA', JSON.stringify(items));
}

function respond(obj, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function appendToSheet(event, from, to, text, msgType, mediaUrl, fileName, direction, timestamp) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Event', 'Direction', 'From', 'To', 'Type', 'Message', 'File Name', 'File URL', 'Received At']);
    }
    sheet.appendRow([timestamp, event, direction, from, to, msgType, text, fileName, mediaUrl, new Date().toISOString()]);
  } catch (err) {
    Logger.log('Sheet append error: ' + err.message);
  }
}
