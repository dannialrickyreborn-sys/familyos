# Message Router

**Status:** Active — routing and commands are complete and tested. Inbound WhatsApp delivery is **not yet wired**; see [Current wiring](#current-wiring).

Decides what happens to an incoming message: who sent it, whether they are allowed, and which command should answer.

## Flow

```
inbound message { from, text }
        |
        v
resolve sender  ---------------------------> unknown_sender
  (Family Registry, active members only)     no reply, on purpose
        |
     known member
        |
        v
parse command  --------------------------->  not_a_command
  (text must start with "/")                 no reply
        |
      command
        v
command engine  -------------------------->  handled
  /help /status /family /ping                reply text
```

The router is pure: it reads the registry and the stored session, and returns a decision. It never sends anything. Whatever drives it decides what to do with the reply.

## Outcomes

`routeMessage({ from, text }, registry)` returns `{ result, member, reply, phone }` where `result` is one of:

| Result | Meaning | Reply |
|---|---|---|
| `unknown_sender` | not an active family member | `null` — never answered |
| `not_a_command` | a known member sent ordinary text | `null` |
| `handled` | a command ran | reply text |

### Why unknown senders get no reply

Silence is deliberate, for two reasons:

1. Replying confirms the number is live and running automation to anyone probing it.
2. Unsolicited replies to strangers are exactly the behaviour WhatsApp's anti-abuse systems weigh when banning accounts (see [ADR-001](../architecture/ADR-001-whatsapp-transport.md)).

Rejection happens **before** the text is parsed, so a stranger sending a valid command never reaches the command engine at all.

## Sender resolution

`from` accepts either form, so the router can be driven by the transport or by the CLI:

- a WhatsApp JID — `6281234567890@s.whatsapp.net`, including the device-suffixed form `6281234567890:12@s.whatsapp.net`
- a plain phone number in any format the registry accepts

Both are reduced to E.164 digits and matched against active members. A missing, malformed, or unmatched sender is `unknown_sender`.

## Commands

Commands are not the router's concern: it hands the parsed command to the [Capability Runtime](capability-runtime.md), which resolves it, checks permissions, and runs it. The router source contains no command names, and a test enforces that.

Command words are case-insensitive; extra arguments and whitespace are tolerated; aliases resolve to the same capability; an unknown command gets a nudge toward `/help` rather than silence.

| Command | Aliases | Reply |
|---|---|---|
| `/help` | `commands` | the list of commands |
| `/status` | `health` | WhatsApp link state, last login, transport version |
| `/family` | `members` | active family members — names, ids and roles |
| `/ping` | — | `pong — hello <name>.` |

Two properties worth noting:

- **`/status` never opens a connection.** It reads the stored session only, so a reply is never blocked on the network.
- **`/family` never includes phone numbers.** A chat reply may be forwarded or screenshotted; the local `npm run family` view is where numbers belong.

## Current wiring

The WhatsApp transport is send-only — it does not listen for incoming messages, and adding that means changing the transport, which was out of scope for this sprint. So the router is complete but not yet fed by WhatsApp.

It is driven today by the CLI, which runs a message through exactly the same path an inbound message would take:

```
familyos message --from <phone-or-jid> "<text>"
```

```
$ familyos message --from "6281234567890@s.whatsapp.net" "/ping"
HANDLED /ping for First Parent (parent-1)

--- reply ---
pong — hello First Parent.

$ familyos message --from "6289999999999@s.whatsapp.net" "/ping"
REJECTED — +6289999999999 is not an active family member. No reply sent.
```

Exit code is `0` for handled and ignored messages, `1` for a rejected sender.

To connect this to live WhatsApp later, a `messages.upsert` listener in the transport needs to call `routeMessage` and send `reply` back when it is not `null`. No change to the router or the engine is required.

## Known limitations

- **No inbound delivery yet** — the above. Commands are reachable via the CLI only.
- **No roles enforced** — every active member can run every command.
- **No rate limiting** — nothing throttles how often a member can trigger commands.
- **Text only** — media, reactions, and group messages are not considered.
- **Stateless** — each message is handled on its own; there is no conversation context.

## Tests

`tests/messageRouting.test.js` covers sender resolution (JID, device-suffixed JID, plain number), rejection of strangers, deactivated members and malformed senders, rejection happening before dispatch, ordinary text being ignored, and every command's output — including that `/family` leaks no phone number.

`tests/cli.integration.test.js` runs the real CLI in a throwaway working directory against a registry on disk, covering the same paths end to end plus missing and invalid registries.

```
npm test
```
