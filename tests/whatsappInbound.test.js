const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { parseRegistry } = require('../src/familyRegistry');
const {
  ACTION,
  IGNORED,
  normalizeMessage,
  handleUpsert,
  attachInbound,
  sameAccount,
} = require('../src/whatsappInbound');
const { createOutbox, createLoopGuard } = require('../src/whatsappOutbox');

const family = parseRegistry(
  JSON.stringify({
    members: [
      { id: 'parent-1', name: 'First Parent', phone: '+6281234567890', role: 'owner', active: true },
      { id: 'child-1', name: 'First Child', phone: '+6281234567892', role: 'child', active: false },
    ],
  })
);

const loadFamily = () => family;
// The owner's number is the account FamilyOS is linked to, so it is both the
// member JID and the account's own JID.
const MEMBER_JID = '6281234567890@s.whatsapp.net';
const OWN_JID = '6281234567890:12@s.whatsapp.net';
const OTHER_JID = '6281234567892@s.whatsapp.net';

// Nothing persists to disk in tests.
const memoryOutbox = () => createOutbox({ persist: false });
function ctx(extra = {}) {
  return { loadFamily, ownJid: OWN_JID, outbox: memoryOutbox(), ...extra };
}

// Shapes a Baileys messages.upsert payload.
function upsert(messages, type = 'notify') {
  return { messages, type };
}

function textMessage(text, { jid = MEMBER_JID, fromMe = false } = {}) {
  return { key: { remoteJid: jid, fromMe, id: 'ABC' }, message: { conversation: text } };
}

// ------------------------------------------------------------ normalization

test('extracts a plain conversation message', () => {
  const out = normalizeMessage(textMessage('/ping'));
  assert.deepStrictEqual(out, {
    ok: true,
    from: MEMBER_JID,
    chat: MEMBER_JID,
    text: '/ping',
    self: false,
  });
});

test('extracts extended text (a reply or a message with a link preview)', () => {
  const out = normalizeMessage({
    key: { remoteJid: MEMBER_JID, fromMe: false },
    message: { extendedTextMessage: { text: '/status' } },
  });
  assert.strictEqual(out.text, '/status');
});

test('unwraps ephemeral and view-once wrappers', () => {
  const wrappers = [
    { ephemeralMessage: { message: { conversation: '/ping' } } },
    { viewOnceMessage: { message: { conversation: '/ping' } } },
    { viewOnceMessageV2: { message: { extendedTextMessage: { text: '/ping' } } } },
  ];

  for (const message of wrappers) {
    const out = normalizeMessage({ key: { remoteJid: MEMBER_JID, fromMe: false }, message });
    assert.strictEqual(out.ok, true, `failed to unwrap ${Object.keys(message)[0]}`);
    assert.strictEqual(out.text, '/ping');
  }
});

test('trims surrounding whitespace', () => {
  assert.strictEqual(normalizeMessage(textMessage('  /ping  ')).text, '/ping');
});

// ---------------------------------------------------------------- filtering

test('a self-sent message FamilyOS recorded as its own is ignored', () => {
  const outbox = memoryOutbox();
  outbox.record('SENT-1');
  const message = { key: { remoteJid: OWN_JID, fromMe: true, id: 'SENT-1' }, message: { conversation: 'pong' } };

  const out = normalizeMessage(message, { ownJid: OWN_JID, outbox });
  assert.deepStrictEqual(out, { ok: false, ignored: IGNORED.OWN_MESSAGE });
});

test('a self-sent message in someone else\'s chat is ignored', () => {
  // Either the owner talking to a person, or a FamilyOS reminder addressed to
  // them. Neither is a command, and FamilyOS must not answer inside a human
  // conversation.
  const message = { key: { remoteJid: OTHER_JID, fromMe: true, id: 'X' }, message: { conversation: '/ping' } };

  const out = normalizeMessage(message, { ownJid: OWN_JID, outbox: memoryOutbox() });
  assert.deepStrictEqual(out, { ok: false, ignored: IGNORED.OUTGOING_CHAT });
});

