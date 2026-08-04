const pino = require('pino');
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const {
  SESSION_DIR,
  phoneFromJid,
  readSessionInfo,
  recordLogin,
} = require('../whatsappSession');
const { describeDisconnect } = require('../whatsappErrors');
const { normalizePhone } = require('../phone');
const { isInteractive, withPrompt, chooseOption } = require('../prompt');

// Baileys logs its own connection events via pino; silenced so
// "familyos brief"/"whatsapp:link" output stays limited to what this
// module explicitly prints.
const logger = pino({ level: 'silent' });

// Linking waits on a human (scanning a QR or typing a code on their phone),
// so it gets a much longer budget than an automated send.
const LINK_TIMEOUT_MS = 180000;
const CONNECT_TIMEOUT_MS = 30000;
// WhatsApp asks for exactly one reconnect after pairing (status 515); allow a
// little headroom without ever looping forever.
const MAX_ATTEMPTS = 3;

async function resolveVersion() {
  // @whiskeysockets/baileys bakes in a fixed WhatsApp Web protocol version
  // at publish time; once WhatsApp's servers move past it, the handshake
  // is rejected (connection closes with status 405) before a QR is ever
  // produced. Fetching the current version avoids that.
  const { version, isLatest, error } = await fetchLatestBaileysVersion();
  if (!isLatest) {
    console.warn(
      `Could not fetch the latest WhatsApp Web version (${error?.message || 'unknown error'}); using the bundled default, which may be rejected.`
    );
  }
  return version;
}

async function openSocket(version) {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const sock = makeWASocket({
    auth: state,
    logger,
    version,
    browser: Browsers.ubuntu('FamilyOS'),
  });
  sock.ev.on('creds.update', saveCreds);
  return { sock, state };
}

// Resolves 'open' once authenticated, or 'restart' when WhatsApp wants the
// socket reopened to finish setup. Rejects with a human-readable message.
function waitForOpen(sock, { onQr, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish();
      reject(
        new Error(
          'Timed out waiting for WhatsApp. Check your internet connection and try again.'
        )
      );
    }, timeoutMs);

    function finish() {
      clearTimeout(timer);
      sock.ev.off('connection.update', handler);
    }

    async function handler(update) {
      const { connection, qr, lastDisconnect } = update;

      if (qr && onQr) {
        try {
          await onQr(qr);
        } catch (err) {
          finish();
          reject(err);
          return;
        }
      }

      if (connection === 'open') {
        finish();
        resolve('open');
        return;
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const { kind, message } = describeDisconnect(statusCode, lastDisconnect?.error);
        finish();
        if (kind === 'restart') {
          resolve('restart');
          return;
        }
        reject(new Error(message));
      }
    }

    sock.ev.on('connection.update', handler);
  });
}

