/**
 * Payslip Desk – archive mailer
 * Runs under the company Gmail account and emails archive files sent by Payslip Desk.
 *
 * Setup (once, signed in as the company Gmail, e.g. rajendraengg2018@gmail.com):
 *  1. Go to https://script.google.com → New project. Name it "Payslip Desk mailer".
 *  2. Replace everything in Code.gs with this file.
 *  3. Change SECRET below to a word only owners know (letters and numbers, 12+ characters).
 *  4. Deploy → New deployment → type "Web app".
 *       Execute as: Me      Who has access: Anyone
 *     Click Deploy, allow the permissions, and copy the Web app URL.
 *  5. In Payslip Desk → Company details → Archive email: paste the URL and the same secret word. Save, then "Send a test email".
 */
const SECRET = 'CHANGE-ME-to-a-long-secret-word';
const ALLOWED_TO = ['rajendraengg2018@gmail.com', 'rsautomation22@gmail.com'];   // archives can only go to these addresses
const MAX_BYTES = 24 * 1024 * 1024;

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (!req.token || req.token !== SECRET) return reply({ ok: false, error: 'Wrong secret word.' });
    const to = String(req.to || '').toLowerCase().trim();
    if (ALLOWED_TO.indexOf(to) < 0) return reply({ ok: false, error: 'This address is not allowed: ' + to });
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
