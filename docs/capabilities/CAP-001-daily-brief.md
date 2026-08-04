# Capability: Daily Brief

**Capability ID:** CAP-001
**Status:** Testing

## Problem

Information about the day — tasks, calendar events, bills, and documents — lives scattered across Notion databases with no single place to see what actually matters today.

## Goal

Running one command shows an accurate, readable summary of today's tasks, events, bills due soon, and recently updated documents.

## Scope

Reads from up to four Notion databases (Tasks, Calendar, Bills, Documents) and prints a plain-text brief to the terminal. It does not write back to Notion, does not send notifications, and does not interpret or summarize content with AI — it filters and lists.

## Inputs

- `NOTION_TOKEN` — Notion integration token.
- `NOTION_DB_TASKS`, `NOTION_DB_CALENDAR`, `NOTION_DB_BILLS`, `NOTION_DB_DOCUMENTS` — database IDs, each shared with the integration.
- `TIMEZONE` — used to determine "today."

Any database left unconfigured is skipped and reported as such in the output.

## Outputs

A terminal-printed brief: overdue tasks, tasks due today, today's calendar events, bills due within 7 days, and the 5 most recently updated documents.

## Dependencies

The `familyos` CLI (`bin/familyos.js`, `src/config.js`, `src/notion.js`, `src/databases.js`, `src/properties.js`, `src/brief.js`) and a live Notion connection.

## Success Criteria

- `familyos brief` runs without crashing when all databases are configured with real data.
- Overdue/due-today/due-soon buckets match reality against the connected Notion databases.
- Missing configuration produces a clear message instead of a stack trace.

## Validation Method

Manual, repeated use against real family Notion databases over the course of normal daily use — checked against what the family actually expects to see each day. Not yet performed; only unit-level manual testing (error paths, missing config, malformed token) has been done so far.

## Known Limitations

- Assumes each database has exactly one property of each relevant type (one title, one date, one status/select, one checkbox, one number) — databases with multiple properties of the same type may extract the wrong one.
- No caching; every run re-queries Notion.
- Output is terminal-only today — no delivery to WhatsApp, email, or anywhere else yet.

## Future Evolution

Once validated through real use, the brief text (`buildBrief()` in `src/brief.js`) is already a plain string, so a future transport (e.g. WhatsApp) could send it without changing this capability — only the sending step would need to be added, once WhatsApp credentials exist.
