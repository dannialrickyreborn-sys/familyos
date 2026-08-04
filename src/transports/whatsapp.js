const pino = require('pino');
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { SESSION_DIR } = require('../whatsappSession');

// Baileys logs its own connection events via pino; silenced so
// "familyos brief"/"whatsapp:link" output stays limited to what this
// module explicitly prints.
const logger = pino({ level: 'silent' });

async function openSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

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

  const sock = makeWASocket({
    auth: state,
    logger,
    version,
    browser: Browsers.ubuntu('FamilyOS'),
  });
  sock.ev.on('creds.update', saveCreds);
  return { sock, state };
}

// Links this device to a personal WhatsApp account by displaying a QR
// code for the user to scan (WhatsApp app > Linked Devices > Link a Device).
async function link() {
  const { sock, state } = await openSocket();

  if (state.creds.registered) {
    console.log('WhatsApp is already linked. Delete .familyos/whatsapp-session to re-link.');
    sock.end(undefined);
    return;
  }

  await new Promise((resolve, reject) => {
    sock.ev.on('connection.update', (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        console.log('Scan this QR code with WhatsApp (Linked Devices > Link a Device):\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        console.log('\nWhatsApp linked successfully.');
        resolve();
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        reject(new Error(`WhatsApp connection closed (status ${statusCode || 'unknown'}) before linking completed.`));
      }
    });
  });

  sock.end(undefined);
}

async function send(text, config) {
  if (!config.whatsappTarget) {
    throw new Error('WHATSAPP_TARGET is not set.');
  }

  const { sock, state } = await openSocket();

  if (!state.creds.registered) {
    sock.end(undefined);
    throw new Error('WhatsApp is not linked yet. Run "npm run whatsapp:link" first.');
  }

  await new Promise((resolve, reject) => {
    sock.ev.on('connection.update', (update) => {
      if (update.connection === 'open') resolve();
      if (update.connection === 'close') {
        reject(new Error('WhatsApp connection closed before it opened.'));
      }
    });
  });

  const jid = `${config.whatsappTarget}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text });
  sock.end(undefined);
}

module.exports = { link, send };
