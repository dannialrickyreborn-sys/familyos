# WhatsApp Foundation

**Status:** Active — validated end-to-end on a real device (Termux, Android).

The transport that lets FamilyOS deliver output to a personal WhatsApp account, self-hosted and free. See [ADR-001](../architecture/ADR-001-whatsapp-transport.md) for why Baileys was chosen over the alternatives.

## Transport Architecture

Output capabilities never talk to WhatsApp directly. They produce plain text and hand it to a transport:

```
capability (e.g. brief)  ->  buildBrief() returns a plain string
                              |
                         src/transport.js        selects by name
                              |
              +---------------+---------------+
              |                               |
   transports/console.js            transports/whatsapp.js
      (prints to stdout)         (Baileys -> personal account)
```

- `src/transport.js` — resolves a transport by name (`console`, `whatsapp`) and loads it lazily, so commands that never send (`doctor`, `config`, console briefs) do not pay for loading Baileys.
- `src/transports/whatsapp.js` — socket creation, pairing, sending, and the live reachability probe.
- `src/whatsappAuthState.js` — atomic session persistence (see below).
- `src/whatsappSession.js` — session inspection with no Baileys import, so `doctor` and `whatsapp:status` can read state without opening a socket.
- `src/whatsappErrors.js` — maps WhatsApp disconnect codes to human-readable causes.
- `src/phone.js` — normalizes phone numbers to E.164.

Selected with `BRIEF_TRANSPORT=whatsapp` in `.env`, or per-run with `npm run brief -- --transport whatsapp`. The recipient is `WHATSAPP_TARGET`.

### Protocol version

Baileys pins a WhatsApp Web protocol version at publish time, and WhatsApp rejects it once the servers move on (failure 405). The version is therefore resolved at connect time, most authoritative first:

1. the `client_revision` live WhatsApp Web is serving (`fetchLatestWaWebVersion`)
2. the revision Baileys upstream last published (`fetchLatestBaileysVersion`)
3. the version bundled in the installed package — last resort only, with a warning

`fetchLatestBaileysVersion` is deliberately not the only source: it reads Baileys' master branch, which tracks the 7.x line.

## Session Lifecycle

```
no session
    |  npm run whatsapp:link  (QR code or pairing code)
    v
registration handshake  ->  WhatsApp asks for one reconnect (status 515)
    |                        handled automatically
    v
registered  ->  creds.json written atomically, then verified
    |
    v
linked  --  every later run reuses the session; pairing happens once
    |
    +--> unlinked on the phone      -> status 401 -> re-pair
    +--> interrupted mid-pairing    -> incomplete session -> reset automatically
```

Baileys decides between registering and logging in from `creds.me` alone — `Socket/socket.js`: `if (!creds.me) generateRegistrationNode else generateLoginNode`. It does **not** consult `creds.registered`. Because `requestPairingCode()` sets `creds.me` and emits `creds.update` before pairing finishes, an interrupted pairing leaves a session that claims an identity it never registered. Any later run would then send a *login* for an unregistered device and get `<failure reason="401">` forever.

FamilyOS treats a session with an identity but `registered !== true` as unusable and clears it before connecting, and again after a failed attempt. That state can never become permanent.

## Atomic Session Persistence

Baileys' bundled `useMultiFileAuthState` is not crash-safe: it writes with an async `fs.writeFile` (which truncates the file to zero bytes *before* writing) and the `creds.update` listener never awaits it. A short-lived CLI that exits right after pairing loses the write, leaving an empty `creds.json` — a session reported as linked but unreadable (`Unexpected end of JSON input`).

`src/whatsappAuthState.js` replaces it:

- every file is written to `<file>.tmp`, `fsync`ed, then `rename`d over the target. `rename(2)` is atomic within a filesystem, so a reader sees either the previous file or the complete new one — never a partial one.
- writes are **synchronous**, so data is durable by the time `saveCreds()` returns. Nothing is left in flight for `process.exit()` to lose.
- file naming (`/`→`__`, `:`→`-`) and `BufferJSON` encoding match Baileys', so session folders stay interchangeable.
- empty or corrupt files read as absent, so a damaged session falls back to a fresh registration instead of wedging.
- writing empty serialized data is refused outright.

Measured under repeated `SIGKILL` mid-write: the bundled implementation left a parseable `creds.json` in 5 of 25 runs; this one in 25 of 25.

After pairing, `link()` persists explicitly and then verifies the result — the file must exist, be non-empty, parse, and record a completed registration with an identity. Success is never reported for a session that cannot be read back, and the success line states the stored size. Each session write logs the file and its on-disk size:

```
[session] wrote creds.json (1882 bytes) via atomic rename
```

`creds.json` is always logged; key files are logged with `FAMILYOS_DEBUG=1`.

State lives in `.familyos/` (gitignored): `whatsapp-session/` holds the Baileys credentials and keys, `whatsapp-meta.json` records the last successful login and the WhatsApp Web version used.

## Known Limitations

- **Against WhatsApp's Terms of Service.** Automating a personal account carries a real, unpredictable ban risk. Keep volume low and prefer messaging yourself. A ban takes the normal WhatsApp account with it.
- **Reverse-engineered protocol.** WhatsApp can change it at any time; messaging stops until Baileys is patched and updated. No self-hosted option avoids this.
- **Pairing needs a human.** Scanning a QR code or entering a pairing code cannot be automated.
- **One session at a time.** A second connection using the same credentials takes over and disconnects the first (status 440).
- **No inbound handling.** The transport sends only; incoming messages are not processed.
- **Baileys 6.7.x.** Pinned to the stable line; 7.x is still a release candidate.
- **Timeouts are bounded, not retried indefinitely.** A send waits 30s for a connection, linking waits 180s for the human step.

## Recovering a Session

Start by asking what state it is in:

```
npm run whatsapp:status
npm run doctor
```

`doctor` checks the session file, the stored credentials, and live reachability separately, so the failing layer is visible. Common outcomes:

| Report | Meaning | Action |
|---|---|---|
| `Linked: yes`, `connected` | healthy | nothing |
| `session file damaged` | empty or unparseable `creds.json` | `npm run whatsapp:link` (resets automatically) |
| `incomplete pairing` | identity without registration | `npm run whatsapp:link` (resets automatically) |
| `unreachable — ... no internet` | network problem | check connectivity, retry |
| `session expired` (401) | device unlinked from the phone | re-pair, see below |
| `unsupported WhatsApp version` (405/411) | protocol moved on | retry; then `npm update @whiskeysockets/baileys` |

Both damaged and incomplete sessions are reset by `whatsapp:link` on its own — no manual cleanup needed.

## Re-pairing

To link a different account, or after the device was removed from the phone:

1. On the phone, open **WhatsApp → Linked Devices** and remove the old FamilyOS device if it is still listed. A stale entry there with no local credentials is what produces status 401.
2. Delete the local session and pair again:

```
rm -rf .familyos/whatsapp-session
npm run whatsapp:link
```

3. Choose a method:
   - **QR Code** — scan the code printed in the terminal.
   - **Pairing Code** — enter your number, then type the 8-character code on the phone under *Link a Device → "Link with phone number instead"*. Easier in Termux, where the QR would be on the screen that has to scan it.

Non-interactive equivalents:

```
npm run whatsapp:link -- --method qr
npm run whatsapp:link -- --method code --phone +6281234567890
```

4. Confirm:

```
npm run whatsapp:status     # expect Linked: yes and Connection status: connected
```