test('a self-sent command in the owner\'s own chat is accepted', () => {
  const message = { key: { remoteJid: OWN_JID, fromMe: true, id: 'TYPED' }, message: { conversation: '/ping' } };

  const out = normalizeMessage(message, { ownJid: OWN_JID, outbox: memoryOutbox() });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.self, true);
  assert.strictEqual(out.from, OWN_JID, 'the author is the account, not remoteJid');
});

test('without a known account JID, self-sent messages are ignored', () => {
  // Failing closed: better to miss an owner command than to answer our own.
  const message = { key: { remoteJid: OWN_JID, fromMe: true, id: 'X' }, message: { conversation: '/ping' } };

  const out = normalizeMessage(message, { ownJid: null, outbox: memoryOutbox() });
  assert.deepStrictEqual(out, { ok: false, ignored: IGNORED.OUTGOING_CHAT });
});

test('ignores group chats', () => {
  const out = normalizeMessage(textMessage('/ping', { jid: '6281234567890-1234@g.us' }));
  assert.deepStrictEqual(out, { ok: false, ignored: IGNORED.GROUP });
});

test('ignores status broadcasts and channels', () => {
  for (const jid of ['status@broadcast', '1234@broadcast', '1234@newsletter']) {
    const out = normalizeMessage(textMessage('/ping', { jid }));
    assert.deepStrictEqual(out, { ok: false, ignored: IGNORED.BROADCAST }, `not ignored: ${jid}`);
  }
});

test('ignores unsupported message types', () => {
  const unsupported = [
    { imageMessage: { caption: 'look' } },
    { audioMessage: {} },
    { stickerMessage: {} },
    { reactionMessage: { text: '👍' } },
    { protocolMessage: {} },
    {},
    null,
  ];

  for (const message of unsupported) {
    const out = normalizeMessage({ key: { remoteJid: MEMBER_JID, fromMe: false }, message });
    assert.deepStrictEqual(out, { ok: false, ignored: IGNORED.UNSUPPORTED }, `not ignored: ${JSON.stringify(message)}`);
  }
});

test('ignores a message with no sender', () => {
  for (const waMessage of [{}, { key: {} }, null]) {
    assert.strictEqual(normalizeMessage(waMessage).ignored, IGNORED.NO_SENDER);
  }
});

test('ignores history sync ("append"), so reconnecting does not replay commands', () => {
  const actions = handleUpsert(upsert([textMessage('/ping')], 'append'), ctx());
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].action, ACTION.IGNORE);
  assert.strictEqual(actions[0].reason, IGNORED.NOT_NEW);
});

// ------------------------------------------------- routing through the stack

test('a command from a registered member produces a reply to their chat', () => {
  const [action] = handleUpsert(upsert([textMessage('/ping')]), ctx());

  assert.strictEqual(action.action, ACTION.REPLY);
  assert.strictEqual(action.to, MEMBER_JID);
  assert.strictEqual(action.member, 'parent-1');
  assert.strictEqual(action.capability, 'ping');
  assert.match(action.text, /^pong/);
  assert.ok(action.text.includes('First Parent'));
});

test('an alias reaches the same capability', () => {
  const [action] = handleUpsert(upsert([textMessage('/members')]), ctx());
  assert.strictEqual(action.action, ACTION.REPLY);
  assert.strictEqual(action.capability, 'family');
});

test('an unknown sender is rejected and never answered', () => {
  const [action] = handleUpsert(
    upsert([textMessage('/ping', { jid: '6289999999999@s.whatsapp.net' })]),
    { loadFamily }
  );
  assert.strictEqual(action.action, ACTION.REJECT);
  assert.strictEqual(action.text, undefined);
});

test('a deactivated member is rejected', () => {
  const [action] = handleUpsert(
    upsert([textMessage('/ping', { jid: '6281234567892@s.whatsapp.net' })]),
    { loadFamily }
  );
  assert.strictEqual(action.action, ACTION.REJECT);
});

test('ordinary chatter from a member gets no reply', () => {
  const [action] = handleUpsert(upsert([textMessage('good morning')]), ctx());
  assert.strictEqual(action.action, ACTION.IGNORE);
  assert.strictEqual(action.reason, IGNORED.NO_REPLY);
  assert.strictEqual(action.member, 'parent-1');
});

