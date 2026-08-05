const { routeMessage, RESULT } = require('./messageRouter');
const { phoneFromJid } = require('./whatsappSession');
const { createOutbox, createLoopGuard } = require('./whatsappOutbox');

// Why an inbound message was not acted on.
const IGNORED = {
  NOT_NEW: 'not_new',
  NO_SENDER: 'no_sender',
  OWN_MESSAGE: 'own_message',
  OUTGOING_CHAT: 'outgoing_chat',
  LOOP_GUARD: 'loop_guard',
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

// Two JIDs belong to the same account when their phone numbers match; the
// device suffix ("...:12@s.whatsapp.net") differs per linked device.
function sameAccount(a, b) {
  const left = phoneFromJid(a);
  const right = phoneFromJid(b);
  return Boolean(left) && left === right;
}

// Reduces one Baileys message to { from, text } or explains why it is ignored.
//
// FamilyOS runs as a linked device on the owner's personal account, so the
// owner's own commands arrive with key.fromMe set — exactly like FamilyOS's own
// replies. `fromMe` therefore cannot decide anything on its own; see
// docs/architecture/ADR-002-one-number-executive-interface.md.
function normalizeMessage(waMessage, { ownJid = null, outbox = null } = {}) {
  const key = waMessage && waMessage.key;
  if (!key || !key.remoteJid) return { ok: false, ignored: IGNORED.NO_SENDER };

  const jid = String(key.remoteJid);

  if (jid.endsWith('@g.us')) return { ok: false, ignored: IGNORED.GROUP };
  if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) {
    return { ok: false, ignored: IGNORED.BROADCAST };
  }
  if (jid.endsWith('@newsletter')) return { ok: false, ignored: IGNORED.BROADCAST };

  let from = jid;
  let self = false;

  if (key.fromMe) {
    // Guard 1 — this is a message FamilyOS sent. Authoritative: the id was
    // recorded when we sent it, not inferred from the text.
    if (outbox && outbox.has(key.id)) {
      return { ok: false, ignored: IGNORED.OWN_MESSAGE };
    }

    // Guard 2 — a self-sent message in someone else's chat is either the
    // owner talking to a person, or a FamilyOS reminder addressed to them.
    // Neither is a command, and FamilyOS must not answer inside a human
    // conversation. The owner's own chat is the command surface.
    if (!ownJid || !sameAccount(jid, ownJid)) {
      return { ok: false, ignored: IGNORED.OUTGOING_CHAT };
    }

    // A self-sent message in the owner's own chat is the owner issuing a
    // command. The sender is the account itself — for a fromMe message
    // remoteJid names the recipient, so it cannot identify the author.
    from = ownJid;
    self = true;
  }

  const text = extractText(waMessage.message).trim();
  if (!text) return { ok: false, ignored: IGNORED.UNSUPPORTED };

  return { ok: true, from, chat: jid, text, self };
}

// Turns one messages.upsert event into a list of decisions. Pure: it resolves
// identity and runs the router, but sends nothing.
//
// `loadFamily` is called per event rather than once at start-up, so edits to
// the family registry take effect without restarting the listener.
function handleUpsert(upsert, { loadFamily, capabilities, ownJid, outbox, loopGuard } = {}) {
  const { messages, type } = upsert || {};

  // "append" is history being synced on (re)connect. Acting on it would replay
  // old commands every time the listener reconnects.
  if (type !== 'notify') {
    return [{ action: ACTION.IGNORE, reason: IGNORED.NOT_NEW, count: (messages || []).length }];
  }

  const family = loadFamily();
  const actions = [];

  for (const waMessage of messages || []) {
    const normalized = normalizeMessage(waMessage, { ownJid, outbox });
    if (!normalized.ok) {
      actions.push({ action: ACTION.IGNORE, reason: normalized.ignored });
      continue;
    }

    // Guard 3 — a hard cap on self-originated commands per chat, so a runaway
    // is bounded even if the two guards above were both wrong.
    if (normalized.self && loopGuard && !loopGuard.allow(normalized.chat)) {
      actions.push({ action: ACTION.IGNORE, reason: IGNORED.LOOP_GUARD, chat: normalized.chat });
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

    // Reply only when the runtime produced one. Ordinary chatter from a family
    // member — including the owner's own notes to self — is left alone.
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
      self: normalized.self,
    });
  }

  return actions;
}

function describeAction(action) {
  switch (action.action) {
    case ACTION.REPLY:
      return `replied to ${action.member} with /${action.capability}${action.self ? ' (own account)' : ''}`;
    case ACTION.REJECT:
      return `rejected ${action.phone || 'unknown sender'} (not a family member)`;
    default:
      return `ignored (${action.reason}${action.member ? `, from ${action.member}` : ''})`;
  }
}

// Subscribes to a socket's messages.upsert and sends the replies the router
// asks for. `sock` only needs ev.on() and sendMessage(), which keeps this
// testable with a stand-in socket.
//
// `ownJid` identifies the account FamilyOS is linked to; without it, self-sent
// messages are all treated as outgoing chat traffic and ignored, which is the
// safe direction to fail.
function attachInbound(
  sock,
  { loadFamily, capabilities, log = console.log, ownJid, outbox, loopGuard } = {}
) {
  const sentIds = outbox || createOutbox();
  const guard = loopGuard || createLoopGuard();
  const account = ownJid || (sock.user && sock.user.id) || null;

  const handler = async (upsert) => {
    let actions;
    try {
      actions = handleUpsert(upsert, {
        loadFamily,
        capabilities,
        ownJid: account,
        outbox: sentIds,
        loopGuard: guard,
      });
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
        const receipt = await sock.sendMessage(action.to, { text: action.text });
        // Record before anything else can react to it, so the copy that comes
        // back is recognised as ours.
        sentIds.record(receipt && receipt.key && receipt.key.id);
        log(`[inbound] ${describeAction(action)}`);
      } catch (err) {
        log(`[inbound] failed to reply to ${action.member}: ${err.message}`);
      }
    }
  };

  sock.ev.on('messages.upsert', handler);
  return handler;
}

module.exports = {
  ACTION,
  IGNORED,
  extractText,
  sameAccount,
  normalizeMessage,
  handleUpsert,
  attachInbound,
};
