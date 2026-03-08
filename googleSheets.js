const { google } = require('googleapis');

// ─── Google Sheets Column Map ─────────────────────────────────────────────────
// Row 1 is the header. Data starts at Row 2.
// A=Name, B=Email, C=DeviceID, D=Plan, E=ExpireDate,
// F=DailyLimit, G=UsageToday, H=RegisterDate, I=Status

const SHEET_NAME = 'Users';
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

// ─── Auth ─────────────────────────────────────────────────────────────────────
function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

// ─── Read all users ───────────────────────────────────────────────────────────
async function getAllUsers() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:I`,
  });
  return (res.data.values || []).map(rowToUser);
}

// ─── Find user by DeviceID ────────────────────────────────────────────────────
async function findUserByDeviceId(deviceId) {
  const users = await getAllUsers();
  return users.find(u => u.deviceId === deviceId) || null;
}

// ─── Find user by Email ───────────────────────────────────────────────────────
async function findUserByEmail(email) {
  const users = await getAllUsers();
  return users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

// ─── Register new user (append row) ──────────────────────────────────────────
async function registerUser({ name, email, deviceId }) {
  const sheets = getSheetsClient();
  const today = new Date().toISOString().split('T')[0];

  const values = [[
    name,        // A - Name
    email,       // B - Email
    deviceId,    // C - DeviceID
    'Free',      // D - Plan
    '',          // E - ExpireDate
    3,           // F - DailyLimit
    0,           // G - UsageToday
    today,       // H - RegisterDate
    'Active',    // I - Status
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:I`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  return rowToUser(values[0]);
}

// ─── Increment UsageToday for a device ───────────────────────────────────────
async function incrementUsage(deviceId) {
  const sheets = getSheetsClient();

  // Find row index
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:I`,
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((r, i) => i > 0 && r[2] === deviceId);

  if (rowIndex === -1) throw new Error('User not found');

  const user = rowToUser(rows[rowIndex]);
  const newUsage = (parseInt(user.usageToday) || 0) + 1;

  // Update cell G (UsageToday), rowIndex+1 because sheets is 1-indexed
  const sheetRow = rowIndex + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!G${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[newUsage]] },
  });

  return { ...user, usageToday: newUsage };
}

// ─── Reset daily usage (call via cron at midnight) ───────────────────────────
async function resetDailyUsage() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:I`,
  });
  const rows = (res.data.values || []).slice(1); // skip header

  // Build batch update to set column G to 0 for all rows
  const data = rows.map((row, i) => ({
    range: `${SHEET_NAME}!G${i + 2}`,
    values: [[0]],
  }));

  if (data.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'RAW', data },
    });
  }
}

// ─── Helper: map row array → user object ─────────────────────────────────────
function rowToUser(row) {
  return {
    name: row[0] || '',
    email: row[1] || '',
    deviceId: row[2] || '',
    plan: row[3] || 'Free',
    expireDate: row[4] || null,
    dailyLimit: parseInt(row[5]) || 3,
    usageToday: parseInt(row[6]) || 0,
    registerDate: row[7] || '',
    status: row[8] || 'Active',
  };
}

module.exports = {
  getAllUsers,
  findUserByDeviceId,
  findUserByEmail,
  registerUser,
  incrementUsage,
  resetDailyUsage,
};
