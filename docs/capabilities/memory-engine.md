# Memory Engine (CAP-007)

**Status:** Active.

Remembers structured facts about family members, so FamilyOS can be asked later and still know. Facts survive restarts.

## Where it sits

```
Capability          /remember  /recall  /forget  /memory
    |
Memory Engine       subjects are member ids; deterministic; synchronous
    |               src/memory/engine.js
Memory Store        one atomically written JSON file
                    src/memory/store.js -> .familyos/memory.json
```

Memory is independent of every other layer. Enforced by tests:

- the engine's requires are asserted to be **exactly** `../familyRegistry` and `./store` — no transport, no notification layer;
- no file in `src/memory/` may require a transport or the notification layer;
- capabilities may use only the public API, never the store.

## Public API

Everything is **synchronous**, which keeps capabilities simple — the runtime executes them synchronously — and makes results easy to reason about.

```js
const { remember, recall, forget, search } = require('./memory/engine');

remember('parent-1', 'allergy', 'peanuts');
remember('parent-1', 'allergy', 'shellfish', { append: true });
recall('parent-1', 'allergy');
forget('parent-1', 'allergy');
search('peanut');
```

Two extra read helpers exist for listings: `listSubject(subjectId)` and `listAll()`.

### `remember(subjectId, key, value, options?)`

```js
{ ok, subjectId, key, value, mode, overwritten, active }
```

`mode` is `'set'` or `'append'`. `overwritten` is true when a previous value was replaced.

A second write to the same key **replaces** the first. Passing `{ append: true }` accumulates instead: the stored value becomes a list, and further appends push onto it. Appending to a key that does not exist yet simply stores the value (`mode: 'set'`). A later plain write replaces the whole list.

Values may be strings or any JSON-serialisable structure.

### `recall(subjectId, key, options?)`

```js
{ ok, found, subjectId, key, value, updatedAt, active }
```

A key that was never stored is **not** an error: `found` is false and `value` is null.

### `forget(subjectId, key, options?)`

```js
{ ok, forgotten, subjectId, key, active }
```

Forgetting something that was never stored is not an error either. When a subject has nothing left, it is removed from the store rather than left as an empty shell.

### `search(query, options?)`

```js
{ ok, query, matches: [{ subjectId, key, value, updatedAt }] }
```

Case-insensitive substring matching over the key and the value. An empty query matches nothing rather than everything. `options.subjectId` narrows the search to one member.

### Errors

| `reason` | When |
|---|---|
| `unknown_subject` | no family member has that id |
| `invalid_key` | key missing, empty, or not a string |
| `invalid_value` | value missing or an empty string |

Failures return `{ ok: false, reason, detail, ... }` — `detail` is a sentence for humans, `reason` is for code. Nothing is written when an operation fails.

### Options

| Option | Meaning |
|---|---|
| `append` | accumulate instead of replacing |
| `subjectId` | narrow `search` to one member |
| `matcher` | replace the search strategy |
| `family` | inject a loaded registry instead of reading `configs/family.json` |
| `store` | inject a store — how tests avoid the real file |
| `now` | inject the clock, so timestamps can be pinned |

## Subjects are member ids

A subject is always a Family Registry member id — never a phone number, never free text. That keeps memory and identity from drifting apart, and means an unknown id is caught immediately rather than quietly creating a fact about nobody.

**Inactive members are allowed**, on purpose. Memory is a *record*, not an action aimed at someone: deactivating a member must not make their history unreachable. Results carry `active` so a caller can decide what to do about it.

This deliberately differs from the [Notification Engine](notification-engine.md), where an inactive member is skipped — because sending a message *is* an action directed at a person, while remembering something about them is not.

## Determinism

Same store plus same arguments always gives the same result:

- keys are normalized (trimmed, lowercased), so `Allergy`, `allergy`, and `  allergy ` are one fact rather than three;
- listings and search results are sorted by subject then key, whatever order facts were written in;
- the clock is injectable, so timestamps can be pinned in tests;
- nothing is random, and no operation depends on wall-clock ordering.

## Storage

One JSON file at `.familyos/memory.json` (gitignored, like the rest of the local state):

```json
{
  "version": 1,
  "subjects": {
    "parent-1": {
      "allergy": { "value": "shellfish", "updatedAt": "2026-08-05T04:14:48.667Z" }
    }
  }
}
```

Writes go through `src/atomicJson.js` — temp file, `fsync`, then `rename` — the same crash-safe persistence the WhatsApp session uses. That helper was extracted from the session code during this sprint rather than copied, so both share one implementation; the session's durability checks were re-run afterwards to confirm no regression.

### Corrupt storage recovery

A file that does not parse, is empty, or parses into the wrong shape is **moved aside** to `memory.json.corrupt` and memory starts empty. The damaged file is kept for inspection rather than overwritten, the recovery is reported on stdout, and the next write proceeds normally.

## Commands

| Command | Aliases | Usage |
|---|---|---|
| `/remember` | `note` | `/remember <member-id\|me> <key> <value>` |
| `/recall` | `what` | `/recall <member-id\|me> <key>` |
| `/forget` | — | `/forget <member-id\|me> <key>` |
| `/memory` | `memories` | `/memory` · `/memory <member-id>` · `/memory <query>` |

`me` resolves to the sender, which is the common case in a chat. `/memory` with no argument lists everything; with a bare member id it lists that member; with anything else it keyword-searches.

```
/remember me allergy peanuts     -> Remembered allergy for parent-1.
/remember me allergy shellfish   -> Remembered allergy for parent-1 (replaced the previous value).
/recall me allergy               -> allergy for parent-1: shellfish
/memory dairy                    -> - child-1 / allergy: dairy
/forget parent-2 hobby           -> Forgot hobby for parent-2.
```

## Future vector or AI search

`search(query, options)` delegates matching to a `matcher(query, fact)` function. Swapping in an embedding-based or model-backed matcher means passing a different `matcher` — or changing the default — with **no change to what `search` accepts or returns**, and no change to any capability. A test drives `search` with a custom matcher to keep that seam honest.

## Known limitations

- **No access control.** Any registered member can remember, recall, or forget facts about anyone, including `/forget`, which is destructive. Restricting a command is a one-word change (`permissions: ['admin']`), deliberately not applied until there is a policy to apply.
- **Append is engine-only.** `{ append: true }` is available through the API but not exposed as chat syntax, since inventing a syntax for it now would be guesswork.
- **Keyword search only.** Substring matching, no stemming, ranking, or fuzzy matching. Results are unranked, in sort order.
- **No history.** Overwriting a value discards the previous one; only `updatedAt` is kept. Append is the way to keep several values.
- **Whole file in memory.** Every operation loads and rewrites the entire store. Fine for a family, not for a large corpus.
- **No concurrency control.** Two processes writing at once can lose one another's change — the write is atomic, but there is no locking. In practice one CLI or one listener writes at a time.

## Tests

`tests/memoryEngine.test.js` covers remember (including structured values and key normalization), overwrite, append in all its forms, recall (hit and miss), forget (including subject cleanup), unknown member across every operation, inactive member, search (key, value, case-insensitivity, ordering, subject filter, empty query, swappable matcher), listings, determinism, persistence across a fresh store instance, atomic writes leaving no temp file, and corrupt-storage recovery in three shapes plus writing afterwards.

```
npm test
```
