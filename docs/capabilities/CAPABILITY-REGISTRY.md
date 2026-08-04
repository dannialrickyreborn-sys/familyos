# Capability Registry

This registry tracks every capability FamilyOS has ever proposed, regardless of its current lifecycle state (see `docs/capabilities/CAPABILITY-LIFECYCLE.md`). Each row corresponds to a detailed capability document written from `docs/capabilities/templates/CAPABILITY_TEMPLATE.md`.

| Capability ID | Name | Status | Problem Solved | Inputs | Outputs | Dependencies | Validation Date | Owner | Notes |
|---|---|---|---|---|---|---|---|---|---|
| CAP-001 | Daily Brief | Testing | No single place to see today's tasks, events, bills, and documents at a glance | Notion Tasks, Calendar, Bills, Documents databases | Terminal-printed executive brief (`familyos brief`) | `familyos` CLI, Notion integration token | | Repository owner | Implemented; not yet validated through sustained daily use. See `CAP-001-daily-brief.md`. |
