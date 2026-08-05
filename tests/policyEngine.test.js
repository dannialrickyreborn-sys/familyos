const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseRegistry, ROLES } = require('../src/familyRegistry');
const { REASON, authorize } = require('../src/policy/engine');
const { actions, ruleFor } = require('../src/policy/rules');
const { loadCapabilities } = require('../src/capabilities/runtime');

const family = parseRegistry(
  JSON.stringify({
    members: [
      { id: 'owner-1', name: 'The Owner', phone: '+6281234567890', role: 'owner', active: true },
      { id: 'parent-1', name: 'A Parent', phone: '+6281234567891', role: 'parent', active: true },
      { id: 'sibling-1', name: 'A Sibling', phone: '+6281234567892', role: 'sibling', active: true },
      { id: 'child-1', name: 'A Child', phone: '+6281234567893', role: 'child', active: true },
      { id: 'guest-1', name: 'A Guest', phone: '+6281234567894', role: 'guest', active: true },
      { id: 'former-1', name: 'Former Member', phone: '+6281234567895', role: 'owner', active: false },
    ],
  })
);

const who = Object.fromEntries(family.members.map((member) => [member.id, member]));

// ------------------------------------------------------------------- the roles

test('the five roles are the ones the policy defines', () => {
  assert.deepStrictEqual(ROLES, ['owner', 'parent', 'sibling', 'child', 'guest']);
});

// ------------------------------------------------------- memory: read is open

test('everyone may recall', () => {
  for (const role of ROLES) {
    const actor = family.members.find((m) => m.role === role && m.active);
    assert.strictEqual(authorize(actor, 'memory.recall').allow, true, `${role} was denied recall`);
  }
});

// ------------------------------------------- memory: remember self vs others

test('everyone may remember facts about themselves', () => {
  for (const id of ['owner-1', 'parent-1', 'sibling-1', 'child-1', 'guest-1']) {
    const decision = authorize(who[id], 'memory.remember', { subjectId: id });
    assert.strictEqual(decision.allow, true, `${who[id].role} was denied remembering about self`);
  }
});

test('owner and parent may remember facts about others', () => {
  for (const id of ['owner-1', 'parent-1']) {
    const decision = authorize(who[id], 'memory.remember', { subjectId: 'child-1' });
    assert.strictEqual(decision.allow, true, `${who[id].role} was denied remembering about others`);
  }
});

test('sibling, child and guest may not remember facts about others', () => {
  for (const id of ['sibling-1', 'child-1', 'guest-1']) {
    const decision = authorize(who[id], 'memory.remember', { subjectId: 'owner-1' });
    assert.strictEqual(decision.allow, false, `${who[id].role} was allowed to write about others`);
    assert.strictEqual(decision.reason, REASON.PERMISSION_DENIED);
    assert.ok(decision.detail.includes('another member'), 'the refusal should say the scope');
  }
});

test('the coarse gate lets a child through, because remembering about self is allowed', () => {
  // Asked without a resource, a { self, others } rule must not block someone
  // the precise check would have permitted.
  assert.strictEqual(authorize(who['child-1'], 'memory.remember').allow, true);
});

// -------------------------------------------------------------- memory: forget

test('only owner and parent may forget', () => {
  const allowed = ['owner-1', 'parent-1'];
  const denied = ['sibling-1', 'child-1', 'guest-1'];

  for (const id of allowed) {
    assert.strictEqual(authorize(who[id], 'memory.forget').allow, true, `${id} denied`);
  }
  for (const id of denied) {
    assert.strictEqual(authorize(who[id], 'memory.forget').allow, false, `${id} allowed`);
  }
});

test('forget is restricted even for your own facts', () => {
  // The rule is a flat role list, so there is no self exception.
  const decision = authorize(who['child-1'], 'memory.forget', { subjectId: 'child-1' });
  assert.strictEqual(decision.allow, false);
});

// --------------------------------------------------------------- notifications

test('everyone may notify themselves', () => {
  for (const id of ['owner-1', 'parent-1', 'sibling-1', 'child-1', 'guest-1']) {
    const decision = authorize(who[id], 'notification.notify', { subjectId: id });
    assert.strictEqual(decision.allow, true, `${who[id].role} denied notifying self`);
  }
});

test('only owner and parent may notify others', () => {
  for (const id of ['owner-1', 'parent-1']) {
    assert.strictEqual(
      authorize(who[id], 'notification.notify', { subjectId: 'child-1' }).allow,
      true
    );
  }
  for (const id of ['sibling-1', 'child-1', 'guest-1']) {
    assert.strictEqual(
      authorize(who[id], 'notification.notify', { subjectId: 'owner-1' }).allow,
      false,
      `${who[id].role} was allowed to notify others`
    );
  }
});

