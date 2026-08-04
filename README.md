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
- **WhatsApp** — the executive interface: FamilyOS delivers the daily brief to a personal WhatsApp account, self-hosted via [Baileys](https://github.com/WhiskeySockets/Baileys) (no Meta Cloud API). See [ADR-001](docs/architecture/ADR-001-whatsapp-transport.md).
- **n8n** — automation engine, introduced only when a real automation need exists (optional).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how these tools work together.

## CLI

FamilyOS ships a small command-line tool: `doctor` (checks your setup), `config` (shows the currently loaded configuration, secrets masked), `brief` (generates today's executive brief from Notion), `whatsapp:link` (links this device to a personal WhatsApp account), and `whatsapp:status` (shows the WhatsApp connection state).

### Install

FamilyOS is built to run in [Termux](https://termux.dev) on an Android phone (it also runs on any machine with Node.js and git).

In Termux, first install Node.js and git:

```
pkg update && pkg upgrade
pkg install nodejs-lts git
```

Then clone and install:

```
git clone <this repo>
cd familyos
npm install
```

### Configure

```
cp .env.example .env
```

Edit `.env` and fill in:

- `NOTION_TOKEN` — an integration token from https://www.notion.so/my-integrations
- `NOTION_DB_TASKS`, `NOTION_DB_CALENDAR`, `NOTION_DB_BILLS`, `NOTION_DB_DOCUMENTS` — database IDs, each shared with your integration
- `TIMEZONE` — an IANA timezone, e.g. `Asia/Jakarta` (defaults to `UTC`)
- `BRIEF_TRANSPORT` — `console` (default) or `whatsapp`
- `WHATSAPP_TARGET` — your phone number (digits only, with country code) to receive the brief, only needed if using the WhatsApp transport

### Run

```
npm run doctor
npm run config
npm run brief
```

### Linking WhatsApp

To send the brief over WhatsApp instead of printing it, link a device once:

```
npm run whatsapp:link
```

It shows a menu with two pairing methods:

1. **QR Code** (default) — a QR code is printed in the terminal. On your phone: WhatsApp > Linked Devices > Link a Device, then scan it.
2. **Pairing Code** — you enter your phone number, FamilyOS prints an 8-character code, and you type that code on your phone: WhatsApp > Linked Devices > Link a Device > "Link with phone number instead".

Pairing code is the easier option in Termux, since scanning a QR code shown on the same phone's screen is awkward.

Credentials are saved to `.familyos/` (gitignored), so pairing only happens once. WhatsApp normally asks for one automatic reconnect right after pairing — that is handled for you.

The command can also run non-interactively, which is useful in scripts:

```
npm run whatsapp:link -- --method qr
npm run whatsapp:link -- --method code --phone +6281234567890
```

Check the link at any time:

```
npm run whatsapp:status
```

It reports whether the account is linked, which phone number, live connection status, last successful login, and the transport version in use.

Once linked, either set `BRIEF_TRANSPORT=whatsapp` in `.env`, or run:

```
npm run brief -- --transport whatsapp
```

### Troubleshooting WhatsApp

`npm run doctor` validates the WhatsApp session file, the stored credentials, and whether WhatsApp is actually reachable. Failures are reported in plain language — session expired, pairing rejected, no internet, unsupported WhatsApp version, or reconnect required — rather than as raw status codes.

An interrupted pairing (cancelled, expired code, or a dropped connection) leaves a session that claims an identity it never finished registering. WhatsApp answers those with failure 401, so `whatsapp:link` detects that state and resets it automatically before retrying — no manual cleanup needed.

If a link stops working, the usual fix is to delete the saved session and pair again:

```
rm -rf .familyos/whatsapp-session
npm run whatsapp:link
```

## Current Status

**Milestone 1 — Foundation** is complete. **Milestone 2 — First Validated Capability** is in progress: a working `familyos` CLI (`doctor`, `config`, `brief`) connects to Notion and generates a real Executive Brief. See [docs/capabilities/CAPABILITY-REGISTRY.md](docs/capabilities/CAPABILITY-REGISTRY.md) for its validation status.

## Next Milestone

**Milestone 3 — Knowledge**, once the Daily Brief capability is validated through real, sustained use. See [docs/ROADMAP.md](docs/ROADMAP.md) for the full milestone plan.
