# ADR-001: WhatsApp Transport Without Meta Cloud API

**Status:** Accepted
**Date:** 2026-08-04

## Context

FamilyOS's executive interface is WhatsApp, using the user's personal WhatsApp account — not a Meta Business account. FamilyOS must stay fully self-hosted and free: no Meta Cloud API, no paid third-party WhatsApp providers.

## Options Evaluated

### 1. `whatsapp-web.js` (Puppeteer-based)
Automates the real WhatsApp Web page in a headless Chromium browser via Puppeteer.

- **Pros:** Mature, huge community, closely mirrors the official web client's behavior.
- **Cons:** Requires a full Chromium install (~300–500 MB RAM per session). Puppeteer does not officially support Android as a platform — installing it under Termux fails with "Unsupported platform: android." This directly fails the Termux-compatibility requirement.

### 2. `whatsmeow` (Go) / GOWA wrapper
A mature Go library implementing the WhatsApp multi-device protocol directly over WebSocket, no browser. GOWA wraps it as a REST API.

- **Pros:** Very low resource usage, native binary, no separate runtime once compiled, considered highly stable (used in production bridges like mautrix-whatsapp).
- **Cons:** Go is a second language/runtime alongside the existing Node.js `familyos` CLI. Running it means either compiling and managing a separate Go binary/process (via GOWA) or rewriting parts of FamilyOS in Go — both add operational surface (a second process to start, monitor, and keep alive) that the existing Node-only CLI doesn't need. Conflicts with "maintainable" and "no unnecessary complexity" for a single-maintainer repo.

### 3. Baileys (`@whiskeysockets/baileys`)
A TypeScript/JavaScript library that speaks WhatsApp Web's native WebSocket + protobuf protocol directly — no browser, no second runtime.

- **Pros:** Pure Node.js, matches the existing `familyos` CLI's language. No headless browser: roughly 50 MB RAM and sub-second startup. Actively maintained by WhiskeySockets; 575+ dependent npm packages; large community. For plain-text messages (all FamilyOS needs for a brief), it has no native/compiled dependencies — image processing libs (`sharp`/`jimp`) are optional peer dependencies, not required.
- **Cons:** Reverse-engineered protocol like the others — WhatsApp protocol changes can break it until maintainers patch. Automating a personal account this way technically violates WhatsApp's Terms of Service; there is real, unpredictable account-ban risk (WhatsApp's anti-abuse systems weigh low reply ratios, messaging strangers, and robotic timing — a personal, low-volume, "message yourself" brief is low-risk relative to bot use, but not zero-risk).
- **Version note:** The npm `latest` tag currently points at a `7.0.0` release candidate that bundles a new Rust/WASM bridge (`whatsapp-rust-bridge`) — an added native/WASM component and still pre-release. The `6.7.x` line (currently `6.7.23`) is the stable, pure-JS line with no Rust bridge. This decision pins to `6.7.23` specifically to avoid both the RC instability and the added WASM dependency.

## Chosen Approach

**Baileys, pinned to `@whiskeysockets/baileys@6.7.23`.**

It is the only option that is simultaneously free, self-hosted, pure Node.js (no second runtime), free of native/compiled dependencies for text messaging, mature (not experimental), and realistically able to run under Termux's resource constraints.

## Rejected Approaches

- **`whatsapp-web.js`** — rejected outright: confirmed unsupported on Android/Termux due to Puppeteer's platform restrictions.
- **Meta WhatsApp Cloud API** — rejected per this task's explicit constraint (not self-hosted, requires a Meta Business account).
- **whatsmeow / GOWA** — rejected for this repository specifically: technically excellent, but introduces a second language runtime and a separate long-running service, which is more operational surface than a single-maintainer, Node-only CLI needs right now. Worth reconsidering only if Baileys becomes unmaintained or Node-side resource use proves too heavy in practice.

## Risks

- **Protocol breakage:** WhatsApp can change its protocol at any time; Baileys' maintainers then need to patch it, and FamilyOS would be down until that happens and the dependency is updated. No self-hosted alternative avoids this risk — it applies to whatsmeow too.
- **Account ban risk:** Using a personal account for automated sending is against WhatsApp's Terms of Service. Risk is reduced (not eliminated) by low message volume and sending only to oneself, but the user should understand this is their personal number, not a disposable one.
- **Pairing requires a human:** Linking a Baileys session to a real WhatsApp account requires scanning a QR code with that account's phone — this cannot be done autonomously and is not something this session can complete on the user's behalf.

## Development-Environment Note (not a Termux/production limitation)

This code was authored in Claude Code Cloud, a remote development sandbox whose outbound network is restricted to an HTTP(S) egress proxy that does not support WebSocket upgrades at all. `familyos whatsapp:link` was run there and hung indefinitely — no QR, no error — because the WebSocket to WhatsApp's servers never connects or fails, it just stalls. That restriction is specific to that authoring sandbox; it does not apply to Termux, or to any device with ordinary internet access, and it is not a Baileys defect. It's recorded here only so a future reader doesn't mistake "couldn't verify a live connection during development" for "doesn't work."
