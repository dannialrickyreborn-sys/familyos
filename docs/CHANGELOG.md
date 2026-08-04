# Changelog

All notable changes to FamilyOS are documented here.

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
