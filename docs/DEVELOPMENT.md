# Development Workflow

FamilyOS follows a simple, linear workflow for every change, regardless of size.

```
Idea
  ↓
GitHub Issue
  ↓
Implementation
  ↓
Review
  ↓
Commit
  ↓
Release
```

## 1. Idea

Every change starts as an idea — a problem, a gap, or an improvement. Ideas can come from anywhere: daily use of the system, a Notion note, or a conversation with Claude Code.

## 2. GitHub Issue

Before work begins, the idea becomes a GitHub Issue. The issue describes the problem or goal, not the implementation. This keeps a record of *why* something was built, separate from *how*.

## 3. Implementation

Work happens on a branch, following the standards in `CLAUDE.md`. Implementation stays scoped to the issue — unrelated improvements become new issues instead of scope creep.

## 4. Review

Every change is reviewed before merging, whether by a human, Claude Code, or both. Review checks correctness, but also checks alignment with this repository's principles: simplicity, documentation, and no unnecessary complexity.

## 5. Commit

Once reviewed, the change is committed with a clear, descriptive message (see the commit rules in `CLAUDE.md`) and merged.

## 6. Release

Meaningful merges are recorded in `docs/CHANGELOG.md` under a version number. Not every commit needs a release — releases mark points where the system reached a new, stable state.
