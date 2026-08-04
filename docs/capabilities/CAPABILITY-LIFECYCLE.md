# Capability Lifecycle

Every capability moves through the same simple lifecycle, in order. A capability cannot skip a state.

```
Proposed
  ↓
Building
  ↓
Testing
  ↓
Validated
  ↓
Active
  ↓
Deprecated
  ↓
Archived
```

## Proposed

The capability exists only as an idea and a filled-out template (`docs/capabilities/templates/CAPABILITY_TEMPLATE.md`). The problem, goal, and success criteria are written down. Nothing has been built.

## Building

Implementation work is in progress. The capability is being built according to its proposal, scoped to exactly what the proposal describes — nothing more.

## Testing

The capability is built and is being exercised against its stated success criteria and validation method. This is where it's checked whether it actually solves the problem it claims to solve.

## Validated

Testing confirmed the capability meets its success criteria. It works, but it has not yet earned a permanent place in the system through real use.

## Active

The capability is validated and in real, ongoing use. This is the only state in which a capability is considered a permanent part of FamilyOS — and even then, only for as long as it keeps earning its place.

## Deprecated

The capability is still present but no longer recommended for use — replaced by something better, or no longer solving a real problem. It is kept temporarily for reference or transition, not removed outright.

## Archived

The capability is retired. Its documentation is kept for history, but it is no longer part of the active system.