function formatPairingCode(code) {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

// Decides QR vs. pairing code. Flags win when given (so the command stays
// scriptable); otherwise an interactive menu is shown.
async function resolvePairingChoice({ method, phone }) {
  if (method && !['qr', 'code'].includes(method)) {
    throw new Error(`Unknown --method "${method}". Use "qr" or "code".`);
  }

  if (method === 'qr') {
    return { method: 'qr' };
  }

  if (method === 'code') {
    if (phone) {
      return { method: 'code', phone: normalizePhone(phone) };
    }
    if (!isInteractive()) {
      throw new Error('--method code requires --phone <number> when running non-interactively.');
    }
    return withPrompt(async ({ ask }) => ({
      method: 'code',
      phone: normalizePhone(await ask('Phone number (with country code, e.g. +6281234567890): ')),
    }));
  }

  if (!isInteractive()) {
    throw new Error(
      'No terminal available for the interactive menu. Re-run with --method qr, or --method code --phone <number>.'
    );
  }

  return withPrompt(async ({ ask }) => {
    const chosen = await chooseOption(ask, '\nHow do you want to link WhatsApp?', [
      { value: 'qr', label: 'QR Code (scan with your phone)' },
      { value: 'code', label: 'Pairing Code (type a code on your phone)' },
    ]);

    if (chosen === 'qr') return { method: 'qr' };

    return {
      method: 'code',
      phone: normalizePhone(await ask('Phone number (with country code, e.g. +6281234567890): ')),
    };
  });
}

// Links this device to a personal WhatsApp account, by QR code or by
// pairing code. Credentials are persisted, so this runs once.
async function link(options = {}) {
  const existing = readSessionInfo();
  if (existing.registered) {
    console.log(
      `WhatsApp is already linked${existing.phone ? ` as ${existing.phone}` : ''}. Delete .familyos/whatsapp-session to re-link.`
    );
    return;
  }

  const choice = await resolvePairingChoice(options);
  const version = await resolveVersion();
  let pairingRequested = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { sock, state } = await openSocket(version);
    const needsPairing = !state.creds.registered;

    const onQr = async (qr) => {
      if (!needsPairing) return;

      if (choice.method === 'qr') {
        console.log('\nScan this QR code with WhatsApp (Linked Devices > Link a Device):\n');
        qrcode.generate(qr, { small: true });
        return;
      }

      // The QR event is our signal that the handshake finished and the
      // socket can carry the pairing-code request.
      if (!pairingRequested) {
        pairingRequested = true;
        const code = await sock.requestPairingCode(choice.phone.digits);
        console.log(`\nPairing code for ${choice.phone.e164}:\n`);
        console.log(`    ${formatPairingCode(code)}\n`);
        console.log('On your phone: WhatsApp > Linked Devices > Link a Device >');
        console.log('"Link with phone number instead", then enter the code above.\n');
      }
    };

    let result;
    try {
      result = await waitForOpen(sock, { onQr, timeoutMs: LINK_TIMEOUT_MS });
    } catch (err) {
      sock.end(undefined);
      throw err;
    }

    // Prefer the live socket identity: creds.json may not be flushed yet.
    const phone = phoneFromJid(sock.user?.id) || readSessionInfo().phone;
    sock.end(undefined);

    if (result === 'open') {
      recordLogin({ phone, waVersion: version.join('.') });
      console.log(`\nWhatsApp linked successfully${phone ? ` as ${phone}` : ''}.`);
      return;
    }

    console.log('Reconnecting to finish setting up this device...');
  }

  throw new Error(
    `WhatsApp kept asking to reconnect after ${MAX_ATTEMPTS} attempts. Try running "npm run whatsapp:link" again.`
  );
}

// Opens an authenticated connection and hands the socket to `use`.
// Reconnects once if WhatsApp asks for a restart.
async function withConnection(use) {
  const version = await resolveVersion();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { sock } = await openSocket(version);
    let result;

    try {
      result = await waitForOpen(sock, { timeoutMs: CONNECT_TIMEOUT_MS });
      if (result === 'open') {
        const value = await use(sock);
        return { value, version };
      }
    } finally {
      sock.end(undefined);
    }
  }

  throw new Error(
    `Could not establish a stable WhatsApp connection after ${MAX_ATTEMPTS} attempts.`
  );
}

async function send(text, config) {
  if (!config.whatsappTarget) {
    throw new Error('WHATSAPP_TARGET is not set.');
  }

  const session = readSessionInfo();
  if (!session.registered) {
    throw new Error('WhatsApp is not linked yet. Run "npm run whatsapp:link" first.');
  }

  const { digits } = normalizePhone(config.whatsappTarget);

  const { version } = await withConnection(async (sock) => {
    await sock.sendMessage(`${digits}@s.whatsapp.net`, { text });
  });

  recordLogin({ phone: session.phone, waVersion: version.join('.') });
}

// Live reachability probe used by doctor and status. Never throws.
async function checkConnection() {
  try {
    await withConnection(async () => {});
    return { ok: true, message: 'Connected' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = { link, send, checkConnection };
