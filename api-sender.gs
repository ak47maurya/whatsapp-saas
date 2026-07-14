/* WhatsApp SaaS — API Sender
   Har type ka message send karo + Google Sheet se bulk send
   Setup: API_BASE_URL aur API_KEY ko apne hisaab se set karo
*/

// ========== CONFIG ==========
const API_BASE_URL = 'https://yourdomain.com/api'; // <-- CHANGE KARO
const API_KEY = 'your-api-key-here';               // <-- CHANGE KARO
// ============================

function apiHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  };
}

function apiCall(endpoint, body) {
  const options = {
    method: 'POST',
    headers: apiHeaders(),
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };
  const res = UrlFetchApp.fetch(API_BASE_URL + endpoint, options);
  return JSON.parse(res.getContentText());
}

// ============================================================
// SEND TEXT
// ============================================================
function sendText(instanceId, to, text) {
  const result = apiCall('/send-message', {
    instanceId, to, type: 'text', text,
  });
  Logger.log('sendText → ' + to + ': ' + (result.success ? 'OK' : result.message));
  return result;
}

// ============================================================
// SEND IMAGE / VIDEO / AUDIO / DOCUMENT / STICKER
// ============================================================
function sendMedia(instanceId, to, type, mediaUrl, caption, fileName, mimeType) {
  const body = {
    instanceId, to, type, mediaUrl,
    caption: caption || '',
    fileName: fileName || '',
    mimeType: mimeType || '',
  };
  const result = apiCall('/send-media', body);
  Logger.log('sendMedia(' + type + ') → ' + to + ': ' + (result.success ? 'OK' : result.message));
  return result;
}

function sendImage(instanceId, to, imageUrl, caption) {
  return sendMedia(instanceId, to, 'image', imageUrl, caption);
}

function sendVideo(instanceId, to, videoUrl, caption) {
  return sendMedia(instanceId, to, 'video', videoUrl, caption);
}

function sendAudio(instanceId, to, audioUrl) {
  return sendMedia(instanceId, to, 'audio', audioUrl);
}

function sendDocument(instanceId, to, docUrl, fileName, caption) {
  return sendMedia(instanceId, to, 'document', docUrl, caption, fileName || 'document', 'application/pdf');
}

function sendSticker(instanceId, to, stickerUrl) {
  return sendMedia(instanceId, to, 'sticker', stickerUrl);
}

// ============================================================
// SEND LOCATION
// ============================================================
function sendLocation(instanceId, to, latitude, longitude) {
  const result = apiCall('/send-message', {
    instanceId, to, type: 'location',
    latitude: latitude,
    longitude: longitude,
  });
  Logger.log('sendLocation → ' + to + ': ' + (result.success ? 'OK' : result.message));
  return result;
}

// ============================================================
// SEND CONTACT
// ============================================================
function sendContact(instanceId, to, contactName, contactPhone) {
  const result = apiCall('/send-message', {
    instanceId, to, type: 'contact',
    contactName, contactPhone,
  });
  Logger.log('sendContact → ' + to + ': ' + (result.success ? 'OK' : result.message));
  return result;
}

// ============================================================
// SEND BULK (same message to many numbers)
// ============================================================
function sendBulk(instanceId, recipients, type, content) {
  // recipients = ['919876543210', '919876543211']
  const body = {
    instanceId,
    recipients: recipients.map(phone => ({ phone })),
    type: type || 'text',
    ...content,
  };
  const result = apiCall('/send-bulk', body);
  Logger.log('sendBulk → ' + recipients.length + ' recipients: ' + (result.success ? 'Queued' : result.message));
  return result;
}

// ============================================================
// GOOGLE SHEET SE MESSAGE BHEJNA
// ============================================================
/*
  Sheet format (column names in Row 1):
    A: phone    — recipient number (e.g. 919876543210)
    B: type     — text / image / video / audio / document / location / contact
    C: content  — text message ya media URL
    D: caption  — caption for image/video/document (optional)
    E: fileName — file name for document (optional)

  Example row:
    919876543210  |  text     |  Hello!              |
    919876543211  |  image    |  https://example.com/pic.jpg  |  Look at this  |
    919876543212  |  document |  https://drive.google.com/... |  Invoice  |  invoice.pdf
*/

