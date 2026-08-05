const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'familyos.js');

const REGISTRY = {
  members: [
    { id: 'parent-1', name: 'First Parent', phone: '+6281234567890', role: 'owner', active: true },
    { id: 'child-1', name: 'First Child', phone: '+6281234567892', role: 'child', active: false },
  ],
};

// Runs the real CLI in a throwaway working directory, so it loads
// configs/family.json from disk exactly as it would on a device.
function withWorkspace(registry, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'familyos-test-'));
  try {
    if (registry !== null) {
      fs.mkdirSync(path.join(dir, 'configs'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'configs', 'family.json'),
        typeof registry === 'string' ? registry : JSON.stringify(registry, null, 2)
      );
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(dir, args) {
  try {
    return {
      code: 0,
      out: execFileSync('node', [CLI, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('familyos family reads the registry from disk', () => {
  withWorkspace(REGISTRY, (dir) => {
    const { code, out } = run(dir, ['family']);
    assert.strictEqual(code, 0, out);
    assert.ok(out.includes('parent-1'));
    assert.ok(out.includes('First Parent'));
    // the local view intentionally shows phones and inactive members
    assert.ok(out.includes('+6281234567890'));
    assert.ok(out.includes('child-1'));
    assert.ok(out.includes('1 active of 2 registered'));
  });
});

test('familyos message routes a command from a known member', () => {
  withWorkspace(REGISTRY, (dir) => {
    const { code, out } = run(dir, ['message', '--from', '6281234567890@s.whatsapp.net', '/ping']);
    assert.strictEqual(code, 0, out);
    assert.ok(out.includes('HANDLED /ping'));
    assert.ok(out.includes('First Parent'));
    assert.ok(out.includes('pong'));
  });
});

test('familyos message rejects an unknown sender with a non-zero exit', () => {
  withWorkspace(REGISTRY, (dir) => {
    const { code, out } = run(dir, ['message', '--from', '6289999999999@s.whatsapp.net', '/ping']);
    assert.strictEqual(code, 1, out);
    assert.ok(out.includes('REJECTED'));
    assert.ok(!out.toLowerCase().includes('pong'), 'a stranger received a reply');
  });
});

test('familyos message rejects a deactivated member', () => {
  withWorkspace(REGISTRY, (dir) => {
    const { code, out } = run(dir, ['message', '--from', '+6281234567892', '/ping']);
    assert.strictEqual(code, 1, out);
    assert.ok(out.includes('REJECTED'));
  });
});

test('familyos message ignores ordinary text from a known member', () => {
  withWorkspace(REGISTRY, (dir) => {
    const { code, out } = run(dir, ['message', '--from', '+6281234567890', 'good morning']);
    assert.strictEqual(code, 0, out);
    assert.ok(out.includes('IGNORED'));
  });
});

test('/family via the router hides phone numbers even though the CLI shows them', () => {
  withWorkspace(REGISTRY, (dir) => {
    const local = run(dir, ['family']).out;
    const chat = run(dir, ['message', '--from', '+6281234567890', '/family']).out;
    assert.ok(local.includes('+6281234567890'), 'local view should show phones');
    assert.ok(!chat.includes('6281234567890'), 'chat reply must not contain phone numbers');
  });
});

test('a missing registry explains how to create one', () => {
  withWorkspace(null, (dir) => {
    const { code, out } = run(dir, ['family']);
    assert.strictEqual(code, 1);
    assert.ok(out.includes('not found'), out);
    assert.ok(out.includes('family.example.json'), out);
  });
});

test('an invalid registry fails with the offending field named', () => {
  const broken = JSON.stringify({
    members: [{ id: 'a', name: 'A', phone: '+6281234567890', role: 'boss', active: true }],
  });
  withWorkspace(broken, (dir) => {
    const { code, out } = run(dir, ['family']);
    assert.strictEqual(code, 1);
    assert.ok(out.includes('role "boss"'), out);
  });
});

test('familyos message requires both a sender and a body', () => {
  withWorkspace(REGISTRY, (dir) => {
    assert.strictEqual(run(dir, ['message', '/ping']).code, 1);
    assert.strictEqual(run(dir, ['message', '--from', '+6281234567890']).code, 1);
  });
});

// The registry is meant to be the only source of phone numbers. This guards
// that by scanning the source for long digit runs used as data.
//
// Two kinds of line are exempt because they are documentation rather than a
// source of truth: comments, and placeholders introduced by "e.g." (the
// pairing prompt shows one so the user knows what format to type). A real
// regression -- a number assigned, compared, or used as a recipient -- would
// still be caught.
test('no phone number is hardcoded as data in the source', () => {
  const root = path.join(__dirname, '..');
  const files = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'bin'));

  const offenders = [];
  for (const file of files) {
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (line.includes('e.g.')) return;
        const match = line.match(/\+?\d{8,}/);
        if (match) {
          offenders.push(`${path.relative(root, file)}:${index + 1} -> ${match[0]}`);
        }
      });
  }

  assert.deepStrictEqual(offenders, [], `hardcoded phone numbers found:\n${offenders.join('\n')}`);
});
