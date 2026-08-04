# Architecture

FamilyOS has no application architecture yet — Milestone 1 is documentation and structure only. This document explains the role of each tool in the system and how they work together conceptually, so future milestones build on a shared understanding.

## Tools

### GitHub

The source of truth. Every piece of documentation, structure, and (eventually) code lives here. Issues track ideas and work; commits and pull requests track history. If it isn't in the repository, it isn't part of FamilyOS.

### Notion

An optional, external space for personal knowledge management and day-to-day planning that doesn't need version control — notes, drafts, and loosely structured thinking. Anything that becomes a stable decision or convention graduates into `docs/` in this repository.

### Termux

The mobile development environment. Termux makes it possible to clone the repository, edit files, run Claude Code, and commit changes directly from a phone. Mobile-first means every workflow in this repository must remain usable from Termux — no step should require a desktop.

### Claude Code

The AI pair-programmer for this repository. Claude Code reads `CLAUDE.md` as its operating manual, helps write and maintain documentation, and — starting from Milestone 2 onward — assists with implementation. It is a collaborator constrained by this repository's rules, not an independent decision-maker.

### n8n (optional)

An automation engine, introduced only once a real, recurring automation need exists — not before. When adopted, n8n workflows will be documented under `automation/`, with the workflow's purpose and trigger explained before the workflow definition itself.

### AI

AI (via Claude Code, and later other assistants) is treated as infrastructure, not a feature. It helps write documentation, reason about decisions, and eventually implement small pieces of the system — always within the constraints defined in `CLAUDE.md`.

## How They Work Together

1. **GitHub** hosts the repository and is the single source of truth for structure, docs, and code.
2. **Claude Code** operates inside the GitHub repository (including from Termux) to read, write, and maintain documentation and code according to `CLAUDE.md`.
3. **Termux** is the mobile terminal that connects a phone to GitHub and Claude Code, enabling development without a desktop.
4. **Notion** holds informal, pre-decision thinking; stable outcomes move into this repository's `docs/`.
5. **n8n**, once introduced, will connect to external services to automate a specific, real, documented need — never speculative automation.

Each tool has one clear job. None of them overlaps in responsibility, and each is replaceable without breaking the others.

## Principles

**Everything starts as a capability proposal. Only validated capabilities become permanent.**

No tool, workflow, or piece of functionality enters FamilyOS directly. It is first proposed as a capability (see `docs/capabilities/`), then built, tested, and validated against its own stated success criteria. Only once validated and in real use does it earn a permanent place in the system — and it keeps that place only for as long as it continues to earn it.