function sendFromSheet(instanceId, sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName) || ss.getActiveSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().toLowerCase().trim());

  const phoneCol = headers.indexOf('phone');
  const typeCol = headers.indexOf('type');
  const contentCol = headers.indexOf('content');
  const captionCol = headers.indexOf('caption');
  const fileNameCol = headers.indexOf('filename');
  const latCol = headers.indexOf('latitude');
  const lngCol = headers.indexOf('longitude');
  const contactNameCol = headers.indexOf('contactname');
  const contactPhoneCol = headers.indexOf('contactphone');

  if (phoneCol === -1 || typeCol === -1 || contentCol === -1) {
    Logger.log('ERROR: Sheet must have columns: phone, type, content');
    return { success: false, message: 'Missing columns: phone, type, content' };
  }

  let sent = 0, failed = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const phone = String(row[phoneCol]).trim();
    if (!phone) continue;

    const type = String(row[typeCol]).trim().toLowerCase();
    const content = String(row[contentCol]).trim();
    const caption = captionCol >= 0 ? String(row[captionCol]).trim() : '';
    const fileName = fileNameCol >= 0 ? String(row[fileNameCol]).trim() : '';

    try {
      let result;
      switch (type) {
        case 'text':
          result = sendText(instanceId, phone, content);
          break;
        case 'image':
          result = sendImage(instanceId, phone, content, caption);
          break;
        case 'video':
          result = sendVideo(instanceId, phone, content, caption);
          break;
        case 'audio':
          result = sendAudio(instanceId, phone, content);
          break;
        case 'document':
          result = sendDocument(instanceId, phone, content, fileName, caption);
          break;
        case 'sticker':
          result = sendSticker(instanceId, phone, content);
          break;
        case 'location': {
          const lat = latCol >= 0 ? parseFloat(row[latCol]) : 0;
          const lng = lngCol >= 0 ? parseFloat(row[lngCol]) : 0;
          result = sendLocation(instanceId, phone, lat, lng);
          break;
        }
        case 'contact': {
          const cname = contactNameCol >= 0 ? String(row[contactNameCol]).trim() : content;
          const cphone = contactPhoneCol >= 0 ? String(row[contactPhoneCol]).trim() : phone;
          result = sendContact(instanceId, phone, cname, cphone);
          break;
        }
        default:
          Logger.log('Row ' + (i + 1) + ': Unknown type "' + type + '"');
          failed++;
          continue;
      }

      if (result?.success) {
        // Mark sent in column G (status)
        if (sheet.getLastColumn() < 7) sheet.getRange(1, 7).setValue('Status');
        sheet.getRange(i + 1, 7).setValue('Sent');
        sent++;
      } else {
        sheet.getRange(i + 1, 7).setValue('Failed: ' + (result?.message || ''));
        failed++;
      }
    } catch (err) {
      Logger.log('Row ' + (i + 1) + ' error: ' + err.message);
      if (sheet.getLastColumn() < 7) sheet.getRange(1, 7).setValue('Status');
      sheet.getRange(i + 1, 7).setValue('Error: ' + err.message);
      failed++;
    }

    // Delay between messages to avoid ban
    if (i < data.length - 1) Utilities.sleep(1500);
  }

  const msg = 'Done — Sent: ' + sent + ', Failed: ' + failed;
  Logger.log(msg);
  return { success: true, message: msg, sent, failed };
}

