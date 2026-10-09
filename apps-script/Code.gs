/**
 * Payslip Desk – archive mailer
 * Emails archive files sent by Payslip Desk, from the Gmail account that owns this script.
 * The address archives go to is set in Payslip Desk (Company details -> Archive email) and can be changed any time.
 *
 * Setup (once, signed in as the Gmail that should send the archives, e.g. makudapathycibi@gmail.com):
 *  1. Go to https://script.google.com → New project. Name it "Payslip Desk mailer".
 *  2. Replace everything in Code.gs with this file.
 *  3. Change SECRET below to a word only owners know (letters and numbers, 12+ characters).
 *     Only owners can see this word inside Payslip Desk.
 *  4. Deploy → New deployment → type "Web app".
 *       Execute as: Me      Who has access: Anyone
 *     Click Deploy, allow the permissions, and copy the Web app URL.
 *  5. In Payslip Desk → Company details → Archive email: enter where archives go, paste the URL and the same secret word. Save, then "Send a test email".
 */
const SECRET = 'CHANGE-ME-to-a-long-secret-word';
const MAX_BYTES = 24 * 1024 * 1024;

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (!req.token || req.token !== SECRET) return reply({ ok: false, error: 'Wrong secret word.' });
    const to = String(req.to || '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return reply({ ok: false, error: 'Not a valid email address: ' + to });
    let total = 0;
    const attachments = (req.files || []).map(function (f) {
      const bytes = Utilities.base64Decode(f.b64);
      total += bytes.length;
      return Utilities.newBlob(bytes, f.mime || 'application/octet-stream', f.name || 'file');
    });
    if (total > MAX_BYTES) return reply({ ok: false, error: 'Attachments are larger than 24 MB.' });
    MailApp.sendEmail({
      to: to,
      subject: String(req.subject || 'Payslip Desk archive').slice(0, 200),
      body: String(req.body || ''),
      attachments: attachments,
      name: 'Payslip Desk'
    });
    return reply({ ok: true, sent: attachments.length, quotaLeft: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function doGet() { return reply({ ok: true, service: 'Payslip Desk mailer' }); }

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
