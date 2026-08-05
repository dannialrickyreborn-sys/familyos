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

// { exists, registered, partial, phone, error } — never throws.
//
// `partial` marks a session that carries an identity (creds.me) without having
// completed registration. Baileys picks its handshake on `creds.me` alone
// (Socket/socket.js: `if (!creds.me) registration else login`), so such a
// session makes it send a *login* for a device that was never registered —
// which WhatsApp answers with failure 401. requestPairingCode() sets creds.me
// and emits creds.update immediately, so any interrupted pairing leaves this
// state behind and every later attempt fails until it is cleared.
function readSessionInfo() {
  if (!fs.existsSync(CREDS_PATH)) {
    return { exists: false, registered: false, partial: false, phone: '', error: null };
  }

  try {
    const creds = readJson(CREDS_PATH);
    const registered = Boolean(creds.registered);
    const hasIdentity = Boolean(creds.me && creds.me.id);
    return {
      exists: true,
      registered,
      partial: hasIdentity && !registered,
      phone: phoneFromJid(creds.me && creds.me.id),
      error: null,
    };
  } catch (err) {
    return { exists: true, registered: false, partial: false, phone: '', error: err.message };
  }
}

// Removes the stored session so the next link starts from a clean handshake.
function clearSession() {
  fs.rmSync(SESSION_DIR, { recursive: true, force: true });
}

// Proves a link actually persisted: the file must exist, be non-empty, parse,
// and carry a registered identity. Used right after pairing so success is never
// reported for a session that cannot be read back.
function verifySession() {
  if (!fs.existsSync(CREDS_PATH)) {
    return { ok: false, bytes: 0, reason: `${CREDS_PATH} was not created` };
  }

  const bytes = fs.statSync(CREDS_PATH).size;
  if (bytes === 0) {
    return { ok: false, bytes, reason: 'creds.json is empty (0 bytes)' };
  }

  try {
    const creds = readJson(CREDS_PATH);
    if (!creds.registered) {
      return { ok: false, bytes, reason: 'creds.json does not record a completed registration' };
    }
    if (!(creds.me && creds.me.id)) {
      return { ok: false, bytes, reason: 'creds.json has no account identity' };
    }
  } catch (err) {
    return { ok: false, bytes, reason: `creds.json is not valid JSON: ${err.message}` };
  }

  return { ok: true, bytes, reason: '' };
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

  // Same atomic pattern as the session files: a partially written meta file
  // would make whatsapp:status unreadable for no good reason.
  const tmpPath = `${META_PATH}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(meta, null, 2)}\n`);
  fs.renameSync(tmpPath, META_PATH);
}

module.exports = {
  STATE_DIR,
  SESSION_DIR,
  CREDS_PATH,
  META_PATH,
  phoneFromJid,
  readSessionInfo,
  clearSession,
  verifySession,
  readMeta,
  recordLogin,
};
