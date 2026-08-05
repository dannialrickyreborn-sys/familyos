const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseRegistry } = require('../src/familyRegistry');
const { createChannelRouter } = require('../src/notifications/channelRouter');
const { REASON, notify, notifyMany, notifyAll } = require('../src/notifications/engine');

const family = parseRegistry(
  JSON.stringify({
    members: [
      { id: 'parent-1', name: 'First Parent', phone: '+6281234567890', role: 'owner', active: true },
      { id: 'parent-2', name: 'Second Parent', phone: '+6281234567891', role: 'child', active: true },
      { id: 'child-1', name: 'First Child', phone: '+6281234567892', role: 'child', active: false },
    ],
  })
);

// A stand-in channel: records what it was asked to deliver, and can be told to
// fail for particular members.
function recordingChannel({ failFor = [], name = 'test-channel' } = {}) {
  const sent = [];
  const channel = {
    name,
    send: async (member, message) => {
      if (failFor.includes(member.id)) throw new Error(`transport down for ${member.id}`);
      sent.push({ memberId: member.id, message });
    },
  };
  return { channel, sent };
}

function routerWith(channel) {
  return createChannelRouter({ channels: [channel], defaultChannel: channel.name });
}

function setup(options = {}) {
  const { channel, sent } = recordingChannel(options);
  return { sent, options: { family, router: routerWith(channel) } };
}

// ------------------------------------------------------------ single recipient

test('notify delivers to one active member by id', async () => {
  const { sent, options } = setup();
  const result = await notify('parent-1', 'dinner is ready', options);

  assert.deepStrictEqual(result, {
    ok: true,
    skipped: false,
    memberId: 'parent-1',
    channel: 'test-channel',
    reason: null,
    detail: null,
  });
  assert.deepStrictEqual(sent, [{ memberId: 'parent-1', message: 'dinner is ready' }]);
});

test('notify rejects an empty message before touching the channel', async () => {
  const { sent, options } = setup();

  for (const message of ['', '   ', null, undefined, 42]) {
    const result = await notify('parent-1', message, options);
    assert.strictEqual(result.ok, false, `accepted message: ${JSON.stringify(message)}`);
    assert.strictEqual(result.reason, REASON.EMPTY_MESSAGE);
  }
  assert.deepStrictEqual(sent, []);
});

// -------------------------------------------------------------- unknown member

test('an unknown member id is a structured failure', async () => {
  const { sent, options } = setup();
  const result = await notify('nobody', 'hello', options);

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(result.reason, REASON.UNKNOWN_MEMBER);
  assert.strictEqual(result.memberId, 'nobody');
  assert.ok(result.detail.includes('nobody'), 'the failure should name the id');
  assert.deepStrictEqual(sent, [], 'nothing should be sent for an unknown member');
});

test('an unknown member fails in strict mode too', async () => {
  const { options } = setup();
  const result = await notify('nobody', 'hello', { ...options, strict: true });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, REASON.UNKNOWN_MEMBER);
});

// ------------------------------------------------------------- inactive member

test('an inactive member is skipped quietly by default', async () => {
  const { sent, options } = setup();
  const result = await notify('child-1', 'hello', options);

  assert.strictEqual(result.ok, true, 'a skip is not a failure');
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, REASON.INACTIVE_MEMBER);
  assert.deepStrictEqual(sent, [], 'an inactive member must not be messaged');
});

test('an inactive member is a failure when strict mode is requested', async () => {
  const { sent, options } = setup();
  const result = await notify('child-1', 'hello', { ...options, strict: true });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(result.reason, REASON.INACTIVE_MEMBER);
  assert.deepStrictEqual(sent, []);
});

// ---------------------------------------------------------- transport failure

test('a transport failure is reported without throwing', async () => {
  const { sent, options } = setup({ failFor: ['parent-1'] });
  const result = await notify('parent-1', 'hello', options);

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, REASON.SEND_FAILED);
  assert.strictEqual(result.channel, 'test-channel', 'the channel that failed should be named');
  assert.ok(result.detail.includes('transport down'), 'the cause should be reported');
  assert.deepStrictEqual(sent, []);
});

test('a member with no available channel is a structured failure', async () => {
  const router = createChannelRouter({ channels: [], defaultChannel: 'nothing' });
  const result = await notify('parent-1', 'hello', { family, router });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, REASON.NO_CHANNEL);
});

// -------------------------------------------------------- multiple recipients

test('notifyMany delivers to each recipient and reports per recipient', async () => {
  const { sent, options } = setup();
  const summary = await notifyMany(['parent-1', 'parent-2'], 'school run', options);

  assert.strictEqual(summary.ok, true);
  assert.deepStrictEqual({ sent: summary.sent, skipped: summary.skipped, failed: summary.failed }, {
    sent: 2,
    skipped: 0,
    failed: 0,
  });
  assert.deepStrictEqual(
    summary.results.map((r) => r.memberId),
    ['parent-1', 'parent-2'],
    'results should follow the requested order'
  );
  assert.deepStrictEqual(sent.map((s) => s.memberId), ['parent-1', 'parent-2']);
});

test('notifyMany handles an empty or missing list', async () => {
  const { options } = setup();
  for (const ids of [[], null, undefined]) {
    const summary = await notifyMany(ids, 'hello', options);
    assert.strictEqual(summary.ok, true);
    assert.strictEqual(summary.sent, 0);
    assert.deepStrictEqual(summary.results, []);
  }
});

// ------------------------------------------------------------ partial failure

