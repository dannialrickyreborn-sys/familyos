# Changelog

All notable changes to FamilyOS are documented here.

## Unreleased — Notification Engine (CAP-008)

A transport-independent way for any capability to message a family member by id.

- **Engine** (`src/notifications/engine.js`) — `notify(memberId, message)`, `notifyMany(memberIds, message)`, `notifyAll(message)`. Recipients are resolved only through the Family Registry. Ordinary outcomes are returned, not thrown: `unknown_member`, `inactive_member`, `no_channel`, `send_failed`, `empty_message`. An inactive member is skipped quietly unless `{ strict: true }`; an unknown id always fails. `notifyMany` continues past a failure and returns one result per recipient in the order requested, plus a `sent`/`skipped`/`failed` summary. `notifyAll` addresses only active members.
- **Channel router** (`src/notifications/channelRouter.js`) — holds channels by name, validates registrations, and resolves per member (`member.channel`, falling back to the default). WhatsApp is the only channel today; adding another is a module plus one registration, with no change to the engine or any capability.
- **Boundaries enforced by tests, not convention** — the engine's requires are asserted to be exactly `../familyRegistry` and `./channelRouter`; a test walks `src/notifications/` and fails if any file outside `channels/` imports a transport; another fails on any use of `.phone`, `normalizePhone`, or `phoneFromJid` in `src/notifications/` or `src/capabilities/`. Requiring the engine loads zero Baileys modules, because channels are built lazily.
- **Transport** — added `sendToMember(member, text)`; the recipient's number is read inside the transport, so the layers above pass member records instead. The existing `send(text, config)` now delegates to the same internal path rather than duplicating it.
- **`familyos notify`** (`--to <id[,id]>` / `--all`, `--strict`) — exercises the engine on a device; capabilities call it directly.
- **Fixed a real leak found by the new test:** `/status` was printing the linked phone number into a chat reply. Chat replies can be forwarded, so it now reports `linked` without the number — the reasoning already applied to `/family`. Local diagnostics still show numbers deliberately.
- **Tests** — 20 new (94 total). **Documentation** — `docs/capabilities/notification-engine.md`, registry entry CAP-008, and a new "Application layers" section in `docs/ARCHITECTURE.md` covering both the inbound and outbound stacks.

## Unreleased — WhatsApp Inbound

Connects the WhatsApp transport to the capability runtime. `src/messageRouter.js` and everything under `src/capabilities/` are unchanged: this is the adapter that feeds the existing chain, so the CLI and WhatsApp behave identically.

- **Inbound adapter** (`src/whatsappInbound.js`) — normalizes a `messages.upsert` batch, applies the ignore rules, resolves identity through the router, runs the runtime, and decides what to send. Pure and testable: `attachInbound` only needs a socket with `ev.on` and `sendMessage`.
- **Listener** (`familyos listen`, `npm run listen`) — long-running command that answers registered members. Refuses to start without a linked session. Supervises its own connection: reports a drop in plain language and reconnects with exponential backoff (2s doubling, capped at 60s), treating an unlinked session or a refused pairing as fatal rather than retrying forever. Shuts down cleanly on `Ctrl+C`/`SIGTERM`. Loads the family registry per event, so member changes apply without a restart.
- **Ignored**: history sync (`type: 'append'`, which would otherwise replay old commands on every reconnect), the device's own messages (which would loop), group chats, status broadcasts and channels, unsupported message types, and malformed events. Unknown or deactivated senders are rejected by the router and never answered; a member's ordinary chatter produces no reply. A reply is sent only when the runtime returned one.
- **Text extraction** handles `conversation` and `extendedTextMessage`, unwrapping ephemeral and view-once messages.
- **Tests** — 23 new (74 total): normalization and every filter, the full chain end to end against a stand-in socket, batch ordering, a send failure not stopping later replies, a broken registry not killing the listener, and feeding a reply back with `fromMe` producing no loop.
- **Documentation** — `docs/capabilities/whatsapp-inbound.md`; registry entry CAP-006.

The live round trip from a real phone is not verified: the development sandbox blocks WebSocket connections, so the socket never opens there. The listener process itself was run and behaves correctly; confirming a real `/ping` → `pong` needs a device.

