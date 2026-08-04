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
- **n8n** — automation engine, introduced only when a real automation need exists (optional).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how these tools work together.

## CLI

FamilyOS ships a small command-line tool with two commands: `doctor` (checks your setup) and `brief` (prints today's executive brief from Notion).

### Install

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

### Run

```
npm run doctor
npm run brief
```

## Current Status

**Milestone 1 — Foundation** is complete. The repository has a clean structure and baseline documentation. No application code, workflows, or automation exist yet — by design.

## Next Milestone

**Milestone 2 — Daily Life.** See [docs/ROADMAP.md](docs/ROADMAP.md) for the full milestone plan.
