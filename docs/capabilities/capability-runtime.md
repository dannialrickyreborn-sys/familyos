# Capability Runtime

**Status:** Active.

The layer that turns a parsed command into a reply. It replaced a static `switch` dispatch, so capabilities are now pluggable: adding one means adding a file, not editing the router.

## Where it sits

```
Transport      WhatsApp (send-only today)
    |
Identity       Family Registry — who is speaking
    |
Router         known sender? is this a command at all?
    |
Runtime        resolve -> check permissions -> execute
    |
Capabilities   help  status  family  ping  ...
```

The router establishes identity and decides whether the text is a command. It knows nothing about *which* commands exist — that is entirely the runtime's business. A test asserts the router source contains no command names, so the boundary cannot quietly erode.

## Three registries, different jobs

The word "registry" appears three times in this project. They are unrelated:

| Name | What it holds |
|---|---|
| Family Registry (`configs/family.json`) | who the family is |
| **Capability registry** (`src/capabilities/registry.js`) | command words → executable behaviour |
| `docs/capabilities/CAPABILITY-REGISTRY.md` | the written record of capabilities |

This document describes the middle one.

## A capability

Each capability is one module in `src/capabilities/` that registers itself when loaded:

```js
const { register } = require('./registry');

register({
  id: 'ping',
  command: 'ping',
  aliases: [],
  description: 'check that FamilyOS is responding',
  permissions: [],
  execute: ({ member }) => `pong — hello ${member.name}.`,
});
```

| Field | Meaning |
|---|---|
| `id` | unique, stable handle |
| `command` | the primary word, without the leading `/` |
| `aliases` | alternative words; `[]` for none |
| `description` | one line, shown by `/help` |
| `permissions` | roles allowed to run it; `[]` means any active member |
| `execute` | `({ member, family, capabilities, args }) => string` |

`execute` receives:

- `member` — the resolved family member who sent the message
- `family` — the loaded family registry
- `capabilities` — the capability registry, so `/help` can list what exists
- `args` — the words after the command

Registration is validated and fails loudly: missing or empty fields, a non-function `execute`, non-array `aliases`/`permissions`, an unknown role, a malformed command word, a duplicate `id`, or a command word already claimed by another capability. Commands and aliases share one namespace, so an alias cannot shadow another capability's command.

## Discovery

`src/capabilities/index.js` reads its own directory and requires every `.js` file except the runtime's own (`index.js`, `registry.js`, `runtime.js`). Each module registers itself on require. There is no dispatch table and no list of capabilities to maintain — the directory *is* the list.

## Execution

`execute(command, { member, family })` resolves, checks, runs, and returns:

```js
{ ok, reason, capability, reply }
```

| Outcome | `ok` | `reason` | `reply` |
|---|---|---|---|
| ran | `true` | `null` | the capability's output |
| no such command | `false` | `unknown_command` | nudge toward `/help` |
| role not permitted | `false` | `forbidden` | says which roles may run it |
| capability threw | `false` | `failed` | names the failure |

Ordinary outcomes never throw. A capability that throws is contained and reported, so one broken capability cannot take the runtime — or the reply — down with it. A refused capability's `execute` is never called.

## Permissions

`permissions: []` means any active member. Otherwise the member's role must be listed. Roles come from the family registry (`admin`, `member`), so there is one definition of what a role is.

All four current capabilities are open (`[]`), matching their behaviour before the refactor. Restricting one is now a one-word change:

```js
permissions: ['admin'],
```

## Adding a capability

1. Create `src/capabilities/<name>.js` and call `register({ ... })`.
2. Run `npm test`.

That is all. The command, its aliases, its permission check, and its line in `/help` all work immediately. No router change, no runtime change, no registration list.

Verified by creating a capability with an alias and `permissions: ['admin']`: the command and alias both answered, a `member`-role sender was refused, and it appeared in `/help` — with no other file touched.

## Migrated capabilities

| Command | Aliases | Permissions | Notes |
|---|---|---|---|
| `/help` | `commands` | any | generated from the registry, so new capabilities appear automatically |
| `/status` | `health` | any | reads the stored session only; never opens a connection |
| `/family` | `members` | any | omits phone numbers — a chat reply can be forwarded |
| `/ping` | — | any | answers the member by name |

Replies are unchanged from before the refactor; the existing routing tests passed without modification.

## Known limitations

- **No inbound WhatsApp delivery.** The transport is send-only; commands are reachable through `familyos message --from <phone|jid> "<text>"`. Wiring a listener is a transport change.
- **Permissions are role-based only.** No per-member grants, and no per-capability rate limiting.
- **Loaded once per process.** Discovery is cached, so a capability added while a long-running process is up is not picked up until restart. Irrelevant to the CLI, which is short-lived.
- **`args` are passed through unvalidated.** Capabilities that take arguments must validate their own.
- **Synchronous `execute`.** Capabilities that need I/O would require the runtime to await; not needed by any current capability.

## Tests

`tests/capabilityRuntime.test.js` covers discovery (including that the module count matches the file count, so discovery really is directory-driven), alias resolution and case-insensitivity, permission validation in both directions plus that a refused capability never runs, unknown commands, containment of a throwing capability, every registration-validation rule, and that the router dispatches a capability it has never heard of.

```
npm test
```
