const { activeMembers } = require('./familyRegistry');
const { readSessionInfo, readMeta } = require('./whatsappSession');

// Splits "/family list" into { name: 'family', args: ['list'] }.
// Returns null when the text is not a command at all.
function parseCommand(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('/')) return null;

  const [word, ...args] = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (!word) return null;

  return { name: word.toLowerCase(), args };
}

function help() {
  return [
    'FamilyOS commands',
    '',
    '/help    show this list',
    '/status  system and WhatsApp link status',
    '/family  list active family members',
    '/ping    check that FamilyOS is responding',
  ].join('\n');
}

function baileysVersion() {
  return require('@whiskeysockets/baileys/package.json').version;
}

// Read-only: reports the stored session, never opens a connection, so a
// command reply is never blocked on the network.
function status() {
  const session = readSessionInfo();
  const meta = readMeta();

  let link = 'not linked';
  if (session.registered) link = `linked${session.phone ? ` as ${session.phone}` : ''}`;
  else if (session.partial) link = 'incomplete pairing';
  else if (session.error) link = 'session file damaged';

  return [
    'FamilyOS status',
    '',
    `WhatsApp:  ${link}`,
    `Last login: ${meta.lastLogin || 'never'}`,
    `Transport:  Baileys ${baileysVersion()}${meta.waVersion ? ` (WhatsApp Web ${meta.waVersion})` : ''}`,
  ].join('\n');
}

function family(registry) {
  const members = activeMembers(registry);
  if (members.length === 0) return 'No active family members are registered.';

  const lines = members.map((member) => `- ${member.name} (${member.id}) — ${member.role}`);
  return [`Family members (${members.length} active)`, '', ...lines].join('\n');
}

function ping(member) {
  return `pong — hello ${member.name}.`;
}

// Executes an already-parsed command on behalf of a resolved member.
// Returns the reply text; unknown commands get a nudge rather than silence.
function executeCommand({ command, member, registry }) {
  switch (command.name) {
    case 'help':
      return help();
    case 'status':
      return status();
    case 'family':
      return family(registry);
    case 'ping':
      return ping(member);
    default:
      return `Unknown command "/${command.name}". Send /help for the list.`;
  }
}

module.exports = { parseCommand, executeCommand };