// ============================================================
// DOGET — Web App Dashboard (manual trigger)
// ============================================================
function doGet() {
  return HtmlService.createHtmlOutput(`
    <!DOCTYPE html><html><head><title>WhatsApp API Sender</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    </head><body class="bg-light">
    <div class="container py-4">
      <h3 class="mb-3">WhatsApp API Sender</h3>
      <div class="card mb-3"><div class="card-body">
        <form onsubmit="sendNow(event)">
          <div class="mb-2"><input id="inst" class="form-control" placeholder="Instance ID" required></div>
          <div class="mb-2"><input id="to" class="form-control" placeholder="Phone (e.g. 919876543210)" required></div>
          <div class="mb-2">
            <select id="type" class="form-select" onchange="toggleFields()">
              <option value="text">Text</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="document">Document</option>
              <option value="sticker">Sticker</option>
              <option value="location">Location</option>
              <option value="contact">Contact</option>
            </select>
          </div>
          <div class="mb-2"><input id="content" class="form-control" placeholder="Text message or media URL"></div>
          <div class="mb-2" id="extraCaption" style="display:none"><input id="caption" class="form-control" placeholder="Caption"></div>
          <div class="mb-2" id="extraLat" style="display:none"><input id="lat" class="form-control" placeholder="Latitude" type="number" step="any"></div>
          <div class="mb-2" id="extraLng" style="display:none"><input id="lng" class="form-control" placeholder="Longitude" type="number" step="any"></div>
          <div class="mb-2" id="extraName" style="display:none"><input id="cname" class="form-control" placeholder="Contact Name"></div>
          <div class="mb-2" id="extraPhone" style="display:none"><input id="cphone" class="form-control" placeholder="Contact Phone"></div>
          <button class="btn btn-success w-100">Send</button>
        </form>
        <div id="result" class="mt-2 small"></div>
      </div></div>

      <div class="card"><div class="card-body">
        <h6>Send from Sheet</h6>
        <input id="sheetName" class="form-control mb-2" placeholder="Sheet name (leave empty for active sheet)">
        <button class="btn btn-primary w-100" onclick="sendSheet()">Send from Sheet</button>
        <div id="sheetResult" class="mt-2 small"></div>
      </div></div>
    </div>
    <script>
    function toggleFields() {
      const t = document.getElementById('type').value;
      document.getElementById('extraCaption').style.display = ['image','video','document'].includes(t) ? 'block' : 'none';
      document.getElementById('extraLat').style.display = t === 'location' ? 'block' : 'none';
      document.getElementById('extraLng').style.display = t === 'location' ? 'block' : 'none';
      document.getElementById('extraName').style.display = t === 'contact' ? 'block' : 'none';
      document.getElementById('extraPhone').style.display = t === 'contact' ? 'block' : 'none';
      document.getElementById('content').placeholder = t === 'text' ? 'Text message' : t === 'location' ? 'Address (optional)' : 'Media URL';
    }

    function sendNow(e) {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      const data = {
        instanceId: document.getElementById('inst').value,
        to: document.getElementById('to').value,
        type: document.getElementById('type').value,
        text: document.getElementById('content').value,
        mediaUrl: document.getElementById('content').value,
        caption: document.getElementById('caption')?.value || '',
        latitude: parseFloat(document.getElementById('lat')?.value) || 0,
        longitude: parseFloat(document.getElementById('lng')?.value) || 0,
        contactName: document.getElementById('cname')?.value || '',
        contactPhone: document.getElementById('cphone')?.value || '',
      };
      google.script.run.withSuccessHandler(r => {
        document.getElementById('result').innerHTML = r.success ? '<span class="text-success">'+r.message+'</span>' : '<span class="text-danger">'+r.message+'</span>';
        btn.disabled = false;
      }).sendOne(data);
    }

    function sendSheet() {
      const btn = event.target;
      btn.disabled = true;
      const name = document.getElementById('sheetName').value;
      google.script.run.withSuccessHandler(r => {
        document.getElementById('sheetResult').innerHTML = r.success ? '<span class="text-success">'+r.message+'</span>' : '<span class="text-danger">'+r.message+'</span>';
        btn.disabled = false;
      }).sendFromSheetUI(name);
    }
    </script></body></html>
  `).setTitle('WhatsApp API Sender');
}

// Called from doGet form
function sendOne(data) {
  try {
    let result;
    switch (data.type) {
      case 'text':
        result = sendText(data.instanceId, data.to, data.text);
        break;
      case 'image':
        result = sendImage(data.instanceId, data.to, data.mediaUrl, data.caption);
        break;
      case 'video':
        result = sendVideo(data.instanceId, data.to, data.mediaUrl, data.caption);
        break;
      case 'audio':
        result = sendAudio(data.instanceId, data.to, data.mediaUrl);
        break;
      case 'document':
        result = sendDocument(data.instanceId, data.to, data.mediaUrl, data.caption);
        break;
      case 'sticker':
        result = sendSticker(data.instanceId, data.to, data.mediaUrl);
        break;
      case 'location':
        result = sendLocation(data.instanceId, data.to, data.latitude, data.longitude);
        break;
      case 'contact':
        result = sendContact(data.instanceId, data.to, data.contactName, data.contactPhone);
        break;
      default:
        return { success: false, message: 'Unknown type' };
    }
    return result || { success: false, message: 'No response' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// Called from doGet form
function sendFromSheetUI(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getActiveSheet();
  if (!sheet) return { success: false, message: 'Sheet not found' };

  // Get instanceId from column H or prompt the user to set it
  const instanceId = sheet.getRange(1, 8).getValue() || '';
  if (!instanceId) {
    return { success: false, message: 'Put Instance ID in cell H1 of the sheet' };
  }

  return sendFromSheet(instanceId, sheet.getName());
}
