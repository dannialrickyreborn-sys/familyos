# WhatsApp Inbound

**Status:** Active in code; the live round trip needs confirming on a device — see [What is verified](#what-is-verified).

Connects the WhatsApp transport to the capability runtime, so a message from a registered family member is answered automatically. No architecture changed: this is the adapter that feeds the existing chain.

## Where it sits

```
WhatsApp        messages.upsert
    |
    |           normalize + filter   (src/whatsappInbound.js)
    v
Identity        Family Registry — who is speaking
    |
Router          known sender? is this a command?   (src/messageRouter.js)
    |
Runtime         resolve -> permissions -> execute  (src/capabilities/runtime.js)
    |
Capability      /help  /status  /family  /ping
    |
    v
WhatsApp        reply, only if the runtime produced one
```

`src/messageRouter.js` and everything under `src/capabilities/` are **unchanged** by this work. The inbound path calls the same `routeMessage` the CLI does, so both entry points behave identically.

## Running it

```
npm run listen
```

```
FamilyOS listener — 2 active member(s) registered.
Press Ctrl+C to stop.

[listen] connected as +6281234567890 — waiting for messages
[inbound] replied to parent-1 with /ping
[inbound] ignored (no_reply, from parent-1)
[inbound] rejected +6289999999999 (not a family member)
```

Requires a linked session (`npm run whatsapp:link`); it refuses to start otherwise, and says which state it found. Unlike the other commands this one is long-running — it stays up until `Ctrl+C`.

The family registry is loaded **per event**, so adding a member or setting `active: false` takes effect without restarting the listener.

## Normalizing a message

Baileys delivers a batch on `messages.upsert`. Text is taken from `conversation` or `extendedTextMessage.text`, and ephemeral ("disappearing") and view-once wrappers are unwrapped first, since those carry the real message inside.

## What is ignored

| Ignored | Why |
|---|---|
| `type !== 'notify'` | `append` is history being synced on reconnect. Acting on it would replay old commands every time the listener reconnects. |
| `key.fromMe` **in the outbox** | a message FamilyOS itself sent, recognised by its recorded id |
| `key.fromMe` **in another member's chat** | the owner talking to a person, or a FamilyOS reminder addressed to them — never a command |
| self-originated commands **over budget** | a bounded cap that makes a runaway impossible by construction |
| `@g.us` | group chats — out of scope for now |
| `status@broadcast`, `@broadcast`, `@newsletter` | status updates and channels |
| no extractable text | images, audio, stickers, reactions, protocol messages |
| no `remoteJid` | malformed event |

`fromMe` is **not** a filter on its own. FamilyOS runs as a linked device on the owner's personal account, so the owner's own commands arrive marked `fromMe` exactly like FamilyOS's replies do. A self-sent message in the owner's **own chat** is an owner command and is executed; identity comes from the account's JID, because for a `fromMe` message `remoteJid` names the recipient. See [ADR-002](../architecture/ADR-002-one-number-executive-interface.md).

Two more filters come from layers that already existed: an **unknown or deactivated sender** is rejected by the router before the text is parsed and is never replied to, and a **known member's ordinary chatter** produces no reply because the runtime returns none.

A reply is sent only when the runtime produced one. Everything else is logged and dropped.

## Reconnecting

The listener supervises its own connection. On a drop it reports the reason in plain language and reconnects with exponential backoff (2s, doubling, capped at 60s), resetting the delay after a successful connect. Two outcomes are fatal instead of retried, because reconnecting cannot fix them: a session that was unlinked from the phone (`expired`) and a refused pairing (`rejected`). Both need `npm run whatsapp:link`.

## What is verified

The whole inbound chain is exercised in tests against a stand-in socket — an object with `ev.on` and `sendMessage` — so normalization, every filter, identity resolution, routing, runtime execution, and the send decision all run for real without a network:

- a registered member's `/ping` produces a reply addressed to their chat
- an alias reaches the same capability
- nothing is sent for own messages, groups, broadcasts, channels, unsupported types, unknown senders, deactivated members, or ordinary chatter
- a batch is handled message by message, in order
- a send failure is logged and does not stop later replies
- a broken registry is reported and does not kill the listener
- an owner command typed on the linked account executes, and the reply returns to that chat
- FamilyOS's own reply, fed back with its real id, produces no second reply
- a reminder FamilyOS sent — to another member, or to the owner — is not re-executed
- with id tracking deliberately broken and every reply looking like a command, 50 self-sent messages produce exactly 5 replies: a loop is bounded by construction

The listener process itself was run: it starts, refuses to start without a session, stays alive, reports a failed connection in plain language, backs off, and shuts down cleanly on `Ctrl+C`/`SIGTERM`.

**Not verified:** an actual message from a real phone. The development sandbox blocks WebSocket connections entirely, so the socket never opens here (see [ADR-001](../architecture/ADR-001-whatsapp-transport.md)). Confirming the definition of done — a real member messaging `/ping` and getting `pong` back — has to happen on a device.

## Known limitations

- **Group chats are ignored.** Answering in a group needs a decision about who may command FamilyOS there.
- **Text only.** No media, captions, reactions, or edits.
- **No rate limiting.** A member can trigger commands as fast as they can send them.
- **One listener at a time.** A second connection with the same credentials takes over and disconnects the first (status 440).
- **Not a background service.** `npm run listen` runs in the foreground; keeping it up across reboots is left to whatever supervises it on the device.
- **No delivery receipts or typing indicators.** Replies are sent plainly, and messages are not marked read.