test('an unknown command still replies, nudging toward /help', () => {
  const [action] = handleUpsert(upsert([textMessage('/nope')]), ctx());
  assert.strictEqual(action.action, ACTION.REPLY);
  assert.match(action.text, /Unknown command/);
});

test('a batch is handled message by message', () => {
  const actions = handleUpsert(
    upsert([
      textMessage('/ping'),
      textMessage('/ping', { fromMe: true }),
      textMessage('hello'),
      textMessage('/ping', { jid: '6289999999999@s.whatsapp.net' }),
      textMessage('/help'),
    ]),
    { loadFamily }
  );

  assert.deepStrictEqual(
    actions.map((a) => a.action),
    [ACTION.REPLY, ACTION.IGNORE, ACTION.IGNORE, ACTION.REJECT, ACTION.REPLY]
  );
});

// --------------------------------------- end to end against a stand-in socket

// Minimal stand-in for a Baileys socket: the listener only needs ev.on and
// sendMessage, so the whole inbound path can be exercised without a network.
let sentCounter = 0;
function fakeSocket() {
  const sent = [];
  const sentKeys = [];
  return {
    ev: new EventEmitter(),
    // Baileys returns the sent message, whose key.id is what the outbox records.
    sendMessage: async (to, content) => {
      sent.push({ to, text: content.text });
      const id = `OUT-${++sentCounter}`;
      sentKeys.push(id);
      return { key: { remoteJid: to, fromMe: true, id } };
    },
    sent,
    sentKeys,
  };
}

async function deliver(sock, payload) {
  await Promise.all(sock.ev.listeners('messages.upsert').map((listener) => listener(payload)));
}

test('attachInbound answers a registered member over the socket', async () => {
  const sock = fakeSocket();
  attachInbound(sock, ctx({ log: () => {} }));

  await deliver(sock, upsert([textMessage('/ping')]));

  assert.strictEqual(sock.sent.length, 1);
  assert.strictEqual(sock.sent[0].to, MEMBER_JID);
  assert.match(sock.sent[0].text, /^pong/);
});

test('attachInbound sends nothing for ignored or rejected messages', async () => {
  const sock = fakeSocket();
  attachInbound(sock, ctx({ log: () => {} }));

  await deliver(
    sock,
    upsert([
      // self-sent in someone else's chat: the owner talking to a person, or a
      // FamilyOS reminder addressed to them
      { key: { remoteJid: OTHER_JID, fromMe: true, id: 'A' }, message: { conversation: '/ping' } },
      textMessage('/ping', { jid: '628999-1@g.us' }),
      textMessage('/ping', { jid: 'status@broadcast' }),
      textMessage('hello there'),
      textMessage('/ping', { jid: '6289999999999@s.whatsapp.net' }),
      { key: { remoteJid: MEMBER_JID, fromMe: false }, message: { imageMessage: {} } },
    ])
  );

  assert.deepStrictEqual(sock.sent, [], 'the listener replied when it should have stayed silent');
});

test('attachInbound replies to each command in a batch, in order', async () => {
  const sock = fakeSocket();
  attachInbound(sock, ctx({ log: () => {} }));

  await deliver(sock, upsert([textMessage('/ping'), textMessage('/help')]));

  assert.strictEqual(sock.sent.length, 2);
  assert.match(sock.sent[0].text, /^pong/);
  assert.ok(sock.sent[1].text.includes('FamilyOS commands'));
});

test('a send failure is logged and does not stop later replies', async () => {
  const sock = fakeSocket();
  const logs = [];
  let calls = 0;
  sock.sendMessage = async (to, content) => {
    calls += 1;
    if (calls === 1) throw new Error('network gone');
    sock.sent.push({ to, text: content.text });
  };
  attachInbound(sock, ctx({ log: (line) => logs.push(line) }));

  await deliver(sock, upsert([textMessage('/ping'), textMessage('/help')]));

  assert.ok(logs.some((line) => line.includes('failed to reply')), 'the failure was not reported');
  assert.strictEqual(sock.sent.length, 1, 'the second reply should still have been sent');
});

