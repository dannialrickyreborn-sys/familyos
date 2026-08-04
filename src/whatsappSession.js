const fs = require('fs');
const path = require('path');

// Local runtime state, gitignored. Kept free of Baileys imports so that
// doctor/status can inspect the session without loading the library or
// opening a socket.
const STATE_DIR = path.join(process.cwd(), '.familyos');
const SESSION_DIR = path.join(STATE_DIR, 'whatsapp-session');
const CREDS_PATH = path.join(SESSION_DIR, 'creds.json');
const META_PATH = path.join(STATE_DIR, 'whatsapp-meta.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Baileys stores the account as a JID like "6281234567890:12@s.whatsapp.net".
function phoneFromJid(jid) {
  if (!jid) return '';
  const digits = String(jid).split('@')[0].split(':')[0];
  return digits ? `+${digits}` : '';
}

// { exists, registered, phone, error } — never throws.
function readSessionInfo() {
  if (!fs.existsSync(CREDS_PATH)) {
    return { exists: false, registered: false, phone: '', error: null };
  }

  try {
    const creds = readJson(CREDS_PATH);
    return {
      exists: true,
      registered: Boolean(creds.registered),
      phone: phoneFromJid(creds.me && creds.me.id),
      error: null,
    };
  } catch (err) {
    return { exists: true, registered: false, phone: '', error: err.message };
  }
}

function readMeta() {
  if (!fs.existsSync(META_PATH)) return {};
  try {
    return readJson(META_PATH);
  } catch {
    return {};
  }
}

// Records a successful authenticated connection, so "whatsapp:status" can
// report when FamilyOS last actually logged in and with which WA version.
function recordLogin({ phone, waVersion }) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const meta = {
    ...readMeta(),
    lastLogin: new Date().toISOString(),
  };
  if (phone) meta.phone = phone;
  if (waVersion) meta.waVersion = waVersion;
  fs.writeFileSync(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);
}

module.exports = {
  STATE_DIR,
  SESSION_DIR,
  CREDS_PATH,
  META_PATH,
  phoneFromJid,
  readSessionInfo,
  readMeta,
  recordLogin,
};