## Unreleased — Capability Runtime

Replaces the static command dispatch with a pluggable capability runtime. Behaviour is unchanged: all 31 existing tests passed without modification.

- **Capability registry** (`src/capabilities/registry.js`) — capabilities self-register with `id`, `command`, `aliases`, `description`, `permissions`, `execute()`. Registration is validated and fails loudly on missing fields, a non-function `execute`, an unknown role, a malformed command word, a duplicate id, or a word already claimed by another capability. Commands and aliases share one namespace, so an alias cannot shadow another capability's command.
- **Discovery** (`src/capabilities/index.js`) — reads its own directory and requires every module except the runtime's own files. The directory is the list; there is no dispatch table to maintain.
- **Runtime** (`src/capabilities/runtime.js`) — resolves a parsed command, validates permissions, executes, and returns `{ ok, reason, capability, reply }`. Ordinary outcomes never throw: unknown commands, permission refusals, and a capability that throws are all returned as responses, so one broken capability cannot take the runtime down. A refused capability's `execute` is never called.
- **Migrated** `/help`, `/status`, `/family`, `/ping` into independent modules, and removed `src/commandEngine.js`. Each gained an alias (`commands`, `health`, `members`). `/help` is now generated from the registry, so a new capability appears in it automatically.
- **Router** (`src/messageRouter.js`) — now only establishes identity, decides whether the text is a command, and invokes the runtime. It contains no command names, and a test enforces that.
- **Tests** — 20 new tests (51 total): discovery, alias resolution and case-insensitivity, permission validation in both directions, unknown capability, containment of a throwing capability, every registration rule, and the router dispatching a capability it has never heard of.
- **Documentation** — `docs/capabilities/capability-runtime.md`; registry entry CAP-005.

Definition of done, verified by doing it: a new capability with an alias and `permissions: ['admin']` was added as a single file — the command and its alias answered, a `member`-role sender was refused, and it appeared in `/help`, with no other file touched.

## Unreleased — Family Registry & Message Routing Foundation

First application layer above the WhatsApp transport. The transport itself is unchanged.

- **Family Registry** (`src/familyRegistry.js`, `configs/family.json`) — the single source of truth for family members: unique id, name, phone, role, active flag. Phones are normalized to E.164 on load, so the same number written differently resolves to one person. Validation is strict and names the offending member and field; duplicate ids and duplicate numbers are rejected. The real registry is gitignored; `configs/family.example.json` is the tracked template. `familyos family` lists it.
- **Message Router** (`src/messageRouter.js`) — resolves the sender from a WhatsApp JID or a plain number against active members, rejects unknown senders *before* the message text is parsed, and passes known senders to the command engine. Unknown senders are never replied to, deliberately. Returns a decision; it never sends anything.
- **Command Engine** (`src/commandEngine.js`) — `/help`, `/status`, `/family`, `/ping`. Case-insensitive, tolerant of extra arguments, and unknown commands are nudged toward `/help`. `/status` reads the stored session without opening a connection; `/family` never includes phone numbers.
- **Tests** — 31 tests via Node's built-in runner, no new dependency: `npm test`. Covers registry validation and lookup, router outcomes, every command, and an end-to-end pass that runs the real CLI in a throwaway directory against a registry on disk. One test asserts no phone number is hardcoded as data in `src/` or `bin/`.
- **Documentation** — `docs/capabilities/family-registry.md`, `docs/capabilities/message-router.md`; registry entries CAP-003 and CAP-004.
- Inbound WhatsApp delivery is **not** wired: the transport is send-only and connecting a listener would mean modifying it, which was out of scope. `familyos message --from <phone|jid> "<text>"` drives the exact same routing path in the meantime.

## v0.2.0 — WhatsApp Foundation Stable (release tag)

First tagged milestone. The WhatsApp transport is validated end-to-end on a real device: pairing by code succeeds, the session is stored consistently, and `whatsapp:status` reports `Linked: yes` with `Connection status: connected`. The `Unexpected end of JSON input` failure is resolved.

This tag covers everything below it — the CLI (`doctor`, `config`, `brief`, `whatsapp:link`, `whatsapp:status`), the Notion read layer, the transport abstraction, and the WhatsApp transport with atomic session persistence. Capability documentation: `docs/capabilities/whatsapp-foundation.md` (registry entry CAP-002).

