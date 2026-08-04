# Capabilities

## What Is a Capability?

A capability is a specific, named ability FamilyOS provides — something it can reliably do for the family, described by the problem it solves rather than the technology behind it. A capability is not code, not a workflow, and not a feature ticket. It is a documented, validated idea: "FamilyOS can do X, we know it works, and here is why it exists."

## Why FamilyOS Grows Through Capabilities, Not Features

Features accumulate. Teams (and solo builders) add them because they seem useful, and the system slowly fills with things nobody validated, few people use, and nobody wants to remove. That is the opposite of this project's principles.

A capability model forces a different discipline:

- Every addition starts as a **proposal**, not an implementation.
- Every addition must state the **problem it solves**, not just what it does.
- Nothing becomes permanent until it is **validated** — proven to actually work and actually help.
- Anything that stops earning its place can be **deprecated and archived** without guilt, because it was never assumed permanent in the first place.

This keeps FamilyOS small, intentional, and honest about what actually works versus what merely exists.

## How New Capabilities Should Be Proposed

1. Copy `docs/capabilities/templates/CAPABILITY_TEMPLATE.md`.
2. Fill in the template for the proposed capability — problem, goal, scope, inputs, outputs, dependencies, success criteria, validation method, known limitations, future evolution.
3. Add a row for it in `docs/capabilities/CAPABILITY-REGISTRY.md` with status `Proposed`.
4. Move the capability through the lifecycle described in `docs/capabilities/CAPABILITY-LIFECYCLE.md` as work progresses — updating its registry row and template document at each stage.

No capability skips the proposal stage, and no capability is implemented before it is proposed and understood.
