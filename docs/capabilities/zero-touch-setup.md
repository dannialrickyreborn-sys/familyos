# Zero-Touch Setup (CAP-010)

**Status:** Active.

One command takes a fresh clone to a running assistant. Nothing has to be hand-edited.

## The whole thing

```
git clone <this repo>
cd familyos
npm run setup
```

`npm run setup` installs dependencies, then walks through everything that is left:

1. **Node check** — refuses early with the Termux install command if Node is too old.
2. **`.env`** — created from the template automatically. It is only used by the Notion brief, so leaving it empty is a complete, working setup.
3. **Family registry** — asks for each member's name and WhatsApp number and writes `configs/family.json`. No JSON editing.
4. **WhatsApp** — offers to pair right there (QR code or pairing code).
5. **Summary** — says whether FamilyOS is ready, and names exactly what is left if not.
6. **Listener** — offers to start it immediately.

Re-running is safe. An existing registry is reported and kept unless you ask to replace it; an already-linked WhatsApp session is left alone.

## What it removed

| Before | Now |
|---|---|
| `npm install` | done by `npm run setup` |
| `cp .env.example .env` | done automatically, and only needed for the Notion brief |
| `cp configs/family.example.json configs/family.json` | not needed |
| hand-edit JSON: ids, E.164 numbers, roles | asked, one question at a time |
| `npm run whatsapp:link` | offered inside setup |
| `npm run listen` | offered inside setup |
| reading docs to learn `.env` is optional | `doctor` now says so |

## Things it asks, and why

**Name and WhatsApp number.** These cannot be discovered — a family's phone numbers are not knowable from the filesystem. This is the irreducible manual part, and it is asked rather than edited.

**Member id** is generated from the name (`Ricky` → `ricky`, `First Parent` → `first-parent`), made safe for the registry, and de-duplicated (`ricky-2`) when two people share a name. Nobody has to invent one.

**Role** is not asked for the first person: whoever runs setup becomes `owner`. Later members choose from the five roles. Assigning a role here is data entry, not a permission decision — see [Policy Engine](policy-engine.md).

**Validation happens as you type.** A number that is not international format is re-asked with the reason; an empty name is re-asked; a duplicate number is refused. Whatever setup writes is validated through the real registry loader first, so setup can never produce a file the rest of FamilyOS would reject.

## Non-interactive terminals

Setup needs to ask questions. In a pipe or a script it does not hang or guess — it prints the manual equivalent and exits non-zero:

```
This terminal is not interactive, so setup cannot ask questions.
Run "npm run setup" from a normal terminal, or configure manually:
  1. cp configs/family.example.json configs/family.json
     then edit it: name, WhatsApp number, and role for each member
  2. npm run whatsapp:link
  3. npm run listen
```

## `doctor` tells the truth now

Notion powers the daily brief and nothing else. Previously an install that only wanted the WhatsApp assistant reported **10 failures out of 11 checks** — alarming, and wrong. Checks are now grouped, and unconfigured optional ones are skipped rather than failed:

```
FamilyOS Doctor

Required — WhatsApp assistant
  [OK  ] Node.js version — v22.22.2 (>= 18 required)
  [FAIL] Family registry — Not set up — run "npm run setup"
  [FAIL] WhatsApp session — Missing — run "npm run whatsapp:link"
  [SKIP] WhatsApp credentials — Not checked — no session yet
  [SKIP] WhatsApp reachable — Not checked — not linked yet

Optional — Notion daily brief
  [SKIP] Notion token — NOTION_TOKEN not set
  …

2 required check(s) failed:
  - Family registry: Not set up — run "npm run setup"
  - WhatsApp session: Missing — run "npm run whatsapp:link"

Notion is not configured. That is fine — it only affects "npm run brief".
```

Dependent checks that cannot run yet are reported as such rather than counted as separate failures, so the actionable list is as short as the truth allows. Once everything required passes, `doctor` says `FamilyOS is ready. Start it with "npm run listen".`

## Known limitations

- **Phone numbers must be typed.** They cannot be derived from anything on the device.
- **Pairing needs a human** — scanning a QR code or entering a pairing code on the phone.
- **Interactive only.** Setup does not accept members as flags, so it cannot be fully scripted. Editing `configs/family.json` directly remains supported for that.
- **The listener runs in the foreground.** `npm run setup` can start it, but keeping it alive across reboots is left to whatever supervises processes on the device.
- **Not a service installer.** No systemd unit, no Termux boot hook.

## Tests

`tests/setup.test.js` covers id generation (including unsafe characters and collisions), the first member becoming owner without being asked, later members choosing a role, the default role answer, re-asking on a bad phone number and an empty name, refusing a duplicate number, giving up loudly after too many invalid numbers, everything setup builds passing the real registry validation, `.env` being created, the non-interactive path explaining itself instead of hanging, and `doctor`'s required/optional split in four states.

```
npm test
```
