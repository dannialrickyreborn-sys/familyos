# Family Registry

**Status:** Active.

The single source of truth for who the family is. Every part of FamilyOS that needs to identify a person looks them up here — no phone number belongs in code or in any other configuration file.

## Why it exists

Before this, the only identity FamilyOS knew was `WHATSAPP_TARGET`: one phone number, no name, no roles, and no way to tell family from strangers. Anything involving more than one person would have meant scattering numbers across code and config. The registry centralises that so identity has one home, and so a phone number never has to be embedded anywhere.

## Where it lives

| File | Tracked in git | Purpose |
|---|---|---|
| `configs/family.example.json` | yes | template to copy |
| `configs/family.json` | **no** (gitignored) | the real registry |

The real registry contains actual phone numbers, so it is gitignored — the same split already used for `.env` and `.env.example`.

```
cp configs/family.example.json configs/family.json
```

## Schema

```json
{
  "members": [
    {
      "id": "parent-1",
      "name": "First Parent",
      "phone": "+6281234567890",
      "role": "admin",
      "active": true
    }
  ]
}
```

| Field | Rules |
|---|---|
| `id` | required, unique. Lowercase letters, digits, `-` or `_`, starting with a letter or digit. This is the stable handle used everywhere else. |
| `name` | required, non-empty. The display name used in replies. |
| `phone` | required, unique, international format. Normalized to E.164 on load, so `+62 812-3456-7890`, `6281234567890`, and `006281234567890` are the same person. |
| `role` | required, one of `admin`, `member`. Recorded but not yet used for permissions. |
| `active` | required boolean. `false` revokes access without deleting the record. |

Validation is strict and fails loudly: the loader names the offending member and field rather than silently ignoring a bad entry. Duplicate ids and duplicate phone numbers are both rejected — including the case where the same number is written two different ways.

## Reading it

```
npm run family
```

```
ID        NAME           PHONE           ROLE    ACTIVE
parent-1  First Parent   +6281234567890  admin   yes
parent-2  Second Parent  +6281234567891  member  yes
child-1   First Child    +6281234567892  member  no

2 active of 3 registered.
```

This local view deliberately shows phone numbers and inactive members, because that is what you need when editing the registry. The `/family` chat command shows neither — see [Message Router](message-router.md).

## API

`src/familyRegistry.js`:

| Function | Behaviour |
|---|---|
| `loadRegistry()` | reads and validates `configs/family.json`; throws with a message that says how to create it if missing |
| `parseRegistry(text)` | same validation against a string, used by tests |
| `activeMembers(registry)` | members with `active: true` |
| `findByPhone(registry, phone)` | **active** members only, matched on normalized digits; `null` otherwise |
| `findById(registry, id)` | any member, active or not |

`findByPhone` resolving only active members is the deactivation mechanism: setting `active: false` immediately stops that number being recognised, while `findById` still returns the record so history stays intact.

## Known limitations

- **Roles are not enforced.** `admin` and `member` are recorded, but no command checks them yet. Adding permissions is a separate change.
- **Edited by hand.** There is no command to add or remove members; edit `configs/family.json` and re-run. Validation catches mistakes.
- **Loaded per run.** The file is read on each invocation, so an edit takes effect on the next command. There is no watching or caching.
- **`WHATSAPP_TARGET` still exists.** The brief's recipient is still set in `.env`, independent of the registry. Routing that through a member id would mean changing the transport, which is out of scope for this sprint.

## Recovery

The loader tells you what is wrong and where. Common cases:

| Message | Fix |
|---|---|
| `not found` | `cp configs/family.example.json configs/family.json` |
| `not valid JSON` | a syntax error — check commas and quotes |
| `member #2 ("child-1") has an invalid phone` | use international format with a country code |
| `duplicate id "..."` / `share the same phone number` | remove the duplicate entry |
| `has role "..."` | use `admin` or `member` |

The registry is plain JSON with no runtime state, so restoring it is just editing the file — nothing else needs resetting.
