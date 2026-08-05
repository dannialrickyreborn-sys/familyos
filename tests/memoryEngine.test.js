const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseRegistry } = require('../src/familyRegistry');
const { createInMemoryStore, createFileStore } = require('../src/memory/store');
const {
  REASON,
  remember,
  recall,
  forget,
  search,
  listSubject,
  listAll,
} = require('../src/memory/engine');

const family = parseRegistry(
  JSON.stringify({
    members: [
      { id: 'parent-1', name: 'First Parent', phone: '+6281234567890', role: 'owner', active: true },
      { id: 'parent-2', name: 'Second Parent', phone: '+6281234567891', role: 'child', active: true },
      { id: 'child-1', name: 'First Child', phone: '+6281234567892', role: 'child', active: false },
    ],
  })
);

// A fixed clock keeps results byte-for-byte comparable.
const now = () => '2026-08-05T00:00:00.000Z';

function ctx(initial) {
  return { family, store: createInMemoryStore(initial), now };
}

// -------------------------------------------------------------------- remember

test('remember stores a fact and reports what happened', () => {
  const options = ctx();
  const result = remember('parent-1', 'allergy', 'peanuts', options);

  assert.deepStrictEqual(result, {
    ok: true,
    subjectId: 'parent-1',
    key: 'allergy',
    value: 'peanuts',
    mode: 'set',
    overwritten: false,
    active: true,
  });
});

test('keys are normalized so casing and spacing do not create duplicates', () => {
  const options = ctx();
  remember('parent-1', '  Allergy ', 'peanuts', options);

  assert.strictEqual(recall('parent-1', 'ALLERGY', options).value, 'peanuts');
  assert.strictEqual(listSubject('parent-1', options).facts.length, 1);
});

test('remember rejects an empty key or value', () => {
  const options = ctx();

  for (const key of ['', '   ', null, undefined, 7]) {
    assert.strictEqual(remember('parent-1', key, 'x', options).reason, REASON.INVALID_KEY);
  }
  for (const value of ['', '   ', null, undefined]) {
    assert.strictEqual(remember('parent-1', 'k', value, options).reason, REASON.INVALID_VALUE);
  }
  assert.deepStrictEqual(listAll(options).facts, [], 'nothing should have been stored');
});

test('remember accepts structured values, not just strings', () => {
  const options = ctx();
  remember('parent-1', 'sizes', { shoe: 42, shirt: 'M' }, options);

  assert.deepStrictEqual(recall('parent-1', 'sizes', options).value, { shoe: 42, shirt: 'M' });
});

// ------------------------------------------------------------------- overwrite

test('a second write to the same key replaces the first by default', () => {
  const options = ctx();
  remember('parent-1', 'allergy', 'peanuts', options);
  const second = remember('parent-1', 'allergy', 'shellfish', options);

  assert.strictEqual(second.overwritten, true);
  assert.strictEqual(second.mode, 'set');
  assert.strictEqual(recall('parent-1', 'allergy', options).value, 'shellfish');
  assert.strictEqual(listSubject('parent-1', options).facts.length, 1, 'overwrite must not add a fact');
});

test('append mode accumulates values instead of replacing', () => {
  const options = ctx();
  remember('parent-1', 'allergy', 'peanuts', options);
  const appended = remember('parent-1', 'allergy', 'shellfish', { ...options, append: true });

  assert.strictEqual(appended.mode, 'append');
  assert.deepStrictEqual(appended.value, ['peanuts', 'shellfish']);

  remember('parent-1', 'allergy', 'dust', { ...options, append: true });
  assert.deepStrictEqual(recall('parent-1', 'allergy', options).value, [
    'peanuts',
    'shellfish',
    'dust',
  ]);
});

test('append on a key that does not exist yet just stores the value', () => {
  const options = ctx();
  const result = remember('parent-1', 'hobby', 'chess', { ...options, append: true });

  assert.strictEqual(result.value, 'chess');
  assert.strictEqual(result.mode, 'set');
});

test('a later plain write replaces an appended list', () => {
  const options = ctx();
  remember('parent-1', 'allergy', 'peanuts', options);
  remember('parent-1', 'allergy', 'shellfish', { ...options, append: true });
  remember('parent-1', 'allergy', 'none', options);

  assert.strictEqual(recall('parent-1', 'allergy', options).value, 'none');
});

