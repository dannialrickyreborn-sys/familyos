# CLAUDE.md

This file is the operating manual for Claude Code (and any AI assistant) working in this repository. Follow it before applying general best practices — repository-specific rules here take precedence.

## Mission

Help build and maintain FamilyOS as a clean, simple, well-documented system that evolves one milestone at a time. Protect the foundation from unnecessary complexity, even when a "better" solution is technically tempting.

## Development Principles

- Simplicity over complexity.
- Convention over configuration.
- Documentation first — if it isn't documented, it doesn't exist yet.
- Mobile-first — every workflow must be usable from Termux on a phone.
- Free tools only — no paid services, no paid tiers, no trial dependencies.
- No overengineering — build for the milestone in front of you, not for imagined futures.
- Everything should be replaceable — no tool or structure is permanent; avoid deep lock-in.

## Coding Standards

- No application code, APIs, or databases exist yet in this repository — do not introduce them outside of an explicit milestone task.
- When code is eventually added, keep files small, plain, and readable over clever.
- No placeholder code, stub files, or "TODO: implement later" scaffolding. If a task isn't ready to be built, it isn't built.
- No new dependency is added without a proven, immediate need.

## Repository Rules

- Keep the top-level structure defined in `README.md` stable; don't rename or restructure directories without updating the docs in the same change.
- `docs/` is the source of truth for plans and decisions. Code and structure should follow docs, not the other way around.
- Don't create files "just in case." Every file must serve a task that currently exists.

## Commit Rules

- Write clear, descriptive commit messages in the imperative mood (e.g. `docs: establish FamilyOS foundation`).
- Prefix commits by type when it helps clarity: `docs:`, `feat:`, `fix:`, `chore:`.
- One logical change per commit where practical. Don't mix unrelated changes.

## Documentation Rules

- Every milestone must update `docs/ROADMAP.md` and `docs/CHANGELOG.md`.
- Architecture decisions belong in `docs/architecture/`; process guides belong in `docs/guides/`.
- Prefer updating existing docs over creating new ones. Only add a new doc file when an existing one clearly doesn't fit.

## Decision Making Rules

- When in doubt, choose the simpler option, even if it seems less "professional."
- Introduce a new tool, dependency, or abstraction only after a real, current need has appeared — not before.
- If a decision is reversible, make it and move on. If it's hard to reverse (deleting data, restructuring history, adding a paid tool), pause and confirm with the user first.
- Prefer asking a clarifying question over guessing when a request is ambiguous.

## Golden Rule

**Never add complexity without proven need.**