test('notifyMany continues past a failure and still delivers the rest', async () => {
  const { sent, options } = setup({ failFor: ['parent-1'] });
  const summary = await notifyMany(['parent-1', 'parent-2'], 'hello', options);

  assert.strictEqual(summary.ok, false, 'a partial failure is not ok overall');
  assert.strictEqual(summary.sent, 1);
  assert.strictEqual(summary.failed, 1);
  assert.strictEqual(summary.results[0].reason, REASON.SEND_FAILED);
  assert.strictEqual(summary.results[1].ok, true);
  assert.deepStrictEqual(sent.map((s) => s.memberId), ['parent-2'], 'the healthy recipient still got it');
});

test('notifyMany mixes skips, failures and successes in one summary', async () => {
  const { sent, options } = setup({ failFor: ['parent-2'] });
  const summary = await notifyMany(['parent-1', 'child-1', 'parent-2', 'nobody'], 'hello', options);

  assert.deepStrictEqual({ sent: summary.sent, skipped: summary.skipped, failed: summary.failed }, {
    sent: 1,
    skipped: 1,
    failed: 2,
  });
  assert.deepStrictEqual(
    summary.results.map((r) => r.reason),
    [null, REASON.INACTIVE_MEMBER, REASON.SEND_FAILED, REASON.UNKNOWN_MEMBER]
  );
  assert.deepStrictEqual(sent.map((s) => s.memberId), ['parent-1']);
});

// ------------------------------------------------------------------ broadcast

test('notifyAll reaches every active member and no one else', async () => {
  const { sent, options } = setup();
  const summary = await notifyAll('power is out', options);

  assert.strictEqual(summary.ok, true);
  assert.strictEqual(summary.sent, 2);
  assert.strictEqual(summary.skipped, 0, 'inactive members are not addressed at all');
  assert.deepStrictEqual(sent.map((s) => s.memberId), ['parent-1', 'parent-2']);
  assert.ok(!sent.some((s) => s.memberId === 'child-1'), 'an inactive member was messaged');
});

test('notifyAll reports a partial failure without stopping', async () => {
  const { sent, options } = setup({ failFor: ['parent-1'] });
  const summary = await notifyAll('power is out', options);

  assert.strictEqual(summary.ok, false);
  assert.strictEqual(summary.sent, 1);
  assert.strictEqual(summary.failed, 1);
  assert.deepStrictEqual(sent.map((s) => s.memberId), ['parent-2']);
});

test('notifyAll on a registry with no active members sends nothing', async () => {
  const empty = parseRegistry(
    JSON.stringify({
      members: [{ id: 'a', name: 'A', phone: '+6281234567890', role: 'child', active: false }],
    })
  );
  const { channel, sent } = recordingChannel();
  const summary = await notifyAll('hello', { family: empty, router: routerWith(channel) });

  assert.strictEqual(summary.ok, true);
  assert.strictEqual(summary.sent, 0);
  assert.deepStrictEqual(sent, []);
});

// -------------------------------------------------------------- channel router

test('the channel router validates what it is given', () => {
  const router = createChannelRouter();
  assert.throws(() => router.register({}), /non-empty name/);
  assert.throws(() => router.register({ name: 'x' }), /no send\(\) function/);
  router.register({ name: 'x', send: async () => {} });
  assert.throws(() => router.register({ name: 'x', send: async () => {} }), /already registered/);
});

test('the channel router can carry more than one channel', () => {
  const router = createChannelRouter({
    channels: [
      { name: 'whatsapp', send: async () => {} },
      { name: 'email', send: async () => {} },
    ],
    defaultChannel: 'whatsapp',
  });

  assert.deepStrictEqual(router.names(), ['whatsapp', 'email']);
  assert.strictEqual(router.resolve({ id: 'a' }).name, 'whatsapp', 'default should apply');
  assert.strictEqual(router.resolve({ id: 'a', channel: 'email' }).name, 'email');
  assert.strictEqual(router.resolve({ id: 'a', channel: 'carrier-pigeon' }), null);
});

// ------------------------------------------------- architectural boundaries

test('the engine never imports a transport', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'notifications', 'engine.js'), 'utf8');
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);

  assert.deepStrictEqual(requires.sort(), ['../familyRegistry', './channelRouter']);
  assert.ok(!/transports?\//.test(source), 'engine.js reaches into transports');
  assert.ok(!/whatsapp/i.test(source), 'engine.js mentions WhatsApp');
});

test('only the channel adapter depends on a transport', () => {
  const dir = path.join(__dirname, '..', 'src', 'notifications');
  const offenders = [];

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const source = fs.readFileSync(full, 'utf8');
      const importsTransport = /require\('[^']*transports\//.test(source);
      const isAdapter = full.includes(path.join('notifications', 'channels'));
      if (importsTransport && !isAdapter) offenders.push(path.relative(dir, full));
    }
  };
  walk(dir);

  assert.deepStrictEqual(offenders, [], 'a non-adapter file in the notification layer imports a transport');
});

// Addressing is by member id, and capability replies travel into chats that can
// be forwarded, so neither the notification layer nor any capability may handle
// a phone number. Local terminal diagnostics (doctor, whatsapp:status, the
// message command) legitimately display numbers for whoever is at the terminal
// and are outside this rule — see familyReport.js, which exists to show them.
test('no phone number is handled in the notification layer or in capabilities', () => {
  const root = path.join(__dirname, '..', 'src');
  const offenders = [];

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      fs.readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
          if (/\.phone\b|phoneFromJid|normalizePhone/.test(line)) {
            offenders.push(`${path.relative(root, full)}:${index + 1}`);
          }
        });
    }
  };

  walk(path.join(root, 'notifications'));
  walk(path.join(root, 'capabilities'));

  assert.deepStrictEqual(
    offenders,
    [],
    `phone handling found where addressing is by member id:\n${offenders.join('\n')}`
  );
});
