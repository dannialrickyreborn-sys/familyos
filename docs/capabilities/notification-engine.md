# Notification Engine (CAP-008)

**Status:** Active.

Lets any capability send a message to a family member by **id**, without knowing how the message travels or what the member's phone number is.

## Where it sits

```
Capability            notify('parent-1', 'dinner is ready')
    |
Notification Engine   resolve member -> decide sent / skipped / failed
    |                 (src/notifications/engine.js)
Channel Router        which channel carries it
    |                 (src/notifications/channelRouter.js)
WhatsApp Transport    the only layer that sees a phone number
                      (src/transports/whatsapp.js)
```

Two boundaries are enforced by tests rather than convention:

- **The engine never imports a transport.** Its only requires are `../familyRegistry` and `./channelRouter`, and a test asserts exactly that list. Requiring the engine loads zero Baileys modules, because the channel router builds its channels lazily.
- **Only the channel adapter depends on a transport.** A test walks `src/notifications/` and fails if any file outside `channels/` imports one.

## API

```js
const { notify, notifyMany, notifyAll } = require('./notifications/engine');

await notify('parent-1', 'dinner is ready');
await notifyMany(['parent-1', 'parent-2'], 'school run at 07:00');
await notifyAll('power is out');
```

All three resolve rather than throw for ordinary outcomes, so a caller can always inspect what happened.

### `notify(memberId, message, options?)`

```js
{ ok, skipped, memberId, channel, reason, detail }
```

| Outcome | `ok` | `skipped` | `reason` |
|---|---|---|---|
| delivered | `true` | `false` | `null` |
| member is inactive (default) | `true` | `true` | `inactive_member` |
| member is inactive (strict) | `false` | `false` | `inactive_member` |
| no such member id | `false` | `false` | `unknown_member` |
| no channel available | `false` | `false` | `no_channel` |
| the channel threw | `false` | `false` | `send_failed` |
| message empty or not a string | `false` | `false` | `empty_message` |

`detail` is a sentence for humans; `reason` is for code.

### `notifyMany(memberIds, message, options?)` and `notifyAll(message, options?)`

```js
{ ok, sent, skipped, failed, results }
```

`results` holds one `notify` result per recipient, **in the order requested**. `ok` is true only when nothing failed. One recipient failing never stops the rest — delivery is attempted for every id.

Recipients are processed one at a time. That keeps results ordered and avoids hammering a transport that is talking to a personal WhatsApp account.

`notifyAll` addresses **only active members**. Inactive members are not addressed at all, so they are absent from `results` rather than reported as skipped.

### Options

| Option | Meaning |
|---|---|
| `strict` | an inactive member becomes a failure instead of a quiet skip |
| `family` | inject a loaded registry instead of reading `configs/family.json` |
| `router` | inject a channel router — how tests avoid the real transport |

An unknown id is a failure regardless of `strict`: a typo in a member id is a bug, whereas someone being deactivated is a normal state.

## Recipients come only from the Family Registry

The engine takes ids and resolves them with `findById` / `activeMembers`. There is no way to address a raw number through it, and no capability needs one.

Phone numbers stay inside the transport: the channel adapter forwards the **member record** to `sendToMember(member, text)`, and the transport reads `member.phone` itself. A test walks `src/notifications/` and `src/capabilities/` and fails on any use of `.phone`, `normalizePhone`, or `phoneFromJid`.

That test found a real leak when it was written: `/status` was printing the linked number into a chat reply. Chat replies can be forwarded or screenshotted, so `/status` now reports `linked` without the number — the same reasoning that already applied to `/family`. Local terminal diagnostics (`doctor`, `whatsapp:status`, `familyos family`) still show numbers, deliberately, for whoever is at the terminal.

## Channels

The channel router holds channels by name and picks one per member. Today only WhatsApp is registered, and every member is reached the same way.

Adding a second channel:

1. Write a module exporting `{ name, send(member, message) }`.
2. Register it in `defaultChannelRouter()`.

Nothing in the engine or in any capability changes. Per-member routing already works — `resolve()` reads `member.channel` and falls back to the default — but the family registry does not yet carry a `channel` field, and it will not be added until there is a second channel to choose between.

The router validates registrations: a channel needs a non-empty `name` and a `send` function, and a name cannot be registered twice.

## Using it from a capability

```js
const { notify } = require('../notifications/engine');

register({
  id: 'remind',
  command: 'remind',
  aliases: [],
  description: 'remind someone',
  permissions: ['admin'],
  execute: async ({ args }) => {
    const result = await notify(args[0], args.slice(1).join(' '));
    return result.ok ? 'Sent.' : `Could not send: ${result.detail}`;
  },
});
```

No WhatsApp import, no phone number. That is the definition of done.

Note the runtime executes capabilities synchronously today, so a capability that awaits a notification would need the runtime to await `execute` — see the Capability Runtime's known limitations. Nothing shipped needs it yet.

## Command line

```
familyos notify --to parent-1 "dinner is ready"
familyos notify --to parent-1,parent-2 "school run at 07:00"
familyos notify --all "power is out"
familyos notify --to child-1 --strict "hello"
```

Exit code is `0` when nothing failed, `1` otherwise. This exists so the engine can be exercised on a device; capabilities call the engine directly.

## Known limitations

- **One channel.** WhatsApp only, so a member unreachable there is unreachable.
- **No retries.** A `send_failed` is reported, not retried. The caller decides.
- **No queue or scheduling.** Delivery is attempted immediately and in process; nothing survives a crash mid-broadcast.
- **Sequential.** A large broadcast takes as long as the sum of its sends, and each send opens its own connection.
- **No delivery confirmation.** Success means the transport accepted the message, not that it was read.
- **No per-member channel preference** until a second channel exists.

## Tests

`tests/notificationEngine.test.js` covers single recipient, multiple recipients, broadcast, inactive member (both modes), unknown member (both modes), transport failure, missing channel, partial failure, a mixed summary of sent/skipped/failed, empty message, empty recipient list, a registry with no active members, channel-router validation and multi-channel resolution, and the two architectural boundaries plus the phone-number rule.

```
npm test
```
