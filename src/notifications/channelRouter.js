// Chooses how a notification reaches a member, and is the only layer allowed
// to depend on transports. The notification engine talks to this and never
// imports a transport itself.
//
// Only WhatsApp exists today. A second channel is added by writing a module
// with { name, send(member, message) } and registering it here; nothing in the
// engine or in any capability changes. Per-member channel selection would then
// need a `channel` field on the family registry — deliberately not added until
// there is a second channel to choose between.

function createChannelRouter({ channels = [], defaultChannel } = {}) {
  const byName = new Map();

  function register(channel) {
    if (!channel || typeof channel.name !== 'string' || channel.name.trim() === '') {
      throw new Error('A channel needs a non-empty name.');
    }
    if (typeof channel.send !== 'function') {
      throw new Error(`Channel "${channel.name}" has no send() function.`);
    }
    if (byName.has(channel.name)) {
      throw new Error(`Channel "${channel.name}" is already registered.`);
    }
    byName.set(channel.name, channel);
    return channel;
  }

  channels.forEach(register);

  const fallback = defaultChannel || (channels[0] && channels[0].name) || null;

  // Which channel should carry a message to this member. Today every member is
  // reached the same way; the member is still passed in so per-member routing
  // needs no signature change.
  function resolve(member) {
    const name = (member && member.channel) || fallback;
    return byName.get(name) || null;
  }

  return {
    register,
    resolve,
    names: () => [...byName.keys()],
  };
}

// Built lazily so that requiring this module — or the engine above it — does
// not pull in the WhatsApp transport (and Baileys) until something actually
// sends. Tests inject their own router and never touch the real one.
let shared = null;

function defaultChannelRouter() {
  if (!shared) {
    shared = createChannelRouter({
      channels: [require('./channels/whatsapp')],
      defaultChannel: 'whatsapp',
    });
  }
  return shared;
}

module.exports = { createChannelRouter, defaultChannelRouter };
