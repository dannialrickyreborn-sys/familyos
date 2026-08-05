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
} = require('../src/whatsappInbound');

const family = parseRegistry(
  JSON.stringify({
    members: [
      { id: 'parent-1', name: 'First Parent', phone: '+6281234567890', role: 'admin', active: true },
      { id: 'child-1', name: 'First Child', phone: '+6281234567892', role: 'member', active: false },
    ],
  })
);

const loadFamily = () => family;
const MEMBER_JID = '6281234567890@s.whatsapp.net';

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
  assert.deepStrictEqual(out, { ok: true, from: MEMBER_JID, chat: MEMBER_JID, text: '/ping' });
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

test('ignores messages sent by this device', () => {
  const out = normalizeMessage(textMessage('/ping', { fromMe: true }));
  assert.deepStrictEqual(out, { ok: false, ignored: IGNORED.FROM_ME });
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
  const actions = handleUpsert(upsert([textMessage('/ping')], 'append'), { loadFamily });
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].action, ACTION.IGNORE);
  assert.strictEqual(actions[0].reason, IGNORED.NOT_NEW);
});

// ------------------------------------------------- routing through the stack

test('a command from a registered member produces a reply to their chat', () => {
  const [action] = handleUpsert(upsert([textMessage('/ping')]), { loadFamily });

  assert.strictEqual(action.action, ACTION.REPLY);
  assert.strictEqual(action.to, MEMBER_JID);
  assert.strictEqual(action.member, 'parent-1');
  assert.strictEqual(action.capability, 'ping');
  assert.match(action.text, /^pong/);
  assert.ok(action.text.includes('First Parent'));
});

test('an alias reaches the same capability', () => {
  const [action] = handleUpsert(upsert([textMessage('/members')]), { loadFamily });
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
  const [action] = handleUpsert(upsert([textMessage('good morning')]), { loadFamily });
  assert.strictEqual(action.action, ACTION.IGNORE);
  assert.strictEqual(action.reason, IGNORED.NO_REPLY);
  assert.strictEqual(action.member, 'parent-1');
});

test('an unknown command still replies, nudging toward /help', () => {
  const [action] = handleUpsert(upsert([textMessage('/nope')]), { loadFamily });
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
function fakeSocket() {
  const sent = [];
  return {
    ev: new EventEmitter(),
    sendMessage: async (to, content) => {
      sent.push({ to, text: content.text });
    },
    sent,
  };
}

async function deliver(sock, payload) {
  await Promise.all(sock.ev.listeners('messages.upsert').map((listener) => listener(payload)));
}

test('attachInbound answers a registered member over the socket', async () => {
  const sock = fakeSocket();
  attachInbound(sock, { loadFamily, log: () => {} });

  await deliver(sock, upsert([textMessage('/ping')]));

  assert.strictEqual(sock.sent.length, 1);
  assert.strictEqual(sock.sent[0].to, MEMBER_JID);
  assert.match(sock.sent[0].text, /^pong/);
});

test('attachInbound sends nothing for ignored or rejected messages', async () => {
  const sock = fakeSocket();
  attachInbound(sock, { loadFamily, log: () => {} });

  await deliver(
    sock,
    upsert([
      textMessage('/ping', { fromMe: true }),
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
  attachInbound(sock, { loadFamily, log: () => {} });

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
  attachInbound(sock, { loadFamily, log: (line) => logs.push(line) });

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
    log: (line) => logs.push(line),
  });

  await deliver(sock, upsert([textMessage('/ping')]));

  assert.deepStrictEqual(sock.sent, []);
  assert.ok(logs.some((line) => line.includes('registry missing')));
});

test('the listener never answers its own replies', async () => {
  const sock = fakeSocket();
  attachInbound(sock, { loadFamily, log: () => {} });

  // A reply FamilyOS sent comes back through the same event with fromMe: true.
  await deliver(sock, upsert([textMessage('/ping')]));
  const replied = sock.sent[0].text;
  await deliver(sock, upsert([textMessage(replied, { fromMe: true })]));

  assert.strictEqual(sock.sent.length, 1, 'the listener answered its own message');
});
