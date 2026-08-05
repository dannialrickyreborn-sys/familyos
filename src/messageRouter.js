const { findByPhone } = require('./familyRegistry');
const { phoneFromJid } = require('./whatsappSession');
const { parseCommand, execute } = require('./capabilities/runtime');

// Outcomes, so callers can branch without matching on prose:
//   unknown_sender — not an active member; no reply is produced on purpose
//   not_a_command  — a known member sent ordinary text
//   handled        — a command ran and produced a reply
const RESULT = {
  UNKNOWN_SENDER: 'unknown_sender',
  NOT_A_COMMAND: 'not_a_command',
  HANDLED: 'handled',
};

// Accepts either a raw WhatsApp JID ("62812...@s.whatsapp.net") or a plain
// phone number, so the router can be driven by the transport or by the CLI.
function senderPhone(from) {
  const value = String(from || '');
  return value.includes('@') ? phoneFromJid(value) : value;
}

// Routes one inbound message. Pure: it reads the registry and the stored
// session, and returns what should happen — it never sends anything itself.
//
// The router knows nothing about individual commands. It establishes who is
// speaking, decides whether the text is a command at all, and hands it to the
// capability runtime; which capabilities exist is entirely the runtime's
// business. `capabilities` is only ever passed in by tests.
function routeMessage({ from, text }, registry, capabilities) {
  const phone = senderPhone(from);
  const member = phone ? findByPhone(registry, phone) : null;

  // Unknown senders are refused before the text is looked at, and are
  // deliberately not answered: replying would confirm the number is live to
  // anyone probing it, and unsolicited replies raise the account's ban risk.
  if (!member) {
    return { result: RESULT.UNKNOWN_SENDER, member: null, reply: null, phone };
  }

  const command = parseCommand(text);
  if (!command) {
    return { result: RESULT.NOT_A_COMMAND, member, reply: null, phone };
  }

  const response = execute(command, { member, family: registry, capabilities });

  return {
    result: RESULT.HANDLED,
    member,
    reply: response.reply,
    phone,
    command: command.word,
    capability: response.capability,
    ok: response.ok,
    reason: response.reason,
  };
}

module.exports = { RESULT, routeMessage };
