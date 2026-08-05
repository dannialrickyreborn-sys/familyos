const { routeMessage, RESULT } = require('./messageRouter');

// Why an inbound message was not acted on.
const IGNORED = {
  NOT_NEW: 'not_new',
  NO_SENDER: 'no_sender',
  FROM_ME: 'from_me',
  GROUP: 'group',
  BROADCAST: 'broadcast',
  UNSUPPORTED: 'unsupported_type',
  NO_REPLY: 'no_reply',
};

const ACTION = { IGNORE: 'ignore', REJECT: 'reject', REPLY: 'reply' };

// Pulls the text out of a Baileys message. Ephemeral ("disappearing") and
// view-once messages wrap the real message, so unwrap before giving up.
function extractText(message) {
  if (!message) return '';

  if (typeof message.conversation === 'string') return message.conversation;
  if (message.extendedTextMessage && typeof message.extendedTextMessage.text === 'string') {
    return message.extendedTextMessage.text;
  }

  const wrapped =
    (message.ephemeralMessage && message.ephemeralMessage.message) ||
    (message.viewOnceMessage && message.viewOnceMessage.message) ||
    (message.viewOnceMessageV2 && message.viewOnceMessageV2.message);

  return wrapped ? extractText(wrapped) : '';
}

// Reduces one Baileys message to { from, text } or explains why it is ignored.
function normalizeMessage(waMessage) {
  const key = waMessage && waMessage.key;
  if (!key || !key.remoteJid) return { ok: false, ignored: IGNORED.NO_SENDER };

  // Our own replies come back through this same event; answering them would
  // loop forever.
  if (key.fromMe) return { ok: false, ignored: IGNORED.FROM_ME };

  const jid = String(key.remoteJid);

  if (jid.endsWith('@g.us')) return { ok: false, ignored: IGNORED.GROUP };
  if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) {
    return { ok: false, ignored: IGNORED.BROADCAST };
  }
  if (jid.endsWith('@newsletter')) return { ok: false, ignored: IGNORED.BROADCAST };

  const text = extractText(waMessage.message).trim();
  if (!text) return { ok: false, ignored: IGNORED.UNSUPPORTED };

  return { ok: true, from: jid, chat: jid, text };
}

// Turns one messages.upsert event into a list of decisions. Pure: it resolves
// identity and runs the router, but sends nothing.
//
// `loadFamily` is called per event rather than once at start-up, so edits to
// the family registry take effect without restarting the listener.
function handleUpsert(upsert, { loadFamily, capabilities } = {}) {
  const { messages, type } = upsert || {};

  // "append" is history being synced on (re)connect. Acting on it would replay
  // old commands every time the listener reconnects.
  if (type !== 'notify') {
    return [{ action: ACTION.IGNORE, reason: IGNORED.NOT_NEW, count: (messages || []).length }];
  }

  const family = loadFamily();
  const actions = [];

  for (const waMessage of messages || []) {
    const normalized = normalizeMessage(waMessage);
    if (!normalized.ok) {
      actions.push({ action: ACTION.IGNORE, reason: normalized.ignored });
      continue;
    }

    const outcome = routeMessage(
      { from: normalized.from, text: normalized.text },
      family,
      capabilities
    );

    if (outcome.result === RESULT.UNKNOWN_SENDER) {
      actions.push({ action: ACTION.REJECT, phone: outcome.phone });
      continue;
    }

    // Requirement: reply only when the runtime produced one. Ordinary chatter
    // from a family member is left alone.
    if (!outcome.reply) {
      actions.push({
        action: ACTION.IGNORE,
        reason: IGNORED.NO_REPLY,
        member: outcome.member.id,
      });
      continue;
    }

    actions.push({
      action: ACTION.REPLY,
      to: normalized.chat,
      text: outcome.reply,
      member: outcome.member.id,
      capability: outcome.capability,
    });
  }

  return actions;
}

function describeAction(action) {
  switch (action.action) {
    case ACTION.REPLY:
      return `replied to ${action.member} with /${action.capability}`;
    case ACTION.REJECT:
      return `rejected ${action.phone || 'unknown sender'} (not a family member)`;
    default:
      return `ignored (${action.reason}${action.member ? `, from ${action.member}` : ''})`;
  }
}

// Subscribes to a socket's messages.upsert and sends the replies the router
// asks for. `sock` only needs ev.on() and sendMessage(), which keeps this
// testable with a stand-in socket.
function attachInbound(sock, { loadFamily, capabilities, log = console.log } = {}) {
  const handler = async (upsert) => {
    let actions;
    try {
      actions = handleUpsert(upsert, { loadFamily, capabilities });
    } catch (err) {
      // A broken registry must not kill the listener.
      log(`[inbound] could not handle a message: ${err.message}`);
      return;
    }

    for (const action of actions) {
      if (action.action !== ACTION.REPLY) {
        log(`[inbound] ${describeAction(action)}`);
        continue;
      }

      try {
        await sock.sendMessage(action.to, { text: action.text });
        log(`[inbound] ${describeAction(action)}`);
      } catch (err) {
        log(`[inbound] failed to reply to ${action.member}: ${err.message}`);
      }
    }
  };

  sock.ev.on('messages.upsert', handler);
  return handler;
}

module.exports = { ACTION, IGNORED, extractText, normalizeMessage, handleUpsert, attachInbound };