Note: the `v0.x.y` headings below were incremental development notes written as the work landed; they do not correspond to release tags. `v0.2.0` is the first actual tag.

## v0.1.0 — Foundation created

- Established the initial repository structure (`.github/`, `docs/`, `automation/`, `scripts/`, `configs/`, `templates/`, `assets/`).
- Added baseline documentation: `README.md`, `CLAUDE.md`, `docs/PROJECT_VISION.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`.
- Defined core principles, development workflow, and the five-milestone roadmap.
- No application code, workflows, or automation included by design.

## v0.2.0 — First working CLI

- Introduced the capability model (`docs/capabilities/`) for proposing, validating, and retiring capabilities instead of accumulating features.
- Shipped a dependency-free `familyos` CLI: `doctor` (environment/Notion health check) and `brief` (reads Tasks, Calendar, Bills, and Documents from Notion and prints an executive brief).
- Added `.env`-based configuration for the Notion token, database IDs, and timezone.

## v0.3.0 — Minimum living system

- Added `familyos config` to show the currently loaded configuration with secrets masked.
- Extracted a dedicated Notion database access layer (`src/databases.js`) so future capabilities reuse it instead of duplicating queries.
- Decoupled brief generation from printing (`buildBrief`) so the same text can later be sent through another transport (e.g. WhatsApp) without rewriting the capability.
- Reconciled documentation with the shipped CLI (`README.md`, `CLAUDE.md`, capability registry).

## v0.4.0 — WhatsApp transport (self-hosted, no Meta Cloud API)