// ---------------------------------------------------------------------- recall

test('recall returns the stored value with its timestamp', () => {
  const options = ctx();
  remember('parent-1', 'allergy', 'peanuts', options);
  const result = recall('parent-1', 'allergy', options);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.value, 'peanuts');
  assert.strictEqual(result.updatedAt, '2026-08-05T00:00:00.000Z');
});

test('recalling a key that was never stored is not an error', () => {
  const result = recall('parent-1', 'nothing', ctx());

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.found, false);
  assert.strictEqual(result.value, null);
});

test('facts are scoped per subject', () => {
  const options = ctx();
  remember('parent-1', 'allergy', 'peanuts', options);

  assert.strictEqual(recall('parent-2', 'allergy', options).found, false);
});

// ---------------------------------------------------------------------- forget

test('forget removes a fact and leaves the others alone', () => {
  const options = ctx();
  remember('parent-1', 'allergy', 'peanuts', options);
  remember('parent-1', 'hobby', 'chess', options);

  const result = forget('parent-1', 'allergy', options);
  assert.strictEqual(result.forgotten, true);
  assert.strictEqual(recall('parent-1', 'allergy', options).found, false);
  assert.strictEqual(recall('parent-1', 'hobby', options).value, 'chess');
});

test('forgetting something that was never stored is not an error', () => {
  const result = forget('parent-1', 'nothing', ctx());

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.forgotten, false);
});

test('a subject with nothing left is dropped from the store', () => {
  const store = createInMemoryStore();
  const options = { family, store, now };

  remember('parent-1', 'allergy', 'peanuts', options);
  forget('parent-1', 'allergy', options);

  assert.deepStrictEqual(store.load().subjects, {}, 'an empty subject shell was left behind');
});

// -------------------------------------------------------------- unknown member

test('an unknown subject is a structured error on every operation', () => {
  const options = ctx();

  for (const call of [
    () => remember('nobody', 'k', 'v', options),
    () => recall('nobody', 'k', options),
    () => forget('nobody', 'k', options),
    () => listSubject('nobody', options),
  ]) {
    const result = call();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, REASON.UNKNOWN_SUBJECT);
    assert.strictEqual(result.subjectId, 'nobody');
    assert.ok(result.detail.includes('nobody'), 'the error should name the id');
  }
});

test('nothing is written for an unknown subject', () => {
  const store = createInMemoryStore();
  remember('nobody', 'k', 'v', { family, store, now });

  assert.deepStrictEqual(store.load().subjects, {});
});

// ------------------------------------------------------------- inactive member

test('an inactive member can still be remembered and recalled', () => {
  // Memory is a record, not an action aimed at someone: deactivating a member
  // must not make their history unreachable.
  const options = ctx();
  const stored = remember('child-1', 'allergy', 'dairy', options);

  assert.strictEqual(stored.ok, true);
  assert.strictEqual(stored.active, false, 'the result should flag the subject as inactive');

  const recalled = recall('child-1', 'allergy', options);
  assert.strictEqual(recalled.found, true);
  assert.strictEqual(recalled.value, 'dairy');
  assert.strictEqual(recalled.active, false);
});

test('an inactive member can be forgotten', () => {
  const options = ctx();
  remember('child-1', 'allergy', 'dairy', options);

  assert.strictEqual(forget('child-1', 'allergy', options).forgotten, true);
});

// ---------------------------------------------------------------------- search

function populated() {
  const options = ctx();
  remember('parent-1', 'allergy', 'peanuts', options);
  remember('parent-1', 'hobby', 'chess', options);
  remember('parent-2', 'allergy', 'shellfish', options);
  remember('child-1', 'favourite food', 'peanut butter', options);
  return options;
}

test('search matches on the key', () => {
  const matches = search('allergy', populated()).matches;

  assert.deepStrictEqual(
    matches.map((m) => `${m.subjectId}/${m.key}`),
    ['parent-1/allergy', 'parent-2/allergy']
  );
});

test('search matches on the value', () => {
  const matches = search('chess', populated()).matches;

  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].value, 'chess');
});

