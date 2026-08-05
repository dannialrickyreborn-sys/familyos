const { loadCapabilities } = require('./index');
const { authorize } = require('../policy/engine');

// Why a command did not run, so callers can branch without matching on prose.
// A refusal carries the Policy Engine's own reason (permission_denied,
// inactive_actor, ...) rather than flattening every refusal into one code.
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

  // The coarse gate: could this actor ever perform the capability's action?
  // A capability acting on a specific subject asks the Policy Engine again with
  // that resource, which is where "about myself" and "about someone else" part
  // company. The runtime never inspects a role to decide this.
  const decision = authorize(member, capability.action);
  if (!decision.allow) {
    return {
      ok: false,
      reason: REASON.FORBIDDEN,
      policyReason: decision.reason,
      capability: capability.id,
      reply: `Not allowed: ${decision.detail}`,
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
