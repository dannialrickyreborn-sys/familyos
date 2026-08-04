const pino = require('pino');
const {
  makeWASocket,
  fetchLatestWaWebVersion,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const { useAtomicFileAuthState } = require('../whatsappAuthState');
const { version: BUNDLED_VERSION } = require('@whiskeysockets/baileys/lib/Defaults/baileys-version.json');
const qrcode = require('qrcode-terminal');
const {
  SESSION_DIR,
  phoneFromJid,
  readSessionInfo,
  clearSession,
  verifySession,
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

// The version bundled in @whiskeysockets/baileys is fixed at publish time and
// gets rejected once WhatsApp's servers move past it (failure 405), so it is
// only ever a last resort. Sources are tried most-authoritative first:
//   1. the client_revision live WhatsApp Web is serving right now
//   2. the revision Baileys' maintainers last published
//   3. whatever shipped in the installed package
async function resolveVersion() {
  const sources = [
    { label: 'live WhatsApp Web', fetch: fetchLatestWaWebVersion },
    { label: 'Baileys upstream', fetch: fetchLatestBaileysVersion },
  ];

  const problems = [];
  for (const source of sources) {
    const { version, isLatest, error } = await source.fetch();
    if (isLatest) return version;
    problems.push(`${source.label}: ${error?.message || 'unavailable'}`);
  }

  console.warn(
    `Could not determine the current WhatsApp Web version (${problems.join('; ')}). Falling back to the version bundled with Baileys, which WhatsApp may reject.`
  );
  return BUNDLED_VERSION;
}

async function openSocket(version) {
  const { state, saveCreds } = await useAtomicFileAuthState(SESSION_DIR);
  const sock = makeWASocket({
    auth: state,
    logger,
    version,
    // The middle element is the *browser* name and goes into the handshake
    // fingerprint, so it has to be a browser WhatsApp recognises — a custom
    // value like "FamilyOS" risks being rejected. The device name shown under
    // Linked Devices comes from the platform, not from this string.
    browser: Browsers.ubuntu('Chrome'),
  });
  sock.ev.on('creds.update', saveCreds);
  return { sock, state, saveCreds };
}

// Resolves 'open' once authenticated, or 'restart' when WhatsApp wants the
// socket reopened to finish setup. Rejects with a human-readable message.
function waitForOpen(sock, { onQr, timeoutMs, pairing = false }) {
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
        const { kind, message } = describeDisconnect(statusCode, lastDisconnect?.error, {
          pairing,
        });
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

  // A half-finished pairing claims an identity it never registered, which makes
  // Baileys attempt a login instead of a registration and get failure 401 every
  // time. Reset it here so a retry cannot inherit the broken state.
  if (existing.partial || existing.error) {
    clearSession();
    console.log('Discarded an incomplete WhatsApp session from a previous attempt.');
  }

  const choice = await resolvePairingChoice(options);
  const version = await resolveVersion();
  let pairingRequested = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { sock, state, saveCreds } = await openSocket(version);
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
      result = await waitForOpen(sock, {
        onQr,
        timeoutMs: LINK_TIMEOUT_MS,
        pairing: needsPairing,
      });
    } catch (err) {
      sock.end(undefined);
      // requestPairingCode() persists an identity as soon as it runs, so a
      // failure here can leave the same half-paired state behind. Clear it so
      // the next run starts from a registration handshake instead of inheriting
      // a login that can only fail.
      if (readSessionInfo().partial) {
        clearSession();
        console.error('The incomplete session was reset — run "npm run whatsapp:link" to try again.');
      }
      throw err;
    }

    const phone = phoneFromJid(sock.user?.id) || readSessionInfo().phone;

    if (result === 'open') {
      // Persist explicitly before closing rather than relying on the last
      // creds.update having already been handled, then prove the session can be
      // read back. Reporting success for a session that does not survive the
      // process is what made this fail silently before.
      await saveCreds();
      sock.end(undefined);

      const check = verifySession();
      if (!check.ok) {
        throw new Error(
          `Pairing completed but the session was not stored correctly: ${check.reason}. Run "npm run whatsapp:link" again.`
        );
      }

      recordLogin({ phone, waVersion: version.join('.') });
      console.log(
        `\nWhatsApp linked successfully${phone ? ` as ${phone}` : ''} — session stored (${check.bytes} bytes).`
      );
      return;
    }

    sock.end(undefined);

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
  if (session.partial) {
    throw new Error(
      'A previous WhatsApp pairing was left incomplete. Run "npm run whatsapp:link" to finish linking (the stale session is reset automatically).'
    );
  }
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