test('a broken registry is reported and does not kill the listener', async () => {
  const sock = fakeSocket();
  const logs = [];
  attachInbound(sock, {
    loadFamily: () => {
      throw new Error('registry missing');
    },
    ownJid: OWN_JID,
    outbox: memoryOutbox(),
    log: (line) => logs.push(line),
  });

  await deliver(sock, upsert([textMessage('/ping')]));

  assert.deepStrictEqual(sock.sent, []);
  assert.ok(logs.some((line) => line.includes('registry missing')));
});

test('the listener never answers its own replies', async () => {
  const sock = fakeSocket();
  attachInbound(sock, ctx({ log: () => {} }));

  // A reply FamilyOS sent comes back through the same event with fromMe: true.
  await deliver(sock, upsert([textMessage('/ping')]));
  const replied = sock.sent[0].text;
  await deliver(sock, upsert([textMessage(replied, { fromMe: true })]));

  assert.strictEqual(sock.sent.length, 1, 'the listener answered its own message');
});

// ------------------------------- one-number executive interface (ADR-002)

// The product requirement: one WhatsApp number for chatting, commanding
// FamilyOS, and receiving what it sends back. See
// docs/architecture/ADR-002-one-number-executive-interface.md.

test('DoD: an owner command typed on the linked account executes', async () => {
  const sock = fakeSocket();
  attachInbound(sock, ctx({ log: () => {} }));

  await deliver(
    sock,
    upsert([{ key: { remoteJid: OWN_JID, fromMe: true, id: 'TYPED-1' }, message: { conversation: '/ping' } }])
  );

  assert.strictEqual(sock.sent.length, 1, 'the owner command was not executed');
  assert.match(sock.sent[0].text, /^pong/);
  assert.strictEqual(sock.sent[0].to, OWN_JID, 'the reply goes back to the chat it came from');
});

test("DoD: FamilyOS's own reply is not reprocessed", async () => {
  const outbox = memoryOutbox();
  const sock = fakeSocket();
  attachInbound(sock, ctx({ outbox, log: () => {} }));

  // The owner asks; FamilyOS answers and records the id it sent.
  await deliver(
    sock,
    upsert([{ key: { remoteJid: OWN_JID, fromMe: true, id: 'TYPED-2' }, message: { conversation: '/ping' } }])
  );
  assert.strictEqual(sock.sent.length, 1);
  const replyId = sock.sentKeys[0];

  // That reply now arrives back on the linked device, exactly as WhatsApp
  // mirrors it: same chat, fromMe, and the id we recorded.
  await deliver(
    sock,
    upsert([
      { key: { remoteJid: OWN_JID, fromMe: true, id: replyId }, message: { conversation: sock.sent[0].text } },
    ])
  );

  assert.strictEqual(sock.sent.length, 1, "FamilyOS answered its own reply");
});

test('DoD: a reminder FamilyOS sent to another member is not reprocessed', async () => {
  const outbox = memoryOutbox();
  // The notification path records the id even though it used a different
  // socket, which is why the outbox is shared rather than per-connection.
  outbox.record('REMINDER-1');

  const sock = fakeSocket();
  attachInbound(sock, ctx({ outbox, log: () => {} }));

  await deliver(
    sock,
    upsert([
      {
        key: { remoteJid: OTHER_JID, fromMe: true, id: 'REMINDER-1' },
        message: { conversation: '/ping' },
      },
    ])
  );

  assert.deepStrictEqual(sock.sent, [], 'a FamilyOS reminder was treated as a command');
});

test('DoD: a reminder to the owner is not reprocessed even in the own chat', async () => {
  const outbox = memoryOutbox();
  outbox.record('SELF-REMINDER');

  const sock = fakeSocket();
  attachInbound(sock, ctx({ outbox, log: () => {} }));

  await deliver(
    sock,
    upsert([
      {
        key: { remoteJid: OWN_JID, fromMe: true, id: 'SELF-REMINDER' },
        message: { conversation: '/status' },
      },
    ])
  );

  assert.deepStrictEqual(sock.sent, [], 'a reminder to the owner was re-executed');
});

