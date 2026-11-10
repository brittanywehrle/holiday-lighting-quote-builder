/**
 * Wehrle Quote Builder → Google Sheet sync.
 *
 * Paste this whole file into the sheet's Apps Script editor (Extensions → Apps Script), then
 * Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 * Paste the Web app URL into the quote app's Settings → Google Sheet sync.
 *
 * The app sends one row per job, keyed by the hidden Job ID column, and this script adds or
 * updates that row. It only writes the columns the app sends. Everything else is left alone:
 * the hand-filled columns below (yellow headers), and any column you add yourself.
 * Deleting a job in the app removes its row, unless something was typed in the hand-filled
 * columns; then the row stays and its Status becomes "Deleted in app".
 */
const SHEET_NAME = 'Jobs';
const ID = 'Job ID';
const STATUSES = ['Draft', 'Sent', 'Approved', 'Scheduled', 'Completed', 'Declined', 'Deleted in app'];
const PAYMENTS = ['Not paid', 'Deposit received', 'Fully paid'];
const MANUAL = ['True linear ft', 'Labor paid', 'Hours', 'Notes'];  // filled in by hand after the job
const LAYOUT = [ID, 'Proposal #', 'Customer', 'Status', 'Install date', 'Payment',
  'Option 1', 'Option 1 price', 'Option 2', 'Option 2 price', 'Option 3', 'Option 3 price',
  'True linear ft', 'Labor paid', 'Hours', 'Notes',
  'Address', 'Phone', 'Email', 'Created', 'Date sent', 'New customer', 'Startup fee', 'Last updated'];
const DATES = ['Created', 'Date sent', 'Install date', 'Last updated'];
const GREEN = '#1B5E3B', GOLD = '#D4A537';

function doGet() {
  return out_({ ok: true, app: 'wehrle-sheet-sync', version: 1, message: 'Sync is set up. Paste this page\'s URL into the quote app\'s Settings.' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const sh = sheet_();
    const rows = Array.isArray(body.rows) ? body.rows.filter(r => r && r[ID]) : [];
    const dels = Array.isArray(body.deletes) ? body.deletes : [];
    if (rows.length) upsert_(sh, rows);
    if (dels.length) remove_(sh, dels);
    return out_({ ok: true, upserted: rows.length, deleted: dels.length });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    const first = ss.getSheets()[0];
    // A brand-new spreadsheet has one empty "Sheet1": rename it rather than leaving it behind.
    if (ss.getSheets().length === 1 && first.getLastRow() === 0) sh = first.setName(SHEET_NAME);
    else sh = ss.insertSheet(SHEET_NAME);
  }
  return sh;
}

/** Makes sure every column exists. A new sheet gets the standard layout; anything missing later
    (e.g. "Option 4") is added on the right. */
function headers_(sh, keys) {
  const lastCol = sh.getLastColumn();
  const head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  let changed = !lastCol;
  for (const k of LAYOUT.concat(keys)) if (head.indexOf(k) < 0) { head.push(k); changed = true; }
  if (changed) {
    if (sh.getMaxColumns() < head.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns());
    const r = sh.getRange(1, 1, 1, head.length);
    r.setValues([head]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(GREEN).setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    sh.setRowHeight(1, 28);
    MANUAL.forEach(h => sh.getRange(1, head.indexOf(h) + 1).setBackground(GOLD).setFontColor('#111111'));
    formatColumns_(sh, head);
  }
  return head;
}

function formatColumns_(sh, head) {
  const n = Math.max(sh.getMaxRows() - 1, 1);
  head.forEach((h, i) => {
    const col = sh.getRange(2, i + 1, n, 1);
    if (h === ID || h === 'Phone') col.setNumberFormat('@');
    else if (h === 'Startup fee' || h === 'Labor paid' || / price$/.test(h)) col.setNumberFormat('"$"#,##0.00');
    else if (h === 'True linear ft') col.setNumberFormat('#,##0');
    else if (h === 'Hours') col.setNumberFormat('0.##');
    else if (h === 'Created' || h === 'Date sent' || h === 'Install date') col.setNumberFormat('mmm d, yyyy');
    else if (h === 'Notes') col.setWrap(true);
    else if (h === 'Payment') col.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PAYMENTS, true).setAllowInvalid(true).build());
    else if (h === 'Last updated') col.setNumberFormat('mmm d, yyyy h:mm am/pm');
    else if (h === 'Status') col.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(true).build());
    if (!sh.isColumnHiddenByUser(i + 1)) sh.setColumnWidth(i + 1, h === 'Address' || h === 'Notes' ? 260 : h === 'Customer' || h === 'Email' || /^Option \d+$/.test(h) ? 200 : 120);
  });
  const idCol = head.indexOf(ID) + 1;
  if (idCol) sh.hideColumns(idCol);
}

/** "2026-11-05" or "2026-11-05 18:30" (the iPad's local time) → a real date in the sheet. */
function value_(h, v) {
  if (v === null || v === undefined) return '';
  if (DATES.indexOf(h) >= 0 && typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  }
  return v;
}

function upsert_(sh, rows) {
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r)) if (keys.indexOf(k) < 0) keys.push(k);
  if (keys.indexOf(ID) > 0) { keys.splice(keys.indexOf(ID), 1); keys.unshift(ID); }
  const head = headers_(sh, keys);
  const idCol = head.indexOf(ID) + 1;
  const last = sh.getLastRow();
  const at = {};
  if (last > 1) sh.getRange(2, idCol, last - 1, 1).getValues().forEach((v, i) => { if (v[0]) at[String(v[0])] = i + 2; });
  let next = Math.max(last, 1) + 1;
  for (const r of rows) {
    const id = String(r[ID]);
    const rowNo = at[id] || (at[id] = next++);
    const line = rowNo <= last ? sh.getRange(rowNo, 1, 1, head.length).getValues()[0] : head.map(() => '');
    // Only the app's columns change. Option columns the job no longer has are cleared.
    head.forEach((h, i) => {
      if (MANUAL.indexOf(h) >= 0) return;
      if (h in r) line[i] = value_(h, r[h]);
      else if (/^Option \d+( price)?$/.test(h)) line[i] = '';
    });
    sh.getRange(rowNo, 1, 1, head.length).setValues([line]);
  }
}

function remove_(sh, ids) {
  const head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  const idCol = head.indexOf(ID) + 1, last = sh.getLastRow();
  if (!idCol || last < 2) return;
  const want = {}; ids.forEach(i => { want[String(i)] = true; });
  const vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  const manual = MANUAL.map(h => head.indexOf(h)).filter(i => i >= 0), st = head.indexOf('Status');
  for (let i = vals.length - 1; i >= 0; i--) {
    if (!want[String(vals[i][idCol - 1])]) continue;
    // Keep rows with hand-entered job results so that work isn't lost.
    if (manual.some(c => vals[i][c] !== '' && vals[i][c] !== null)) { if (st >= 0) sh.getRange(i + 2, st + 1).setValue('Deleted in app'); }
    else sh.deleteRow(i + 2);
  }
}
