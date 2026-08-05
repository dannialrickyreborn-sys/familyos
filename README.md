# FamilyOS

An AI-assisted operating system for everyday life.

## What is FamilyOS

FamilyOS is a personal system for organizing, automating, and improving daily life for a family — built openly, incrementally, and documented as it grows. It is not a single app. It is a structured collection of documentation, conventions, and (eventually) small tools that work together, built with AI assistance (Claude Code) as a core part of the workflow.

## Vision

To have one clear, well-documented place that governs how daily life, knowledge, personal growth, and future automation are organized — simple enough to maintain alone, structured enough to grow for years.

See [docs/PROJECT_VISION.md](docs/PROJECT_VISION.md) for the full vision.

## Goals

- Establish a clean, maintainable foundation before writing any application code.
- Keep the repository understandable by both humans and AI assistants.
- Grow the system one milestone at a time, in public, with clear documentation.
- Prefer free, mobile-friendly tools so the system can be maintained from anywhere, including Termux.

## Core Principles

- Simplicity over complexity.
- Convention over configuration.
- Documentation first.
- AI-friendly repository.
- Mobile-first development (Termux).
- Free tools only.
- No overengineering.
- Everything should be replaceable.

## Repository Structure

```
familyos/
├── .github/              # GitHub configuration (issue templates, workflows, etc.)
├── docs/
│   ├── architecture/     # Architecture decisions and diagrams
│   └── guides/           # How-to guides
├── automation/           # Automation definitions (future)
├── scripts/              # Small utility scripts (future)
├── configs/              # Shared configuration files (future)
├── templates/            # Reusable templates (future)
└── assets/               # Images, diagrams, static files
```

## Technology Stack

FamilyOS is built from free, mobile-accessible tools:

