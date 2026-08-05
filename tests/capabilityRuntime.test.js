const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createRegistry } = require('../src/capabilities/registry');
const { parseCommand, execute, loadCapabilities, REASON } = require('../src/capabilities/runtime');
const { parseRegistry } = require('../src/familyRegistry');
const { routeMessage, RESULT } = require('../src/messageRouter');

const family = parseRegistry(
  JSON.stringify({
    members: [
      { id: 'parent-1', name: 'First Parent', phone: '+6281234567890', role: 'admin', active: true },
      { id: 'parent-2', name: 'Second Parent', phone: '+6281234567891', role: 'member', active: true },
    ],
  })
);

const admin = family.members[0];
const member = family.members[1];

function stub(overrides = {}) {
  return {
    id: 'demo',
    command: 'demo',
    aliases: [],
    description: 'a demo capability',
    permissions: [],
    execute: () => 'demo ran',
    ...overrides,
  };
}

// ---------------------------------------------------------------- discovery

test('discovery loads every capability module in the directory', () => {
  const capabilities = loadCapabilities();
  const ids = capabilities.all().map((c) => c.id);

  for (const expected of ['help', 'status', 'family', 'ping']) {
    assert.ok(ids.includes(expected), `capability "${expected}" was not discovered`);
  }
});

test('discovery is driven by the directory, so a new file is picked up', () => {
  const dir = path.join(__dirname, '..', 'src', 'capabilities');
  const infrastructure = new Set(['index.js', 'registry.js', 'runtime.js']);
  const moduleFiles = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.js') && !infrastructure.has(file));

  // One registered capability per module file means nothing is hand-wired:
  // dropping a file in is what registers it.
  assert.strictEqual(loadCapabilities().size(), moduleFiles.length);
});

test('discovery is idempotent', () => {
  assert.strictEqual(loadCapabilities().size(), loadCapabilities().size());
});

test('/help is generated from the registry, not a hardcoded list', () => {
  const help = loadCapabilities().get('help');
  assert.ok(help, 'the help capability should be discovered');

  // Give /help an isolated registry containing one capability it has never
  // seen; if the list is generated, it appears.
  const capabilities = createRegistry();
  capabilities.register(stub({ id: 'zzz', command: 'zzz', description: 'a late addition' }));

  const reply = help.execute({ capabilities });
  assert.ok(reply.includes('/zzz'), 'a newly registered capability is missing from /help');
  assert.ok(reply.includes('a late addition'));
});

// ------------------------------------------------------- alias resolution

test('resolves a capability by its primary command', () => {
  assert.strictEqual(loadCapabilities().resolve('family').id, 'family');
});

test('resolves a capability by each of its aliases', () => {
  const capabilities = loadCapabilities();
  const expected = { commands: 'help', members: 'family', health: 'status' };

  for (const [alias, id] of Object.entries(expected)) {
    assert.strictEqual(capabilities.resolve(alias)?.id, id, `alias "${alias}" did not resolve`);
  }
});

test('resolution is case-insensitive and rejects unknown words', () => {
  const capabilities = loadCapabilities();
  assert.strictEqual(capabilities.resolve('PING').id, 'ping');
  assert.strictEqual(capabilities.resolve('MeMbErS').id, 'family');
  assert.strictEqual(capabilities.resolve('nope'), null);
  assert.strictEqual(capabilities.resolve(''), null);
  assert.strictEqual(capabilities.resolve(undefined), null);
});

test('an alias reaches the same capability as the command through the runtime', () => {
  const viaCommand = execute(parseCommand('/family'), { member: admin, family });
  const viaAlias = execute(parseCommand('/members'), { member: admin, family });

  assert.strictEqual(viaAlias.capability, viaCommand.capability);
  assert.strictEqual(viaAlias.reply, viaCommand.reply);
});

// --------------------------------------------------- permission validation

test('an empty permissions list allows any active member', () => {
  const capabilities = createRegistry();
  capabilities.register(stub({ permissions: [] }));

  for (const who of [admin, member]) {
    const response = execute(parseCommand('/demo'), { member: who, family, capabilities });
    assert.strictEqual(response.ok, true, `${who.role} was refused an open capability`);
  }
});

test('a restricted capability admits a listed role and refuses others', () => {
  const capabilities = createRegistry();
  capabilities.register(stub({ permissions: ['admin'] }));

  const allowed = execute(parseCommand('/demo'), { member: admin, family, capabilities });
  assert.strictEqual(allowed.ok, true);
  assert.strictEqual(allowed.reply, 'demo ran');

  const refused = execute(parseCommand('/demo'), { member, family, capabilities });
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.reason, REASON.FORBIDDEN);
  assert.strictEqual(refused.capability, 'demo');
  assert.ok(refused.reply.includes('admin'), 'the refusal should say who may run it');
});