test('search is case-insensitive and matches substrings', () => {
  for (const query of ['PEANUT', 'peanut', 'Peanut']) {
    const matches = search(query, populated()).matches;
    assert.deepStrictEqual(
      matches.map((m) => m.subjectId),
      ['child-1', 'parent-1'],
      `failed for query "${query}"`
    );
  }
});

test('search results are ordered by subject then key, whatever the write order', () => {
  const forward = ctx();
  remember('parent-2', 'zeta', 'peanuts', forward);
  remember('parent-1', 'beta', 'peanuts', forward);
  remember('parent-1', 'alpha', 'peanuts', forward);

  assert.deepStrictEqual(
    search('peanuts', forward).matches.map((m) => `${m.subjectId}/${m.key}`),
    ['parent-1/alpha', 'parent-1/beta', 'parent-2/zeta']
  );
});

test('search can be narrowed to one subject', () => {
  const options = populated();
  const matches = search('allergy', { ...options, subjectId: 'parent-2' }).matches;

  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].subjectId, 'parent-2');
});

test('an empty query matches nothing rather than everything', () => {
  for (const query of ['', '   ', null, undefined]) {
    assert.deepStrictEqual(search(query, populated()).matches, []);
  }
});

test('search finds nothing when nothing matches', () => {
  assert.deepStrictEqual(search('bicycle', populated()).matches, []);
});

test('the matcher is swappable, so vector search needs no API change', () => {
  const options = populated();
  // A stand-in for a future semantic matcher: it ignores the literal text.
  const everything = () => true;
  const matches = search('anything at all', { ...options, matcher: everything }).matches;

  assert.strictEqual(matches.length, 4, 'a custom matcher should decide what matches');
});

// ----------------------------------------------------------------- listing

test('listSubject returns one subject sorted by key', () => {
  const result = listSubject('parent-1', populated());

  assert.deepStrictEqual(result.facts.map((f) => f.key), ['allergy', 'hobby']);
});

test('listAll returns every fact sorted by subject then key', () => {
  const result = listAll(populated());

  assert.deepStrictEqual(
    result.facts.map((f) => `${f.subjectId}/${f.key}`),
    ['child-1/favourite food', 'parent-1/allergy', 'parent-1/hobby', 'parent-2/allergy']
  );
});

// ------------------------------------------------------------------ determinism

test('the same operations on the same store give the same result', () => {
  const run = () => {
    const options = ctx();
    remember('parent-2', 'b', '2', options);
    remember('parent-1', 'a', '1', options);
    return JSON.stringify(listAll(options).facts);
  };

  assert.strictEqual(run(), run());
});

// ----------------------------------------------------------------- persistence

function withTempStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'familyos-memory-'));
  try {
    return fn(path.join(dir, 'memory.json'), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('facts survive a restart: a new store instance reads what the old one wrote', () => {
  withTempStore((filePath) => {
    const first = createFileStore({ filePath, log: () => {} });
    remember('parent-1', 'allergy', 'peanuts', { family, store: first, now });
    remember('parent-1', 'hobby', 'chess', { family, store: first, now });

    // A brand-new store, as a restarted process would build.
    const second = createFileStore({ filePath, log: () => {} });
    const result = recall('parent-1', 'allergy', { family, store: second });

    assert.strictEqual(result.found, true);
    assert.strictEqual(result.value, 'peanuts');
    assert.deepStrictEqual(
      listSubject('parent-1', { family, store: second }).facts.map((f) => f.key),
      ['allergy', 'hobby']
    );
  });
});

test('a forget survives a restart too', () => {
  withTempStore((filePath) => {
    const first = createFileStore({ filePath, log: () => {} });
    remember('parent-1', 'allergy', 'peanuts', { family, store: first, now });
    forget('parent-1', 'allergy', { family, store: first });

    const second = createFileStore({ filePath, log: () => {} });
    assert.strictEqual(recall('parent-1', 'allergy', { family, store: second }).found, false);
  });
});

test('the memory file is written atomically, leaving no temp file behind', () => {
  withTempStore((filePath, dir) => {
    const store = createFileStore({ filePath, log: () => {} });
    remember('parent-1', 'allergy', 'peanuts', { family, store, now });

    assert.ok(fs.existsSync(filePath));
    assert.ok(fs.statSync(filePath).size > 0, 'the memory file is empty');
    assert.deepStrictEqual(
      fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')),
      [],
      'a temp file was left behind'
    );
  });
});

test('a missing memory file reads as empty rather than failing', () => {
  withTempStore((filePath) => {
    const store = createFileStore({ filePath, log: () => {} });
    assert.deepStrictEqual(listAll({ family, store }).facts, []);
  });
});

// --------------------------------------------------- corrupted storage recovery

test('a corrupt memory file is quarantined and memory starts empty', () => {
  withTempStore((filePath) => {
    fs.writeFileSync(filePath, '{ this is not json');
    const logs = [];
    const store = createFileStore({ filePath, log: (line) => logs.push(line) });

    assert.deepStrictEqual(listAll({ family, store }).facts, [], 'corrupt data should not load');
    assert.ok(fs.existsSync(`${filePath}.corrupt`), 'the damaged file should be kept for inspection');
    assert.ok(!fs.existsSync(filePath), 'the corrupt file should have been moved aside');
    assert.ok(logs.some((line) => line.includes('unreadable')), 'the recovery should be reported');
  });
});

test('an empty memory file recovers the same way', () => {
  withTempStore((filePath) => {
    fs.writeFileSync(filePath, '');
    const store = createFileStore({ filePath, log: () => {} });

    assert.deepStrictEqual(listAll({ family, store }).facts, []);
    assert.ok(fs.existsSync(`${filePath}.corrupt`));
  });
});

test('a well-formed file with the wrong shape is treated as corrupt', () => {
  withTempStore((filePath) => {
    fs.writeFileSync(filePath, JSON.stringify(['not', 'a', 'memory']));
    const store = createFileStore({ filePath, log: () => {} });

    assert.deepStrictEqual(listAll({ family, store }).facts, []);
    assert.ok(fs.existsSync(`${filePath}.corrupt`));
  });
});

test('writing still works after a corrupt file is recovered from', () => {
  withTempStore((filePath) => {
    fs.writeFileSync(filePath, 'garbage');
    const store = createFileStore({ filePath, log: () => {} });

    assert.strictEqual(remember('parent-1', 'allergy', 'peanuts', { family, store, now }).ok, true);

    const reopened = createFileStore({ filePath, log: () => {} });
    assert.strictEqual(recall('parent-1', 'allergy', { family, store: reopened }).value, 'peanuts');
  });
});

// ------------------------------------------------------ architectural boundaries

test('the memory engine imports neither WhatsApp nor notifications', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'memory', 'engine.js'), 'utf8');

  // The require list is the real guarantee.
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(requires.sort(), ['../familyRegistry', './store']);

  // Comments are excluded: engine.js documents the boundary in prose, which
  // names both layers precisely because it must not depend on them.
  const code = source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');

  assert.ok(!/whatsapp/i.test(code), 'engine.js code references WhatsApp');
  assert.ok(!/notification/i.test(code), 'engine.js code references notifications');
});

test('nothing in the memory layer reaches a transport or the notification layer', () => {
  const dir = path.join(__dirname, '..', 'src', 'memory');
  const offenders = [];

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.js')) continue;
    const source = fs.readFileSync(path.join(dir, entry), 'utf8');
    if (/require\('[^']*transports\//.test(source)) offenders.push(`${entry} -> transport`);
    if (/require\('[^']*notifications\//.test(source)) offenders.push(`${entry} -> notifications`);
  }

  assert.deepStrictEqual(offenders, []);
});

test('memory capabilities use the public API only, never the store', () => {
  const dir = path.join(__dirname, '..', 'src', 'capabilities');
  const PUBLIC = new Set(['remember', 'recall', 'forget', 'search', 'listSubject', 'listAll', 'REASON']);
  const offenders = [];

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.js')) continue;
    const source = fs.readFileSync(path.join(dir, entry), 'utf8');

    if (/require\('[^']*memory\/store'\)/.test(source)) {
      offenders.push(`${entry} requires the memory store directly`);
    }

    // Every name a capability destructures out of the engine must be public.
    const imported = source.match(/const \{([^}]+)\} = require\('\.\.\/memory\/engine'\)/);
    if (imported) {
      imported[1]
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .forEach((name) => {
          if (!PUBLIC.has(name)) offenders.push(`${entry} imports non-public "${name}"`);
        });
    }
  }

  assert.deepStrictEqual(offenders, []);
});
