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

### WhatsApp

The executive interface — where the family actually reads what FamilyOS produces (starting with the daily brief). Self-hosted via [Baileys](https://github.com/WhiskeySockets/Baileys), which speaks WhatsApp Web's protocol directly from the `familyos` CLI using a personal WhatsApp account — no Meta Cloud API, no third-party provider. See [WhatsApp Foundation](capabilities/whatsapp-foundation.md) for how the transport is built and operated, and [ADR-001](architecture/ADR-001-whatsapp-transport.md) for why Baileys was chosen. Output capabilities (like the daily brief) are written against a transport abstraction, so WhatsApp is the first transport, not the only possible one.

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

## Application layers

The tools above are what FamilyOS is built *from*. These are the layers it is built *as*, inside the `familyos` CLI. Messages travel in two directions and share the middle of the stack.

**Inbound — a family member sends a command:**

```
WhatsApp transport      messages.upsert          src/transports/whatsapp.js
        |
Loop guards             is this ours?            src/whatsappOutbox.js
        |
Inbound adapter         normalize + filter       src/whatsappInbound.js
        |
Identity                who is speaking          src/familyRegistry.js
        |
Router                  known sender? a command? src/messageRouter.js
        |
Capability runtime      resolve, then authorize  src/capabilities/runtime.js
        |
Policy engine           may this actor do this?  src/policy/engine.js
        |
Capability              /help /status /family    src/capabilities/*.js
```

FamilyOS runs as a **linked device on the owner's personal WhatsApp account**, so the owner's own commands arrive marked `fromMe` — exactly like FamilyOS's own replies. `fromMe` therefore cannot decide anything by itself. Three independent guards separate the two: an **outbox** of every id FamilyOS has sent, the rule that only the **owner's own chat** is a command surface, and a **bounded budget** for self-originated commands that makes a runaway impossible by construction. See [ADR-002](architecture/ADR-002-one-number-executive-interface.md).

A capability declares the *action* it performs (`memory.forget`), never who may perform it. The Policy Engine holds every rule in one table, and an action nobody defined is denied rather than allowed.

**Outbound — a capability notifies someone:**

```
Capability              notify('parent-1', ...)
        |
Notification engine     member ids, never numbers  src/notifications/engine.js
        |
Channel router          which channel carries it   src/notifications/channelRouter.js
        |
Channel adapter         the only transport importer src/notifications/channels/*.js
        |
WhatsApp transport      the only layer that sees a phone number
```

**Sideways — a capability remembers something:**

```
Capability              remember('parent-1', 'allergy', 'peanuts')
        |
Memory engine           subjects are member ids       src/memory/engine.js
        |
Memory store            one atomic JSON file          src/memory/store.js
                                                      .familyos/memory.json
```

Memory is deliberately off to the side: it depends on the family registry and nothing else, so remembering a fact involves no transport and no notification.

Crash-safe JSON persistence is shared by the memory store and the WhatsApp session through `src/atomicJson.js` — temp file, `fsync`, `rename` — so there is one implementation of the thing that must not lose data.

Six rules hold the layering in place, each enforced by a test rather than by convention:

1. **The router knows no command names.** Adding a capability never touches it.
2. **The notification engine imports no transport.** Only a channel adapter may.
3. **Phone numbers stay in the transport layer.** Capabilities and the notification layer address people by member id. Local terminal diagnostics are the deliberate exception, since a person at the terminal already has the registry open.
4. **The memory engine imports neither a transport nor the notification layer.** Its only dependencies are the family registry and its own store.
5. **Capabilities reach memory only through its public API**, never the store.
6. **Only the policy layer compares a role.** A role literal anywhere else in `src/` fails the build. Capabilities declare actions; the runtime authorizes before executing; the router holds no authorization logic at all.

Each layer is documented as a capability under `docs/capabilities/`.

## Principles

**Everything starts as a capability proposal. Only validated capabilities become permanent.**

No tool, workflow, or piece of functionality enters FamilyOS directly. It is first proposed as a capability (see `docs/capabilities/`), then built, tested, and validated against its own stated success criteria. Only once validated and in real use does it earn a permanent place in the system — and it keeps that place only for as long as it continues to earn it.
