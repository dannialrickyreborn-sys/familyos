const test = require('node:test');
const assert = require('node:assert');
const { parseRegistry } = require('../src/familyRegistry');
const { routeMessage, RESULT } = require('../src/messageRouter');

const registry = parseRegistry(
  JSON.stringify({
    members: [
      { id: 'parent-1', name: 'First Parent', phone: '+6281234567890', role: 'admin', active: true },
      { id: 'child-1', name: 'First Child', phone: '+6281234567892', role: 'member', active: false },
    ],
  })
);

const KNOWN_JID = '6281234567890@s.whatsapp.net';

test('resolves a known sender from a WhatsApp JID', () => {
  const out = routeMessage({ from: KNOWN_JID, text: '/ping' }, registry);
  assert.strictEqual(out.result, RESULT.HANDLED);
  assert.strictEqual(out.member.id, 'parent-1');
});

test('resolves a known sender from a device-suffixed JID', () => {
  const out = routeMessage({ from: '6281234567890:12@s.whatsapp.net', text: '/ping' }, registry);
  assert.strictEqual(out.result, RESULT.HANDLED);
  assert.strictEqual(out.member.id, 'parent-1');
});

test('resolves a known sender from a plain phone number', () => {
  const out = routeMessage({ from: '+62 812-3456-7890', text: '/ping' }, registry);
  assert.strictEqual(out.result, RESULT.HANDLED);
});

test('rejects an unknown sender and produces no reply', () => {
  const out = routeMessage({ from: '6289999999999@s.whatsapp.net', text: '/ping' }, registry);
  assert.strictEqual(out.result, RESULT.UNKNOWN_SENDER);
  assert.strictEqual(out.member, null);
  assert.strictEqual(out.reply, null, 'unknown senders must never get a reply');
});

test('rejects a deactivated member', () => {
  const out = routeMessage({ from: '6281234567892@s.whatsapp.net', text: '/ping' }, registry);
  assert.strictEqual(out.result, RESULT.UNKNOWN_SENDER);
  assert.strictEqual(out.reply, null);
});

test('rejects a missing or malformed sender', () => {
  for (const from of [undefined, '', 'garbage', '@s.whatsapp.net']) {
    const out = routeMessage({ from, text: '/ping' }, registry);
    assert.strictEqual(out.result, RESULT.UNKNOWN_SENDER, `accepted sender: ${String(from)}`);
  }
});

test('an unknown sender is refused before the command is considered', () => {
  // Even a valid command from a stranger must not run.
  const out = routeMessage({ from: '6289999999999@s.whatsapp.net', text: '/family' }, registry);
  assert.strictEqual(out.result, RESULT.UNKNOWN_SENDER);
  assert.strictEqual(out.command, undefined, 'no command should be dispatched');
});

test('ordinary text from a known member is ignored, not answered', () => {
  for (const text of ['hello', 'ping', '', '   ', 'tell me /help']) {
    const out = routeMessage({ from: KNOWN_JID, text }, registry);
    assert.strictEqual(out.result, RESULT.NOT_A_COMMAND, `treated as command: "${text}"`);
    assert.strictEqual(out.reply, null);
  }
});

test('/help lists every supported command', () => {
  const { reply } = routeMessage({ from: KNOWN_JID, text: '/help' }, registry);
  for (const command of ['/help', '/status', '/family', '/ping']) {
    assert.ok(reply.includes(command), `/help omits ${command}`);
  }
});

test('/ping answers the member by name', () => {
  const { reply } = routeMessage({ from: KNOWN_JID, text: '/ping' }, registry);
  assert.match(reply, /^pong/);
  assert.ok(reply.includes('First Parent'));
});

test('/family lists active members only and never leaks phone numbers', () => {
  const { reply } = routeMessage({ from: KNOWN_JID, text: '/family' }, registry);
  assert.ok(reply.includes('First Parent'), 'active member missing');
  assert.ok(!reply.includes('First Child'), 'inactive member listed');
  assert.ok(!reply.includes('6281234567890'), 'phone number leaked into a chat reply');
  assert.ok(reply.includes('1 active'));
});

test('/status reports the WhatsApp link state without opening a connection', () => {
  const { reply } = routeMessage({ from: KNOWN_JID, text: '/status' }, registry);
  assert.ok(reply.includes('WhatsApp:'));
  assert.ok(reply.includes('Transport:'));
});

test('commands are case-insensitive and tolerate extra whitespace and arguments', () => {
  for (const text of ['/PING', '  /Ping  ', '/ping now please']) {
    const out = routeMessage({ from: KNOWN_JID, text }, registry);
    assert.strictEqual(out.result, RESULT.HANDLED, `failed for "${text}"`);
    assert.match(out.reply, /^pong/);
  }
});

test('an unknown command gets a nudge rather than silence', () => {
  const out = routeMessage({ from: KNOWN_JID, text: '/nope' }, registry);
  assert.strictEqual(out.result, RESULT.HANDLED);
  assert.match(out.reply, /Unknown command "\/nope"/);
  assert.ok(out.reply.includes('/help'));
});
