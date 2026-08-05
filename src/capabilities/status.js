const { register } = require('./registry');
const { readSessionInfo, readMeta } = require('../whatsappSession');

function baileysVersion() {
  return require('@whiskeysockets/baileys/package.json').version;
}

// Read-only: reports the stored session and never opens a connection, so a
// reply is never blocked on the network.
register({
  id: 'status',
  command: 'status',
  aliases: ['health'],
  description: 'system and WhatsApp link status',
  action: 'system.status',
  execute: () => {
    const session = readSessionInfo();
    const meta = readMeta();

    // No phone number here: this reply goes into a chat, which can be
    // forwarded or screenshotted. "familyos whatsapp:status" shows the number
    // locally for whoever is at the terminal.
    let link = 'not linked';
    if (session.registered) link = 'linked';
    else if (session.partial) link = 'incomplete pairing';
    else if (session.error) link = 'session file damaged';

    return [
      'FamilyOS status',
      '',
      `WhatsApp:  ${link}`,
      `Last login: ${meta.lastLogin || 'never'}`,
      `Transport:  Baileys ${baileysVersion()}${meta.waVersion ? ` (WhatsApp Web ${meta.waVersion})` : ''}`,
    ].join('\n');
  },
});