test('only the owner may notify everyone', () => {
  assert.strictEqual(authorize(who['owner-1'], 'notification.notifyAll').allow, true);
  for (const id of ['parent-1', 'sibling-1', 'child-1', 'guest-1']) {
    assert.strictEqual(
      authorize(who[id], 'notification.notifyAll').allow,
      false,
      `${who[id].role} was allowed to broadcast`
    );
  }
});

// -------------------------------------------------------------- administration

test('only the owner may modify the registry', () => {
  assert.strictEqual(authorize(who['owner-1'], 'registry.modify').allow, true);
  for (const id of ['parent-1', 'sibling-1', 'child-1', 'guest-1']) {
    assert.strictEqual(authorize(who[id], 'registry.modify').allow, false, `${id} allowed`);
  }
});

test('everyone may read the registry', () => {
  for (const id of Object.keys(who)) {
    if (!who[id].active) continue;
    assert.strictEqual(authorize(who[id], 'registry.read').allow, true);
  }
});

// ------------------------------------------------------ actor-level refusals

test('an inactive member is denied even with a permitted role', () => {
  // former-1 is an owner, but inactive.
  const decision = authorize(who['former-1'], 'registry.modify');

  assert.strictEqual(decision.allow, false);
  assert.strictEqual(decision.reason, REASON.INACTIVE_ACTOR);
  assert.ok(decision.detail.includes('Former Member'));
});

test('an inactive member is denied even for an action open to everyone', () => {
  assert.strictEqual(authorize(who['former-1'], 'memory.recall').reason, REASON.INACTIVE_ACTOR);
});

test('an unknown or malformed actor is denied', () => {
  const cases = [null, undefined, {}, { id: 'x' }, { role: 'owner' }, { id: '', role: 'owner' }];

  for (const actor of cases) {
    const decision = authorize(actor, 'memory.recall');
    assert.strictEqual(decision.allow, false, `accepted actor: ${JSON.stringify(actor)}`);
    assert.strictEqual(decision.reason, REASON.UNKNOWN_ACTOR);
  }
});

test('an actor with a role outside the policy is denied', () => {
  const decision = authorize({ id: 'x', name: 'X', role: 'wizard', active: true }, 'memory.recall');

  assert.strictEqual(decision.allow, false);
  assert.strictEqual(decision.reason, REASON.PERMISSION_DENIED);
});

// ------------------------------------------------------------- fail closed

test('an action no policy defines is denied, not allowed', () => {
  const decision = authorize(who['owner-1'], 'something.invented');

  assert.strictEqual(decision.allow, false);
  assert.strictEqual(decision.reason, REASON.UNKNOWN_ACTION);
  assert.ok(decision.detail.includes('Known actions'), 'the refusal should list what exists');
});

test('even the owner cannot perform an undefined action', () => {
  for (const action of ['', null, undefined, 'memory', 'MEMORY.RECALL']) {
    assert.strictEqual(
      authorize(who['owner-1'], action).allow,
      false,
      `accepted action: ${JSON.stringify(action)}`
    );
  }
});

// ------------------------------------------------------------ result shape

test('a decision carries a structured reason and its context', () => {
  const denied = authorize(who['child-1'], 'registry.modify');

  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.allow, false);
  assert.strictEqual(denied.deny, true);
  assert.strictEqual(denied.reason, REASON.PERMISSION_DENIED);
  assert.strictEqual(denied.actor, 'child-1');
  assert.strictEqual(denied.action, 'registry.modify');
  assert.ok(typeof denied.detail === 'string' && denied.detail.length > 10);

  const allowed = authorize(who['owner-1'], 'registry.modify');
  assert.strictEqual(allowed.ok, true);
  assert.strictEqual(allowed.allow, true);
  assert.strictEqual(allowed.deny, false);
  assert.strictEqual(allowed.reason, null);
});

test('a resource may be given as a bare id or as an object', () => {
  const asString = authorize(who['child-1'], 'memory.remember', 'owner-1');
  const asObject = authorize(who['child-1'], 'memory.remember', { subjectId: 'owner-1' });

  assert.strictEqual(asString.allow, false);
  assert.strictEqual(asObject.allow, false);
  assert.strictEqual(asString.resource, 'owner-1');
});

test('authorize is deterministic', () => {
  const once = JSON.stringify(authorize(who['child-1'], 'memory.forget'));
  const twice = JSON.stringify(authorize(who['child-1'], 'memory.forget'));
  assert.strictEqual(once, twice);
});

// -------------------------------------------------- architectural boundaries