test('DoD: an infinite loop is impossible even if id tracking fails', async () => {
  // Worst case: the outbox never recognises anything (as if every id were
  // lost), and every reply happens to look like a command. The loop guard must
  // still bring it to a halt.
  const brokenOutbox = { has: () => false, record: () => false, size: () => 0 };
  const loopGuard = createLoopGuard({ max: 5, windowMs: 60000 });

  const sock = fakeSocket();
  attachInbound(sock, ctx({ outbox: brokenOutbox, loopGuard, log: () => {} }));

  // Feed 50 self-sent commands; the guard caps how many are acted on.
  for (let i = 0; i < 50; i += 1) {
    await deliver(
      sock,
      upsert([{ key: { remoteJid: OWN_JID, fromMe: true, id: `LOOP-${i}` }, message: { conversation: '/ping' } }])
    );
  }

  assert.strictEqual(sock.sent.length, 5, `the loop guard did not cap replies (sent ${sock.sent.length})`);
});

test('the loop guard is per chat, so one runaway does not mute the family', () => {
  const guard = createLoopGuard({ max: 2, windowMs: 60000 });

  assert.strictEqual(guard.allow('chat-a'), true);
  assert.strictEqual(guard.allow('chat-a'), true);
  assert.strictEqual(guard.allow('chat-a'), false, 'chat-a should be capped');
  assert.strictEqual(guard.allow('chat-b'), true, 'chat-b must be unaffected');
});

test('the loop guard forgets old activity once the window passes', () => {
  let clock = 1000;
  const guard = createLoopGuard({ max: 1, windowMs: 1000, now: () => clock });

  assert.strictEqual(guard.allow('chat'), true);
  assert.strictEqual(guard.allow('chat'), false);

  clock += 2000;
  assert.strictEqual(guard.allow('chat'), true, 'the budget should refill after the window');
});

test('the outbox is bounded, so it cannot grow without limit', () => {
  const outbox = createOutbox({ persist: false, limit: 3 });
  for (const id of ['a', 'b', 'c', 'd', 'e']) outbox.record(id);

  assert.strictEqual(outbox.size(), 3);
  assert.strictEqual(outbox.has('e'), true, 'the newest id must be kept');
  assert.strictEqual(outbox.has('a'), false, 'the oldest id should have been evicted');
});

test('the outbox tolerates a send that returned no id', () => {
  const outbox = createOutbox({ persist: false });
  for (const id of [undefined, null, '', 0, {}]) {
    assert.strictEqual(outbox.record(id), false, `accepted a bad id: ${JSON.stringify(id)}`);
  }
  assert.strictEqual(outbox.size(), 0);
  assert.strictEqual(outbox.has(undefined), false);
});

test('device suffixes do not stop the own-account check from matching', () => {
  // The phone's JID and the linked device's JID differ only by suffix.
  assert.strictEqual(sameAccount('6281234567890@s.whatsapp.net', '6281234567890:12@s.whatsapp.net'), true);
  assert.strictEqual(sameAccount('6281234567890:3@s.whatsapp.net', '6281234567890:99@s.whatsapp.net'), true);
  assert.strictEqual(sameAccount('6281234567890@s.whatsapp.net', OTHER_JID), false);
  assert.strictEqual(sameAccount(null, OWN_JID), false);
});

test('existing protections still apply to self-sent messages', () => {
  const guarded = [
    ['group', { remoteJid: '628-1@g.us', fromMe: true, id: 'G' }],
    ['broadcast', { remoteJid: 'status@broadcast', fromMe: true, id: 'B' }],
  ];

  for (const [label, key] of guarded) {
    const out = normalizeMessage({ key, message: { conversation: '/ping' } }, { ownJid: OWN_JID, outbox: memoryOutbox() });
    assert.strictEqual(out.ok, false, `${label} was not ignored`);
  }

  // History sync stays ignored regardless of who sent it.
  const actions = handleUpsert(
    upsert([{ key: { remoteJid: OWN_JID, fromMe: true, id: 'H' }, message: { conversation: '/ping' } }], 'append'),
    ctx()
  );
  assert.strictEqual(actions[0].reason, IGNORED.NOT_NEW);
});

test('unsupported types from the owner are still ignored', () => {
  const out = normalizeMessage(
    { key: { remoteJid: OWN_JID, fromMe: true, id: 'I' }, message: { imageMessage: {} } },
    { ownJid: OWN_JID, outbox: memoryOutbox() }
  );
  assert.strictEqual(out.ignored, IGNORED.UNSUPPORTED);
});