- **GitHub** — source of truth, version control, issue tracking.
- **Claude Code** — AI pair-programmer and documentation assistant.
- **Termux** — mobile Linux environment for developing on the go.
- **Notion** — personal knowledge base and planning space (optional, external).
- **WhatsApp** — the executive interface: FamilyOS delivers the daily brief to a personal WhatsApp account, self-hosted via [Baileys](https://github.com/WhiskeySockets/Baileys) (no Meta Cloud API). See [WhatsApp Foundation](docs/capabilities/whatsapp-foundation.md) for the transport, session lifecycle, and recovery steps, and [ADR-001](docs/architecture/ADR-001-whatsapp-transport.md) for why Baileys was chosen.
- **n8n** — automation engine, introduced only when a real automation need exists (optional).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how these tools work together.

## CLI

Start with `npm run setup`. FamilyOS also ships: `doctor` (checks your setup), `config` (shows the currently loaded configuration, secrets masked), `brief` (generates today's executive brief from Notion), `whatsapp:link` (links this device to a personal WhatsApp account), `whatsapp:status` (shows the WhatsApp connection state), `family` (lists the family registry), and `message` (routes a message as if it arrived from WhatsApp).

### Get started

FamilyOS runs in [Termux](https://termux.dev) on an Android phone (and on any machine with Node.js and git).

In Termux, install Node.js and git once:

```
pkg update && pkg upgrade
pkg install nodejs-lts git
```

Then clone and run **one command**:

```
git clone <this repo>
cd familyos
npm run setup
```

Setup installs everything, asks who is in the family, pairs WhatsApp, and offers to start the assistant. Nothing needs to be edited by hand.

Once it is running, message the paired WhatsApp account from a registered number:

```
/ping    /help    /status
```

To check the install at any time:

```
npm run doctor
```

`doctor` separates what FamilyOS needs from what is optional — Notion only affects `npm run brief`, so leaving it unconfigured is fine.

To start the assistant later:

```
npm run listen
```

### Optional: the Notion daily brief

`.env` is created by setup and only matters for the brief. Fill in:

- `NOTION_TOKEN` — an integration token from https://www.notion.so/my-integrations
- `NOTION_DB_TASKS`, `NOTION_DB_CALENDAR`, `NOTION_DB_BILLS`, `NOTION_DB_DOCUMENTS` — database IDs, each shared with your integration
- `TIMEZONE` — an IANA timezone, e.g. `Asia/Jakarta` (defaults to `UTC`)
- `BRIEF_TRANSPORT` — `console` (default) or `whatsapp`
- `WHATSAPP_TARGET` — the number that receives the brief

```
npm run brief
npm run brief -- --transport whatsapp
```

### Re-pairing WhatsApp

`npm run setup` skips pairing when a session already exists. To pair a different account:

```
rm -rf .familyos/whatsapp-session
npm run whatsapp:link
```

Pairing offers a QR code or an 8-character pairing code. The code is easier in Termux, where the QR would be on the screen that has to scan it. See [WhatsApp Foundation](docs/capabilities/whatsapp-foundation.md).

### Family registry and commands

Family members live in one place — `configs/family.json`, which holds every phone number FamilyOS knows. `npm run setup` writes it for you; to see or edit it afterwards:

```
npm run family
```

Messages from registered members are routed to a small command set (`/help`, `/status`, `/family`, `/ping`, plus `/remember`, `/recall`, `/forget`, `/memory`); unknown senders are rejected without a reply. Start the listener to answer WhatsApp messages automatically:

```
npm run listen
```

A single message can also be routed by hand, without WhatsApp:

```
node bin/familyos.js message --from "+6281234567890" "/help"
```

FamilyOS can also message members by id, without any capability handling a phone number:

```
node bin/familyos.js notify --to parent-1 "dinner is ready"
node bin/familyos.js notify --all "power is out"
```

Every command is authorized through one Policy Engine. Members have a role — `owner`, `parent`, `sibling`, `child`, or `guest` — and the rules live in a single table (`src/policy/rules.js`), never in the capabilities. Anyone can record facts about themselves; only an owner or parent can record facts about someone else, or forget anything. See [Policy Engine](docs/capabilities/policy-engine.md).

FamilyOS remembers structured facts about family members, and they survive a restart:

```
node bin/familyos.js message --from "+6281234567890" "/remember me allergy peanuts"
node bin/familyos.js message --from "+6281234567890" "/recall me allergy"
node bin/familyos.js message --from "+6281234567890" "/memory"
```

See [Family Registry](docs/capabilities/family-registry.md), [Message Router](docs/capabilities/message-router.md), [Capability Runtime](docs/capabilities/capability-runtime.md), [WhatsApp Inbound](docs/capabilities/whatsapp-inbound.md), [Memory Engine](docs/capabilities/memory-engine.md), [Notification Engine](docs/capabilities/notification-engine.md), [Policy Engine](docs/capabilities/policy-engine.md), and [Zero-Touch Setup](docs/capabilities/zero-touch-setup.md).

### Troubleshooting WhatsApp

`npm run doctor` validates the WhatsApp session file, the stored credentials, and whether WhatsApp is actually reachable. Failures are reported in plain language — session expired, pairing rejected, no internet, unsupported WhatsApp version, or reconnect required — rather than as raw status codes.

An interrupted pairing (cancelled, expired code, or a dropped connection) leaves a session that claims an identity it never finished registering. WhatsApp answers those with failure 401, so `whatsapp:link` detects that state and resets it automatically before retrying — no manual cleanup needed.

For the full session lifecycle, recovery table, and re-pairing steps, see [docs/capabilities/whatsapp-foundation.md](docs/capabilities/whatsapp-foundation.md).

If a link stops working, the usual fix is to delete the saved session and pair again:

```
rm -rf .familyos/whatsapp-session
npm run whatsapp:link
```

## Current Status

**Milestone 1 — Foundation** is complete. **Milestone 2 — First Validated Capability** is in progress: a working `familyos` CLI (`doctor`, `config`, `brief`) connects to Notion and generates a real Executive Brief. See [docs/capabilities/CAPABILITY-REGISTRY.md](docs/capabilities/CAPABILITY-REGISTRY.md) for its validation status.

## Next Milestone

**Milestone 3 — Knowledge**, once the Daily Brief capability is validated through real, sustained use. See [docs/ROADMAP.md](docs/ROADMAP.md) for the full milestone plan.