test('every registered capability declares an action the policy defines', () => {
  for (const capability of loadCapabilities().all()) {
    assert.ok(
      typeof capability.action === 'string' && capability.action.length > 0,
      `${capability.id} has no action`
    );
    assert.ok(ruleFor(capability.action), `${capability.id} declares undefined action "${capability.action}"`);
  }
});

// "Capabilities may not inspect roles directly" is about *decisions*: a
// capability must not branch on a role, because that is a permission decision
// made outside the Policy Engine. Showing a role is not a decision — /family
// lists each member's role, which is information, not authorization. So a role
// literal (always a policy decision or hardcoded policy) and a role used in a
// comparison are both rejected, while reading .role for display is allowed.
test('no capability declares roles or branches on them', () => {
  const dir = path.join(__dirname, '..', 'src', 'capabilities');
  const COMPARISON = /===|!==|==|!=|\.includes\(|\.indexOf\(|\bif\s*\(|\?|&&|\|\|/;
  const offenders = [];

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.js') || ['index.js', 'registry.js', 'runtime.js'].includes(entry)) continue;

    fs.readFileSync(path.join(dir, entry), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

        if (/permissions\s*:/.test(line)) {
          offenders.push(`${entry}:${index + 1} declares permissions`);
        }
        if (/\.role\b/.test(line) && COMPARISON.test(line)) {
          offenders.push(`${entry}:${index + 1} branches on .role`);
        }
        for (const role of ROLES) {
          if (new RegExp(`['"\`]${role}['"\`]`).test(line)) {
            offenders.push(`${entry}:${index + 1} names the role "${role}"`);
          }
        }
      });
  }

  assert.deepStrictEqual(offenders, [], `capabilities must not decide permissions:\n${offenders.join('\n')}`);
});

test('capabilities that need a resource decision use the Policy Engine', () => {
  // /remember is the one whose answer depends on whose facts are written.
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'capabilities', 'remember.js'),
    'utf8'
  );

  assert.ok(/require\('\.\.\/policy\/engine'\)/.test(source), '/remember does not use the Policy Engine');
  assert.ok(/authorize\(member, 'memory\.remember'/.test(source), '/remember does not authorize the subject');
});

test('the runtime authorizes before executing', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'capabilities', 'runtime.js'),
    'utf8'
  );

  assert.ok(/require\('\.\.\/policy\/engine'\)/.test(source), 'the runtime does not use the Policy Engine');

  const authorizeAt = source.indexOf('authorize(member');
  const executeAt = source.indexOf('capability.execute(');
  assert.ok(authorizeAt > 0 && executeAt > 0);
  assert.ok(authorizeAt < executeAt, 'the runtime must authorize before it executes');
});

test('the router contains no authorization logic', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'messageRouter.js'), 'utf8');
  const code = source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*');
    })
    .join('\n');

  for (const forbidden of ['authorize', 'permission', 'policy', '.role']) {
    assert.ok(!code.includes(forbidden), `messageRouter.js references "${forbidden}"`);
  }
  for (const role of ROLES) {
    assert.ok(!new RegExp(`['"\`]${role}['"\`]`).test(code), `messageRouter.js names the role "${role}"`);
  }
});

test('only the policy engine compares a role against a permission', () => {
  const root = path.join(__dirname, '..', 'src');
  const offenders = [];

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;

      // Handling a role as *data* is not a permission decision. The policy
      // layer decides; the registry validates the field; familyReport displays
      // it; setup assigns one when creating a member. None of those compares a
      // role to grant access, which is what this rule protects.
      const allowed = [
        path.join('src', 'policy'),
        path.join('src', 'familyRegistry.js'),
        path.join('src', 'familyReport.js'),
        path.join('src', 'setup.js'),
      ];
      if (allowed.some((prefix) => full.includes(prefix))) continue;

      fs.readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
          // A role literal outside the policy layer means a decision was made
          // somewhere it should not have been.
          for (const role of ROLES) {
            if (new RegExp(`['"\`]${role}['"\`]`).test(line)) {
              offenders.push(`${path.relative(root, full)}:${index + 1} names "${role}"`);
            }
          }
        });
    }
  };
  walk(root);

  assert.deepStrictEqual(offenders, [], `role decisions outside the policy layer:\n${offenders.join('\n')}`);
});

test('the policy table is the documented set of actions', () => {
  assert.deepStrictEqual(actions(), [
    'memory.forget',
    'memory.recall',
    'memory.remember',
    'notification.notify',
    'notification.notifyAll',
    'registry.modify',
    'registry.read',
    'system.help',
    'system.ping',
    'system.status',
  ]);
});
