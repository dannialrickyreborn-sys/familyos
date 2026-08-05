# Policy Engine (CAP-009)

**Status:** Active.

The single place FamilyOS decides who may do what. Capabilities declare *what they do*; the Policy Engine decides *who may do it*.

## Where it sits

```
Runtime           coarse gate: could this actor ever perform this action?
    |
Policy Engine     src/policy/engine.js  +  src/policy/rules.js
    |
Capability        a capability acting on a specific subject asks again,
                  this time naming the resource
```

Before this, each capability carried a `permissions: ['admin']` list — a permission decision made in eight different files. Now a capability carries `action: 'memory.forget'` and never names a role.

## Public API

```js
const { authorize } = require('./policy/engine');

authorize(actor, action);                              // coarse
authorize(actor, action, { subjectId: 'child-1' });    // resource-scoped
authorize(actor, action, 'child-1');                   // same, bare id
```

Returns:

```js
{ ok, allow, deny, reason, detail, actor, action, resource }
```

| Field | Meaning |
|---|---|
| `allow` / `deny` | the decision, both present so callers can read whichever is clearer |
| `ok` | mirrors `allow`, matching the result shape used elsewhere in FamilyOS |
| `reason` | machine-readable: `permission_denied`, `unknown_actor`, `inactive_actor`, `unknown_action`, or `null` when allowed |
| `detail` | a sentence naming the role, the action, and who *is* allowed |

`actor` is a Family Registry member record. Nothing else needs to be passed — the engine reads the role itself, which is exactly why no other layer has to.

## Roles

```
owner  parent  sibling  child  guest
```

Defined once, in `src/policy/rules.js`, and re-exported by the family registry so `configs/family.json` validates against the same list. There is no hierarchy: each permission names the roles it allows explicitly, which is easier to read than inheritance and harder to get wrong.

## Rules

| Action | Who |
|---|---|
| `system.help` · `system.ping` · `system.status` | everyone |
| `registry.read` | everyone |
| `registry.modify` | owner |
| `memory.recall` | everyone |
| `memory.remember` | **self:** everyone · **others:** owner, parent |
| `memory.forget` | owner, parent |
| `notification.notify` | **self:** everyone · **others:** owner, parent |
| `notification.notifyAll` | owner |

A rule is either a flat list of roles, or `{ self, others }` when the answer depends on whose data is being touched.

`memory.forget` is deliberately a flat list with **no self exception**: losing a fact is harder to undo than adding one, so even a child cannot forget their own facts.

### Fail closed

An action absent from the table is **denied**, with a message listing the actions that do exist. A capability therefore cannot become accidentally public by declaring an action nobody defined — and the capability registry refuses to register such a capability in the first place, so the mistake surfaces at start-up rather than at the moment someone is wrongly allowed.

## Two-stage authorization

Some answers depend only on the actor (`memory.forget`); others depend on the target (`memory.remember`). Both are handled without capabilities knowing any roles:

1. **The runtime** calls `authorize(actor, capability.action)` before executing anything. No resource is named, so on a `{ self, others }` rule the engine permits the actor if *either* branch would. This gate stops a `child` from reaching `/forget` at all, while still letting them reach `/remember`.
2. **The capability** — only where it matters — calls `authorize(actor, action, { subjectId })` once it knows the subject. `/remember` is the one that does this today.

Asking twice is deliberate. A single check could not distinguish "remembering about yourself" from "remembering about a sibling", and pushing the whole decision into the capability would put policy back in eight files.

## Refusals in practice

```
sibling → /remember child-1 nickname bug
Not allowed: The "sibling" role may not memory.remember for another member. Allowed: owner, parent.

child   → /remember me hobby drawing
Remembered hobby for child-1.

child   → /forget me hobby
Not allowed: The "child" role may not memory.forget. Allowed: owner, parent.
```

A runtime refusal carries the engine's own reason as `policyReason`, so callers see `permission_denied` or `inactive_actor` rather than every refusal collapsing into one code.

## Layers that must not decide

Enforced by tests, not convention:

| Rule | How it is checked |
|---|---|
| Capabilities may not declare roles or branch on them | every capability file is scanned for role literals, `permissions:`, and `.role` in a comparison |
| Capabilities must use the Policy Engine | every registered capability must declare an action the policy defines; `/remember` is asserted to authorize its subject |
| The runtime authorizes before executing | the `authorize` call is asserted to appear before `capability.execute` in the source |
| The router contains no authorization logic | its source may not mention `authorize`, `permission`, `policy`, `.role`, or any role name |
| Only the policy layer compares a role | a role literal anywhere in `src/` outside `src/policy/` fails the build |

Reading a role to *display* it is allowed — `/family` lists each member's role, which is information rather than a decision. The test rejects role literals and role comparisons, not role display; that distinction is what "may not inspect roles directly" is protecting against.

## Migrating an existing registry

**This is a breaking change to `configs/family.json`.** The old roles were `admin` and `member`; they no longer validate. Update each member to one of the five roles:

```
admin  -> owner    (or parent for a second adult)
member -> parent | sibling | child | guest
```

The registry fails loudly with the valid list if a role is wrong, so a stale file is obvious rather than silently mis-authorized:

```
Family registry (…/configs/family.json): member #1 ("parent-1") has role "admin";
expected one of owner, parent, sibling, child, guest.
```

## Known limitations

- **No per-member overrides.** Permissions come from the role alone; there is no way to grant one person a single extra power.
- **No hierarchy.** `owner` is not automatically everything `parent` is; each rule lists its roles. Adding a role means reviewing the table.
- **Resource checks are opt-in per capability.** The runtime's coarse gate cannot know a subject, so a capability that acts on someone else's data must ask again. `/remember` does; a future capability that forgets to would be permitted by the coarse gate. The architecture test catches missing *actions*, not a missing second check — reviewing that remains a human step.
- **The CLI is not policed.** `familyos notify` and the other local commands run as whoever is at the terminal, with no actor, so policy does not apply. Local terminal access is already trusted, the same reasoning that lets `doctor` print phone numbers.
- **`notification.*` and `registry.modify` have no enforcement point yet.** The rules are defined and tested, but no capability sends notifications or edits the registry today, so nothing calls them in production. They are ready for when something does.

## Tests

`tests/policyEngine.test.js` covers the full role matrix for every action (owner allowed, parent allowed, sibling denied, child denied, guest denied), self-versus-others on both `memory.remember` and `notification.notify`, the coarse gate not blocking what the precise check would allow, inactive actor denied even with a permitted role, unknown and malformed actors denied, a role outside the policy denied, undefined actions denied with the known list, result shape and determinism, both resource forms, and the six architectural rules above.

```
npm test
```
