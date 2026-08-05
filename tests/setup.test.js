const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { idFor, buildRegistry, exitCodeFor } = require('../src/setup');
const { parseRegistry } = require('../src/familyRegistry');

const CLI = path.join(__dirname, '..', 'bin', 'familyos.js');

// Feeds scripted answers to the prompt-driven builder.
function scriptedAsk(answers) {
  const queue = [...answers];
  return async () => {
    if (queue.length === 0) throw new Error('setup asked more questions than expected');
    return queue.shift();
  };
}

function withWorkspace(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'familyos-setup-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(dir, args) {
  try {
    return {
      code: 0,
      out: execFileSync('node', [CLI, ...args], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

// ------------------------------------------------------------------ member ids

test('ids are derived from the name, so nobody has to invent one', () => {
  assert.strictEqual(idFor('Ricky', new Set()), 'ricky');
  assert.strictEqual(idFor('First Parent', new Set()), 'first-parent');
  assert.strictEqual(idFor('  Ibu  ', new Set()), 'ibu');
});

test('ids strip characters a registry id may not contain', () => {
  for (const [name, expected] of [
    ["O'Brien", 'o-brien'],
    ['Anak #2', 'anak-2'],
    ['Ísabel', 'sabel'],
    ['...', 'member'],
    ['', 'member'],
  ]) {
    const id = idFor(name, new Set());
    assert.strictEqual(id, expected, `"${name}" produced "${id}"`);
    assert.ok(/^[a-z0-9][a-z0-9_-]*$/.test(id), `"${id}" is not a valid registry id`);
  }
});

test('ids stay unique when two people share a name', () => {
  const taken = new Set(['ricky']);
  assert.strictEqual(idFor('Ricky', taken), 'ricky-2');
  taken.add('ricky-2');
  assert.strictEqual(idFor('Ricky', taken), 'ricky-3');
});

// --------------------------------------------------------- building a registry

test('the first member set up becomes the owner without being asked', async () => {
  const registry = await buildRegistry(scriptedAsk(['Ricky', '+6281234567890', 'n']));

  assert.strictEqual(registry.members.length, 1);
  assert.deepStrictEqual(registry.members[0], {
    id: 'ricky',
    name: 'Ricky',
    phone: '+6281234567890',
    role: 'owner',
    active: true,
  });
});

test('later members are asked for a role', async () => {
  const registry = await buildRegistry(
    scriptedAsk([
      'Ricky', '+6281234567890', 'y',
      'Ibu', '+6281234567891', '2', 'y',
      'Anak', '+6281234567892', '4', 'n',
    ])
  );

  assert.deepStrictEqual(
    registry.members.map((m) => `${m.id}:${m.role}`),
    ['ricky:owner', 'ibu:parent', 'anak:child']
  );
});

test('an empty role answer takes the first option', async () => {
  const registry = await buildRegistry(
    scriptedAsk(['Ricky', '+6281234567890', 'y', 'Ibu', '+6281234567891', '', 'n'])
  );

  assert.strictEqual(registry.members[1].role, 'owner');
});

test('what setup builds always passes the real registry validation', async () => {
  const registry = await buildRegistry(
    scriptedAsk(['Ricky', '+6281234567890', 'y', 'Ibu', '0062 812-3456-7891', '2', 'n'])
  );

  const parsed = parseRegistry(JSON.stringify(registry));
  assert.strictEqual(parsed.members.length, 2);
  // Normalization happens on the way in, so both numbers are stored as E.164.
  assert.strictEqual(parsed.members[1].phone, '+6281234567891');
});

test('a bad phone number is re-asked rather than accepted', async () => {
  const registry = await buildRegistry(
    scriptedAsk(['Ricky', 'not-a-number', '0812345678', '+6281234567890', 'n'])
  );

  assert.strictEqual(registry.members[0].phone, '+6281234567890');
});

test('an empty name is re-asked', async () => {
  const registry = await buildRegistry(scriptedAsk(['', '   ', 'Ricky', '+6281234567890', 'n']));

  assert.strictEqual(registry.members[0].name, 'Ricky');
});

test('a duplicate phone number is refused instead of corrupting the registry', async () => {
  const registry = await buildRegistry(
    scriptedAsk(['Ricky', '+6281234567890', 'y', 'Same Person', '+6281234567890', '2', 'n'])
  );

  assert.strictEqual(registry.members.length, 1, 'the duplicate should not have been added');
  assert.doesNotThrow(() => parseRegistry(JSON.stringify(registry)));
});

test('giving up on the phone number fails loudly rather than writing junk', async () => {
  await assert.rejects(
    () => buildRegistry(scriptedAsk(['Ricky', 'a', 'b', 'c', 'd', 'e'])),
    /Too many invalid phone numbers/
  );
});

// ------------------------------------------------------- the setup command

test('setup explains itself instead of hanging when it cannot ask questions', () => {
  withWorkspace((dir) => {
    fs.copyFileSync(
      path.join(__dirname, '..', 'configs', 'family.example.json'),
      path.join(fs.mkdirSync(path.join(dir, 'configs'), { recursive: true }) || path.join(dir, 'configs'), 'family.example.json')
    );

    const { code, out } = run(dir, ['setup']);

    assert.strictEqual(code, 1, out);
    assert.ok(out.includes('not interactive'), out);
    assert.ok(out.includes('npm run whatsapp:link'), 'it should still say what to do');
  });
});

test('deferring WhatsApp pairing is not treated as a failure', () => {
  // The registry is what makes FamilyOS usable; pairing later is a valid
  // choice. Exiting non-zero would make npm print an error block over a setup
  // that worked, which is alarming for a non-developer.
  assert.strictEqual(exitCodeFor({ registryOk: true }), 0, 'deferred pairing must not fail');
  assert.strictEqual(exitCodeFor({ registryOk: false }), 1, 'an unusable registry must fail');
});

test('setup creates .env from the template so nobody has to know it exists', () => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'configs'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.env.example'), 'NOTION_TOKEN=\n');

    run(dir, ['setup']);

    assert.ok(fs.existsSync(path.join(dir, '.env')), '.env was not created');
  });
});

// ------------------------------------------------------------------- doctor

test('doctor separates the required assistant from the optional Notion brief', () => {
  withWorkspace((dir) => {
    const { code, out } = run(dir, ['doctor']);

    assert.strictEqual(code, 1, 'an unconfigured install is not ready');
    assert.ok(out.includes('Required — WhatsApp assistant'), out);
    assert.ok(out.includes('Optional — Notion daily brief'), out);

    // Notion is not configured, which must not be reported as a failure.
    assert.ok(out.includes('[SKIP] Notion token'), out);
    assert.ok(out.includes('only affects "npm run brief"'), out);

    // The actionable list stays short: the two things actually missing.
    assert.ok(out.includes('2 required check(s) failed'), out);
    assert.ok(out.includes('run "npm run setup"'), out);
  });
});

test('doctor stops naming the registry once it is configured', () => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'configs'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'configs', 'family.json'),
      JSON.stringify({
        members: [
          { id: 'ricky', name: 'Ricky', phone: '+6281234567890', role: 'owner', active: true },
        ],
      })
    );

    const { out } = run(dir, ['doctor']);

    assert.ok(out.includes('[OK  ] Family registry — 1 active member(s)'), out);
    assert.ok(out.includes('1 required check(s) failed'), 'only WhatsApp should remain');
  });
});

test('doctor reports a registry with no active members as not ready', () => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'configs'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'configs', 'family.json'),
      JSON.stringify({
        members: [
          { id: 'ricky', name: 'Ricky', phone: '+6281234567890', role: 'owner', active: false },
        ],
      })
    );

    const { out } = run(dir, ['doctor']);
    assert.ok(out.includes('No active members'), out);
  });
});

// --------------------------------------------------- setup is in the CLI

test('setup is the first command the usage text offers', () => {
  const { out } = run(path.join(__dirname, '..'), ['nonsense-command']);
  const lines = out.split('\n');
  const commandsAt = lines.findIndex((line) => line.startsWith('Commands:'));

  assert.ok(commandsAt >= 0, out);
  assert.match(lines[commandsAt + 1], /^\s+setup\b/, 'setup should be listed first');
});

test('npm run setup installs dependencies before running, so one command is enough', () => {
  const scripts = require('../package.json').scripts;

  assert.ok(scripts.setup.includes('npm install'), 'setup must install dependencies itself');
  assert.ok(scripts.setup.includes('familyos.js setup'), 'setup must then run the setup command');
});
