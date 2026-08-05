const { loadRegistry } = require('./familyRegistry');
const { routeMessage, RESULT } = require('./messageRouter');

// Runs one message through the router exactly as an inbound WhatsApp message
// would be, and prints the decision. This is how routing is exercised while the
// transport is send-only: no message is sent anywhere.
function runMessage({ from, text }) {
  if (!from) {
    throw new Error('--from <phone-or-jid> is required.');
  }
  if (!text) {
    throw new Error('A message body is required, e.g. familyos message --from +62... "/help"');
  }

  const registry = loadRegistry();
  const outcome = routeMessage({ from, text }, registry);

  switch (outcome.result) {
    case RESULT.UNKNOWN_SENDER:
      console.log(`REJECTED — ${outcome.phone || from} is not an active family member. No reply sent.`);
      process.exitCode = 1;
      return;

    case RESULT.NOT_A_COMMAND:
      console.log(`IGNORED — ${outcome.member.name} (${outcome.member.id}) sent no command.`);
      return;

    case RESULT.HANDLED:
      console.log(`HANDLED /${outcome.command} for ${outcome.member.name} (${outcome.member.id})\n`);
      console.log('--- reply ---');
      console.log(outcome.reply);
      return;

    default:
      throw new Error(`Unhandled routing result: ${outcome.result}`);
  }
}

module.exports = { runMessage };
