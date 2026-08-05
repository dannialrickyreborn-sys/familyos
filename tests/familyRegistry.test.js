const test = require('node:test');
const assert = require('node:assert');
const { parseRegistry, activeMembers, findByPhone, findById } = require('../src/familyRegistry');

const VALID = JSON.stringify({
  members: [
    { id: 'parent-1', name: 'First Parent', phone: '+6281234567890', role: 'owner', active: true },
    { id: 'parent-2', name: 'Second Parent', phone: '0062 812-3456-7891', role: 'child', active: true },
    { id: 'child-1', name: 'First Child', phone: '+6281234567892', role: 'child', active: false },
  ],
});

test('parses a valid registry and normalizes phones to E.164', () => {
  const registry = parseRegistry(VALID);
  assert.strictEqual(registry.members.length, 3);
  assert.strictEqual(registry.members[0].phone, '+6281234567890');
  // "0062 812-3456-7891" must normalize to the same shape as the others
  assert.strictEqual(registry.members[1].phone, '+6281234567891');
  assert.strictEqual(registry.members[1].digits, '6281234567891');
});

test('activeMembers excludes deactivated members', () => {
  const registry = parseRegistry(VALID);
  assert.deepStrictEqual(
    activeMembers(registry).map((m) => m.id),
    ['parent-1', 'parent-2']
  );
});

test('findByPhone matches regardless of how the number is written', () => {
  const registry = parseRegistry(VALID);
  for (const form of ['+6281234567890', '6281234567890', '+62 812 3456 7890', '006281234567890']) {
    assert.strictEqual(findByPhone(registry, form)?.id, 'parent-1', `failed for ${form}`);
  }
});

test('findByPhone refuses inactive members and unknown numbers', () => {
  const registry = parseRegistry(VALID);
  assert.strictEqual(findByPhone(registry, '+6281234567892'), null, 'inactive member resolved');
  assert.strictEqual(findByPhone(registry, '+6289999999999'), null, 'stranger resolved');
  assert.strictEqual(findByPhone(registry, 'not-a-number'), null);
  assert.strictEqual(findByPhone(registry, ''), null);
});

test('findById returns inactive members too, so records are not lost', () => {
  const registry = parseRegistry(VALID);
  assert.strictEqual(findById(registry, 'child-1').active, false);
  assert.strictEqual(findById(registry, 'nobody'), null);
});

test('rejects malformed registries with an actionable message', () => {
  const cases = [
    ['{ not json', /not valid JSON/],
    ['{}', /"members" array/],
    [JSON.stringify({ members: [{ name: 'x', phone: '+6281234567890', role: 'owner', active: true }] }), /non-empty "id"/],
    [JSON.stringify({ members: [{ id: 'a', name: 'x', phone: '+6281234567890', role: 'boss', active: true }] }), /role "boss"/],
    [JSON.stringify({ members: [{ id: 'a', name: 'x', phone: '+6281234567890', role: 'owner' }] }), /"active" to be true or false/],
    [JSON.stringify({ members: [{ id: 'a', name: 'x', phone: '0812345', role: 'owner', active: true }] }), /invalid phone/],
    [JSON.stringify({ members: [{ id: 'Bad_ID', name: 'x', phone: '+6281234567890', role: 'owner', active: true }] }), /use lowercase/],
  ];

  for (const [input, expected] of cases) {
    assert.throws(() => parseRegistry(input), expected, `should reject: ${input.slice(0, 40)}`);
  }
});

test('rejects duplicate ids and duplicate phone numbers', () => {
  const dupId = JSON.stringify({
    members: [
      { id: 'a', name: 'A', phone: '+6281234567890', role: 'owner', active: true },
      { id: 'a', name: 'B', phone: '+6281234567891', role: 'child', active: true },
    ],
  });
  assert.throws(() => parseRegistry(dupId), /duplicate id "a"/);

  // Same person written two ways must still be caught
  const dupPhone = JSON.stringify({
    members: [
      { id: 'a', name: 'A', phone: '+6281234567890', role: 'owner', active: true },
      { id: 'b', name: 'B', phone: '62 812 3456 7890', role: 'child', active: true },
    ],
  });
  assert.throws(() => parseRegistry(dupPhone), /share the same phone number/);
});