- Added a transport abstraction (`src/transport.js`) with `console` and `whatsapp` implementations; `familyos brief` now sends through whichever is configured.
- Added the WhatsApp transport using [Baileys](https://github.com/WhiskeySockets/Baileys) `6.7.23`, pinned to the stable pure-JS line (see `docs/architecture/ADR-001-whatsapp-transport.md` for the full comparison and decision).
- Added `familyos whatsapp:link` to pair a personal WhatsApp account by scanning a QR code, and a WhatsApp link-status check in `familyos doctor`.
- Verified: doctor, config, and console-transport brief all still work after the refactor. The live WhatsApp connection itself could not be verified during development (Claude Code Cloud's sandbox blocks WebSocket upgrades entirely) — a development-environment restriction, not a Termux or production limitation. See `docs/architecture/ADR-001-whatsapp-transport.md`.

## v0.5.0 — Finalized for Termux

- Confirmed no Claude-Code-Cloud-specific assumptions remain in application code; the only cloud-specific content was documentation, now clearly marked as a development-environment note rather than a Termux/production limitation.
- Expanded `README.md` with explicit Termux setup steps (`pkg install nodejs-lts git`).

## v0.6.3 — Prove the session was stored

- `whatsapp:link` no longer reports success on trust: after pairing it persists explicitly, then verifies `creds.json` exists, is non-empty, parses, and records a completed registration. If any of that fails it reports the reason instead of printing "linked successfully", so a session that cannot be read back can never be mistaken for a working one. The success line now includes the stored size.
- Session writes log the file name and the size measured on disk after the rename (`[session] wrote creds.json (N bytes) via atomic rename`). Key files are logged with `FAMILYOS_DEBUG=1`; `creds.json` is always logged.
- `writeJsonAtomic` refuses to write empty serialized data outright.
- `whatsapp-meta.json` is now written with the same temp-file-plus-rename pattern as the session files.
- Audited every reader and writer of `creds.json`, every `saveCreds` call, and every `process.exit()`: the atomic auth state is the only writer on this branch, and `useMultiFileAuthState` is no longer referenced anywhere in the source.

## v0.6.2 — Fix WhatsApp session being saved empty

- **Root cause.** Baileys' `useMultiFileAuthState` persists with an async `fs.writeFile`, which truncates the target to zero bytes before writing, and `ev.on('creds.update', saveCreds)` never awaits the returned promise. `bin/familyos.js` then calls `process.exit()` once the command resolves, abandoning any write still in flight. Pairing reported success while `creds.json` was left empty, so `whatsapp:status` failed with `Unexpected end of JSON input`. The race has two outcomes, both broken: a zero-byte file, or the previous file surviving with the newly registered credentials silently lost.
- Replaced the bundled auth state with `src/whatsappAuthState.js`, which writes every session file to a temp file, `fsync`s it, then `rename`s it over the target. `rename(2)` is atomic within a filesystem, so a reader only ever sees the old file or the complete new one. The writes are synchronous, so they are durable by the time `saveCreds()` returns and nothing remains in flight for process exit to lose. File naming and `BufferJSON` encoding match Baileys', so existing session folders stay readable.
- Empty or corrupt session files now read as absent instead of throwing, so a damaged session falls back to a fresh registration, and `whatsapp:status` says the file is damaged and how to recover.
- Measured under repeated `SIGKILL` during writes: the bundled implementation left a parseable `creds.json` in 5 of 25 runs, the atomic one in 25 of 25.

## v0.6.1 — Fix WhatsApp linking always failing with 401

- **Root cause.** Baileys chooses its handshake on `creds.me` alone (`Socket/socket.js`: `if (!creds.me) registration else login`), and `requestPairingCode()` writes `creds.me` and emits `creds.update` *before* pairing completes. Any interrupted pairing therefore persisted an identity that was never registered, so every later run sent a **login** for an unregistered device and WhatsApp replied `<failure reason="401">`. The old code read that as "session expired" and, because the state was never cleared, the failure repeated forever.
- `whatsapp:link` now detects this half-paired state (and unreadable credentials) and resets the session before connecting, plus again if an attempt fails — so a retry can no longer inherit a session that can only fail.
- 401 during pairing no longer claims the session expired; it reports that WhatsApp refused the pairing attempt. 401 on an established session still reports expiry.
- `doctor` and `whatsapp:status` now name the incomplete-pairing state explicitly instead of showing a generic "not registered", and `brief --transport whatsapp` points at the fix.
- Hardened the WhatsApp Web version lookup: it now tries live WhatsApp Web's `client_revision` first, then Baileys upstream, and only falls back to the version bundled in the package (the one that triggers failure 405) as a last resort. Previously a single fetch was used, whose fallback was that known-bad bundled version.
- Replaced the `Browsers.ubuntu('FamilyOS')` handshake fingerprint with `Browsers.ubuntu('Chrome')`: the middle element is the *browser* name, so the old value advertised a browser that does not exist.

## v0.6.0 — Production-ready WhatsApp pairing

- Added a second pairing method: `whatsapp:link` now shows a menu offering **QR Code** (default) or **Pairing Code**. The pairing-code flow asks for a phone number, normalizes it to E.164, requests the code from WhatsApp via Baileys' `requestPairingCode`, and displays it as `XXXX-XXXX`.
- The command stays scriptable: `--method qr` / `--method code --phone <number>` skip the menu, and non-interactive runs fail with instructions instead of hanging on a prompt.
- Handles WhatsApp's post-pairing reconnect (status 515) automatically, so linking completes in one command instead of appearing to fail.
- Replaced raw status codes with human-readable errors covering session expired, pairing rejected, no internet, unsupported WhatsApp version, rate limiting, and reconnect required.
- Added `familyos whatsapp:status` (`npm run whatsapp:status`): linked state, phone number, live connection status, last login, and transport version.
- `familyos doctor` now validates the WhatsApp session file, the stored credentials, and live reachability as three separate checks; the network probe is skipped when there is nothing linked, and every connection attempt is bounded by a timeout so no command can hang.
- Session credentials persist in `.familyos/` (gitignored), so pairing is a one-time step.

## v0.5.1 — Fix WhatsApp pairing (405 before QR)

- `npm run whatsapp:link` was failing immediately with "connection closed (status 405)" and no QR, on real devices (Termux, Node 24) with normal internet access. Cause: Baileys `6.7.23` bakes in a fixed WhatsApp Web protocol version at publish time, and WhatsApp's servers now reject that stale version during the handshake, before the QR step. Fixed by calling Baileys' own `fetchLatestBaileysVersion()` and passing the current version into `makeWASocket()`, with the bundled default kept as an automatic fallback if the version fetch itself fails.
