# ADR-002: One-Number Executive Interface

**Status:** Accepted
**Date:** 2026-08-05
**Supersedes:** the `fromMe` filter introduced with WhatsApp Inbound (CAP-006)

> Numbering note: this was requested as "ADR-001", but that number is already taken by the WhatsApp transport decision. Using ADR-002 avoids two documents sharing an id.

## Context

FamilyOS is not a public WhatsApp bot. It is an executive operating system for one family, and the owner's **personal WhatsApp account is the primary interface**:

```
Owner
  ↓  types on their own daily number
Personal WhatsApp account  ←── FamilyOS runs as a linked device on this account
  ↓
FamilyOS  →  Notion, memory, scheduler, notifications
  ↓
Owner + family members
```

The requirement is one number for everything: ordinary chatting, commanding FamilyOS, receiving reminders, receiving replies. No second number, no bot account, no extra device.

## The problem

WhatsApp's multi-device protocol mirrors **every** message sent by the account to all of its linked devices, marked `key.fromMe = true`. That includes:

- messages the owner types on their phone — the commands FamilyOS must act on;
- messages FamilyOS itself sends — which it must never act on.

CAP-006 shipped this filter:

```js
if (key.fromMe) return { ok: false, ignored: IGNORED.FROM_ME };
```

It prevented reply loops, and it was the only guard available at the time. But it also makes the product impossible: the owner cannot command FamilyOS from the account FamilyOS is linked to. `fromMe` does not distinguish *who authored* the message — only that the account did — so it cannot decide anything on its own.

## Decision

Remove the `fromMe` filter. Replace it with **three independent guards**, each covering a distinct loop vector, so no single failure re-opens a loop.

### Guard 1 — Outbox: the id of everything FamilyOS sends

`sock.sendMessage()` returns the sent message, including `key.id`. Every id FamilyOS sends is recorded. An inbound `fromMe` message whose id is in the outbox is FamilyOS's own → ignored.

This is authoritative: the id is assigned by the protocol, not inferred from content.

The outbox is **persisted** to `.familyos/outbox.json` (capped, atomically written). That is not incidental: the listener and the notification path use different sockets, often in different processes. A reminder sent to the owner lands in the owner's own chat and comes back to the listener, so the record has to be shared rather than per-connection.

### Guard 2 — The owner's own chat is the command surface

A self-sent message is treated as a command **only when the chat is the account's own** (Note to Self). A self-sent message in anyone else's chat is ignored.

Two things follow, both desirable:

- FamilyOS reminders and notifications go to *other* members' chats, so they are ignored structurally — even if the outbox missed the id.
- The owner's ordinary conversations are never scanned for commands, so FamilyOS can never inject a reply into a conversation with another person.

Identity is resolved from the **account's own JID**, not `remoteJid`: for a `fromMe` message `remoteJid` names the *recipient*, so it cannot identify the author. Device suffixes (`…:12@s.whatsapp.net`) are compared by phone number, not string equality.

If the account's own JID is unknown, self-sent messages are all ignored. Failing closed means a missed command, never a loop.

### Guard 3 — A bounded budget for self-originated commands

A cap on how many self-originated commands are acted on per chat per window (20 per 60s by default — far above human typing speed).

Guards 1 and 2 should already make a loop impossible. This one makes it impossible *by construction*: a runaway can produce at most `max` messages before it stops, whatever went wrong above it.

### What did not change

History sync (`type: 'append'`), group chats, status broadcasts, channels, unsupported message types, and the unknown-sender policy are all untouched. They apply to self-sent messages too.

## Why not the alternatives

| Option | Why not |
|---|---|
| Keep `fromMe` filtering | Makes the product impossible: the owner cannot use their own number. |
| A marker or signature in outgoing text | Fragile. Text can be copied, quoted, or edited; markers leak into what the family reads. Explicitly rejected. |
| Only treat `/`-prefixed self messages as commands | Breaks the vision. The intended commands are natural language — "ingatkan mamah beli obat besok jam 8", "brief pagi" — with no prefix. It is also not a real guard: a reply could begin with `/`. |
| A second WhatsApp number or bot account | Rejected by the product requirement. |

## Technical constraints worth knowing

- **`sendMessage` may return `undefined`.** The outbox tolerates a missing id; guards 2 and 3 still apply, which is why recording is best-effort rather than load-bearing alone.
- **The outbox is capped**, so an id sent long ago can be evicted. Only recent traffic can loop, so a bounded window is sufficient.
- **A restart empties in-memory state.** The outbox file survives; history sync is ignored anyway, so a replay after restart cannot execute old commands.
- **No protocol flag distinguishes "typed by a human" from "sent by an API client"** on the same account. That is precisely why identity has to come from the outbox and the chat, not from the message itself.
- **This is unverified against a live account.** The development sandbox blocks WebSocket connections entirely, so the assumption that a Note-to-Self message arrives with `remoteJid` equal to the account's own JID is reasoned from the protocol, not observed. It is the one thing to confirm on a device first.

## Maintenance rules

1. **Never reintroduce `if (fromMe) ignore`.** It reads like a safety measure and silently removes the product's primary interface.
2. **Every path that sends a WhatsApp message must record its id in the outbox.** A new sending path that skips this weakens guard 1 — guard 2 will usually cover it, but do not rely on that.
3. **Do not widen the command surface beyond the owner's own chat** without deciding what happens when FamilyOS replies inside a conversation with another person.
4. **Do not remove the loop guard** because "the outbox handles it". It exists for the case where the outbox does not.
5. **Keep the guards independent.** Their value is that they fail differently.

## Consequences

One number now serves daily chatting, commanding FamilyOS, receiving reminders, notifications, and replies. The owner's own chat becomes a private console on their existing account.

The cost is more moving parts than a one-line filter, and a persisted file that must be kept in step with every send path. That is the price of the product being possible at all.