test('a refused capability never runs', () => {
  let ran = false;
  const capabilities = createRegistry();
  capabilities.register(stub({ permissions: ['admin'], execute: () => { ran = true; return 'x'; } }));

  execute(parseCommand('/demo'), { member, family, capabilities });
  assert.strictEqual(ran, false, 'execute() ran despite the permission check failing');
});

test('registration rejects an unknown role', () => {
  const capabilities = createRegistry();
  assert.throws(() => capabilities.register(stub({ permissions: ['boss'] })), /unknown role "boss"/);
});

// ------------------------------------------------------ unknown capability

test('an unknown command is reported, not thrown', () => {
  const response = execute(parseCommand('/nothing-here'), { member: admin, family });

  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.reason, REASON.UNKNOWN_COMMAND);
  assert.strictEqual(response.capability, null);
  assert.match(response.reply, /Unknown command "\/nothing-here"/);
  assert.ok(response.reply.includes('/help'));
});

test('a capability that throws is contained, not propagated', () => {
  const capabilities = createRegistry();
  capabilities.register(stub({ execute: () => { throw new Error('boom'); } }));

  const response = execute(parseCommand('/demo'), { member: admin, family, capabilities });
  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.reason, REASON.FAILED);
  assert.ok(response.reply.includes('boom'), 'the cause should be reported');
});

// -------------------------------------------------- registration validation

test('registration rejects malformed descriptors', () => {
  const cases = [
    [{}, /non-empty "id"/],
    [stub({ id: '' }), /non-empty "id"/],
    [stub({ description: '' }), /non-empty "description"/],
    [stub({ execute: undefined }), /no execute\(\) function/],
    [stub({ aliases: 'x' }), /"aliases" to be an array/],
    [stub({ permissions: 'admin' }), /"permissions" to be an array/],
    [stub({ command: 'Bad Command' }), /invalid command word/],
    [stub({ aliases: ['Bad Alias'] }), /invalid command word/],
  ];

  for (const [descriptor, expected] of cases) {
    const capabilities = createRegistry();
    assert.throws(() => capabilities.register(descriptor), expected);
  }
});

test('registration rejects duplicate ids and clashing command words', () => {
  const capabilities = createRegistry();
  capabilities.register(stub());

  assert.throws(() => capabilities.register(stub({ command: 'other' })), /duplicate id "demo"/);
  assert.throws(
    () => capabilities.register(stub({ id: 'other', command: 'demo' })),
    /claims "demo", already used by "demo"/
  );
  // an alias may not shadow another capability's command either
  assert.throws(
    () => capabilities.register(stub({ id: 'other', command: 'other', aliases: ['demo'] })),
    /claims "demo"/
  );
});

// -------------------------------------------- router knows nothing of commands

test('the router dispatches a capability it has never heard of', () => {
  // The definition of done: a capability the router has no knowledge of is
  // reachable purely by being registered.
  const capabilities = createRegistry();
  capabilities.register(
    stub({ id: 'brand-new', command: 'brand-new', aliases: ['bn'], execute: () => 'brand new reply' })
  );

  for (const text of ['/brand-new', '/bn']) {
    const out = routeMessage({ from: '+6281234567890', text }, family, capabilities);
    assert.strictEqual(out.result, RESULT.HANDLED, `router did not handle ${text}`);
    assert.strictEqual(out.capability, 'brand-new');
    assert.strictEqual(out.reply, 'brand new reply');
  }
});

test('the router surfaces a permission refusal without knowing the capability', () => {
  const capabilities = createRegistry();
  capabilities.register(stub({ permissions: ['admin'] }));

  const out = routeMessage({ from: '+6281234567891', text: '/demo' }, family, capabilities);
  assert.strictEqual(out.result, RESULT.HANDLED);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, REASON.FORBIDDEN);
});

test('the router source contains no command names', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'messageRouter.js'), 'utf8');
  for (const name of ['help', 'status', 'family', 'ping']) {
    assert.ok(
      !new RegExp(`['"\`]${name}['"\`]`).test(source),
      `messageRouter.js references the command "${name}"`
    );
  }
});

// ----------------------------------------------------------------- parsing

test('parseCommand recognises commands and ignores ordinary text', () => {
  assert.deepStrictEqual(parseCommand('/family list now'), { word: 'family', args: ['list', 'now'] });
  assert.deepStrictEqual(parseCommand('  /PING  '), { word: 'ping', args: [] });

  for (const text of ['hello', '', '   ', 'ask /help', null, undefined, '/']) {
    assert.strictEqual(parseCommand(text), null, `treated as a command: ${JSON.stringify(text)}`);
  }
});
