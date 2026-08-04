const { readSessionInfo, readMeta } = require('./whatsappSession');

function baileysVersion() {
  return require('@whiskeysockets/baileys/package.json').version;
}

async function runStatus() {
  const session = readSessionInfo();
  const meta = readMeta();

  console.log('FamilyOS WhatsApp Status\n');

  if (session.error) {
    console.log(`Linked:            no (session unreadable: ${session.error})`);
  } else {
    console.log(`Linked:            ${session.registered ? 'yes' : 'no'}`);
  }

  console.log(`Phone:             ${session.phone || meta.phone || '(unknown)'}`);

  if (session.registered) {
    // Only probe the network when there is a session worth probing.
    const { checkConnection } = require('./transports/whatsapp');
    const result = await checkConnection();
    console.log(`Connection status: ${result.ok ? 'connected' : `unreachable — ${result.message}`}`);
  } else {
    console.log('Connection status: not connected (run "npm run whatsapp:link")');
  }

  console.log(`Last login:        ${meta.lastLogin || '(never)'}`);
  console.log(
    `Transport version: Baileys ${baileysVersion()}${
      meta.waVersion ? ` (WhatsApp Web ${meta.waVersion})` : ''
    }`
  );
}

module.exports = { runStatus };
