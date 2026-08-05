# Changelog

All notable changes to FamilyOS are documented here.

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
