const { loadRegistry, findById, activeMembers } = require('../familyRegistry');

// Sends messages to family members by id. Capabilities use this instead of a
// transport, so nothing above this layer knows how a message travels or what a
// member's phone number is.
//
// This file must not import a transport. Delivery goes through the channel
// router, which is the only layer allowed to depend on one.
const { defaultChannelRouter } = require('./channelRouter');

const REASON = {
  UNKNOWN_MEMBER: 'unknown_member',
  INACTIVE_MEMBER: 'inactive_member',
  NO_CHANNEL: 'no_channel',
  SEND_FAILED: 'send_failed',
  EMPTY_MESSAGE: 'empty_message',
};

function failure(memberId, reason, detail) {
  return { ok: false, skipped: false, memberId, channel: null, reason, detail };
}

function skip(memberId, reason, detail) {
  return { ok: true, skipped: true, memberId, channel: null, reason, detail };
}

function delivered(memberId, channel) {
  return { ok: true, skipped: false, memberId, channel, reason: null, detail: null };
}

function resolveOptions({ family, router, strict = false } = {}) {
  return {
    family: family || loadRegistry(),
    router: router || defaultChannelRouter(),
    strict,
  };
}

// Sends to one member. Never throws for an ordinary outcome — the result says
// what happened, so callers (and notifyMany) can carry on.
//
// An unknown id is always a failure. An inactive member is skipped quietly
// unless strict mode is asked for, because deactivating someone should not turn
// every routine notification into an error.
async function notifyMember(memberId, message, options = {}) {
  const { family, router, strict } = resolveOptions(options);

  if (typeof message !== 'string' || message.trim() === '') {
    return failure(memberId, REASON.EMPTY_MESSAGE, 'The message is empty.');
  }

  const member = findById(family, memberId);
  if (!member) {
    return failure(memberId, REASON.UNKNOWN_MEMBER, `No family member has the id "${memberId}".`);
  }

  if (!member.active) {
    const detail = `${member.name} (${memberId}) is not active.`;
    return strict
      ? failure(memberId, REASON.INACTIVE_MEMBER, detail)
      : skip(memberId, REASON.INACTIVE_MEMBER, detail);
  }

  const channel = router.resolve(member);
  if (!channel) {
    return failure(memberId, REASON.NO_CHANNEL, `No delivery channel is available for ${memberId}.`);
  }

  try {
    await channel.send(member, message);
    return delivered(memberId, channel.name);
  } catch (err) {
    return {
      ...failure(memberId, REASON.SEND_FAILED, err.message),
      channel: channel.name,
    };
  }
}

function summarize(results) {
  const sent = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  return { ok: failed === 0, sent, skipped, failed, results };
}

// Sends to several members, one at a time. Sequential on purpose: it keeps the
// results in the order asked for and avoids hammering the transport, which is
// talking to a personal account.
//
// One recipient failing never stops the rest — every recipient gets a result.
async function notifyMany(memberIds, message, options = {}) {
  const resolved = resolveOptions(options);
  const results = [];

  for (const memberId of memberIds || []) {
    results.push(await notifyMember(memberId, message, resolved));
  }

  return summarize(results);
}

// Sends to every active member. Inactive members are not addressed at all, so
// they are absent from the results rather than reported as skipped.
async function notifyAll(message, options = {}) {
  const resolved = resolveOptions(options);
  const ids = activeMembers(resolved.family).map((member) => member.id);
  return notifyMany(ids, message, resolved);
}

module.exports = { REASON, notify: notifyMember, notifyMany, notifyAll };
