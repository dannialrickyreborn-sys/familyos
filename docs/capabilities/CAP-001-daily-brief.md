# Capability: Daily Brief

**Capability ID:** CAP-001
**Status:** Testing

## Problem

Information about the day — tasks, calendar events, bills, and documents — lives scattered across Notion databases with no single place to see what actually matters today.

## Goal

Running one command shows an accurate, readable summary of today's tasks, events, bills due soon, and recently updated documents.

## Scope

Reads from up to four Notion databases (Tasks, Calendar, Bills, Documents) and delivers a plain-text brief through a pluggable transport — the terminal by default, or a personal WhatsApp account (see ADR-001) once linked. It does not write back to Notion, and does not interpret or summarize content with AI — it filters and lists.

## Inputs

- `NOTION_TOKEN` — Notion integration token.
- `NOTION_DB_TASKS`, `NOTION_DB_CALENDAR`, `NOTION_DB_BILLS`, `NOTION_DB_DOCUMENTS` — database IDs, each shared with the integration.
- `TIMEZONE` — used to determine "today."

Any database left unconfigured is skipped and reported as such in the output.

## Outputs

A brief covering overdue tasks, tasks due today, today's calendar events, bills due within 7 days, and the 5 most recently updated documents — printed to the terminal, or sent to WhatsApp if `BRIEF_TRANSPORT=whatsapp`.

## Dependencies

The `familyos` CLI (`bin/familyos.js`, `src/config.js`, `src/notion.js`, `src/databases.js`, `src/properties.js`, `src/brief.js`, `src/transport.js`), a live Notion connection, and — only for the WhatsApp transport — a linked WhatsApp session (`npm run whatsapp:link`).

## Success Criteria

- `familyos brief` runs without crashing when all databases are configured with real data.
- Overdue/due-today/due-soon buckets match reality against the connected Notion databases.
- Missing configuration produces a clear message instead of a stack trace.

## Validation Method

Manual, repeated use against real family Notion databases over the course of normal daily use — checked against what the family actually expects to see each day. Not yet performed; only unit-level manual testing (error paths, missing config, malformed token) has been done so far.

## Known Limitations

- Assumes each database has exactly one property of each relevant type (one title, one date, one status/select, one checkbox, one number) — databases with multiple properties of the same type may extract the wrong one.
- No caching; every run re-queries Notion.
- The WhatsApp transport requires a one-time device link (`npm run whatsapp:link`, either scanning a QR code or entering a pairing code on the phone) that a human must perform — it cannot be automated. Automating a personal account this way is also against WhatsApp's Terms of Service; see ADR-001 for the accepted risk.

## Future Evolution

The brief text (`buildBrief()` in `src/brief.js`) is a plain string handed to a transport (`src/transport.js`); WhatsApp is the first transport beyond the terminal. Any future transport (email, a different messaging app) only needs to implement the same `send(text, config)` interface — this capability's content-generation logic would not change.
