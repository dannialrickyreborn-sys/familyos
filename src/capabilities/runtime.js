const { loadCapabilities } = require('./index');

// Why a command did not run, so callers can branch without matching on prose.
const REASON = {
  UNKNOWN_COMMAND: 'unknown_command',
  FORBIDDEN: 'forbidden',
  FAILED: 'failed',
};

// Splits "/family list" into { word: 'family', args: ['list'] }.
// Returns null when the text is not a command at all — this is the only
// command-shaped knowledge the router needs.
function parseCommand(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('/')) return null;

  const [word, ...args] = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (!word) return null;

  return { word: word.toLowerCase(), args };
}

// An empty permissions list means any active member; otherwise the member's
// role has to be listed.
function isPermitted(capability, member) {
  if (capability.permissions.length === 0) return true;
  return capability.permissions.includes(member.role);
}

// Resolves a parsed command to a capability, checks permissions, runs it, and
// returns a response. Never throws for ordinary outcomes: an unknown command, a
// forbidden one, or a capability that itself fails all come back as a response
// with a reply, so one broken capability cannot take the runtime down.
function execute(command, { member, family, capabilities = loadCapabilities() } = {}) {
  const capability = capabilities.resolve(command.word);

  if (!capability) {
    return {
      ok: false,
      reason: REASON.UNKNOWN_COMMAND,
      capability: null,
      reply: `Unknown command "/${command.word}". Send /help for the list.`,
    };
  }

  if (!isPermitted(capability, member)) {
    return {
      ok: false,
      reason: REASON.FORBIDDEN,
      capability: capability.id,
      reply: `The /${capability.command} command is limited to: ${capability.permissions.join(', ')}.`,
    };
  }

  try {
    return {
      ok: true,
      reason: null,
      capability: capability.id,
      reply: capability.execute({ member, family, capabilities, args: command.args }),
    };
  } catch (err) {
    return {
      ok: false,
      reason: REASON.FAILED,
      capability: capability.id,
      reply: `The /${capability.command} command failed: ${err.message}`,
    };
  }
}

module.exports = { REASON, parseCommand, execute, loadCapabilities };
