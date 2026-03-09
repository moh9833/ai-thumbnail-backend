const { google } = require('googleapis');

// ─── Column Map ───────────────────────────────────────────────────────────────
// A=Name, B=Email, C=DeviceID, D=Phone, E=Country,
// F=Plan, G=ExpireDate, H=DailyLimit, I=UsageToday, J=RegisterDate, K=Status

const SHEET_NAME = 'Users';
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

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

async function getAllUsers() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:K`,
  });
  return (res.data.values || []).map(rowToUser);
}

async function findUserByDeviceId(deviceId) {
  const users = await getAllUsers();
  return users.find(u => u.deviceId === deviceId) || null;
}

async function findUserByEmail(email) {
  const users = await getAllUsers();
  return users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

async function registerUser({ name, email, deviceId, phone, country }) {
  const sheets = getSheetsClient();
  const today = new Date().toISOString().split('T')[0];

  const values = [[
    name,        // A - Name
    email,       // B - Email
    deviceId,    // C - DeviceID
    phone || '', // D - Phone
    country || '',// E - Country
    'Free',      // F - Plan
    '',          // G - ExpireDate
    3,           // H - DailyLimit
    0,           // I - UsageToday
    today,       // J - RegisterDate
    'Active',    // K - Status
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:K`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  return rowToUser(values[0]);
}

async function incrementUsage(deviceId) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:K`,
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((r, i) => i > 0 && r[2] === deviceId);
  if (rowIndex === -1) throw new Error('User not found');

  const user = rowToUser(rows[rowIndex]);
  const newUsage = (parseInt(user.usageToday) || 0) + 1;
  const sheetRow = rowIndex + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!I${sheetRow}`, // Column I = UsageToday
    valueInputOption: 'RAW',
    requestBody: { values: [[newUsage]] },
  });

  return { ...user, usageToday: newUsage };
}

function rowToUser(row) {
  return {
    name: row[0] || '',
    email: row[1] || '',
    deviceId: row[2] || '',
    phone: row[3] || '',
    country: row[4] || '',
    plan: row[5] || 'Free',
    expireDate: row[6] || null,
    dailyLimit: parseInt(row[7]) || 3,
    usageToday: parseInt(row[8]) || 0,
    registerDate: row[9] || '',
    status: row[10] || 'Active',
  };
}


// ─── Update deviceId when user logs in on new device ─────────────────────────
async function updateDeviceId(email, newDeviceId) {
  const sheetsClient = getSheetsClient();
  const res = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:K`,
  });
  const rows = res.data.values || [];
  // Find row by email (column B = index 1)
  const rowIndex = rows.findIndex((r, i) => i > 0 && r[1] && r[1].toLowerCase() === email.toLowerCase());
  if (rowIndex === -1) throw new Error('User not found in sheet');

  const sheetRow = rowIndex + 1;
  await sheetsClient.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!C${sheetRow}`, // Column C = DeviceID
    valueInputOption: 'RAW',
    requestBody: { values: [[newDeviceId]] },
  });
}

module.exports = { getAllUsers, findUserByDeviceId, findUserByEmail, registerUser, incrementUsage, updateDeviceId };
