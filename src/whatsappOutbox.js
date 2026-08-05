const path = require('path');
const { writeJsonAtomic, readJsonOrNull } = require('./atomicJson');

// Records the id of every message FamilyOS sends, so an inbound copy of one can
// be recognised as our own rather than guessed at.
//
// Why this has to be on disk: the listener and the notification path use
// separate sockets — and often separate processes. A reminder sent to the owner
// lands in the owner's own chat and comes back to the listener; without a shared
// record the listener would treat FamilyOS's own reminder as a new command. The
// file is small, capped, and written atomically.
const OUTBOX_PATH = path.join(process.cwd(), '.familyos', 'outbox.json');
const DEFAULT_LIMIT = 200;

function createOutbox({ filePath = OUTBOX_PATH, limit = DEFAULT_LIMIT, persist = true } = {}) {
  let ids = [];
  let loaded = false;

  function load() {
    if (!persist) return;
    const data = readJsonOrNull(filePath);
    ids = Array.isArray(data && data.ids) ? data.ids.filter((id) => typeof id === 'string') : [];
    loaded = true;
  }

  function save() {
    if (!persist) return;
    writeJsonAtomic(filePath, { ids }, { label: 'outbox' });
  }

  function ensureLoaded() {
    if (!loaded) load();
  }

  return {
    // Called for every message FamilyOS sends. A missing id is tolerated: the
    // other loop guards still apply, so recording is best-effort rather than
    // load-bearing on its own.
    record(id) {
      if (typeof id !== 'string' || id === '') return false;

      ensureLoaded();
      if (ids.includes(id)) return true;

      ids.push(id);
      if (ids.length > limit) ids = ids.slice(-limit);
      save();
      return true;
    },

    // Read-through: another process may have recorded a send since the last
    // load, so a miss re-reads the file before answering no.
    has(id) {
      if (typeof id !== 'string' || id === '') return false;

      ensureLoaded();
      if (ids.includes(id)) return true;

      if (persist) {
        load();
        return ids.includes(id);
      }
      return false;
    },

    size() {
      ensureLoaded();
      return ids.length;
    },
  };
}

// Caps how many self-originated commands are acted on per chat in a window.
//
// The outbox and the self-chat rule should already make a loop impossible. This
// exists so that it is impossible *by construction* even if both were wrong:
// a runaway can only ever produce `max` messages before it stops. The budget is
// far above human typing speed, so it never interferes with real use.
function createLoopGuard({ max = 20, windowMs = 60000, now = () => Date.now() } = {}) {
  const seen = new Map();

  return {
    allow(chat) {
      const key = String(chat || '');
      const cutoff = now() - windowMs;
      const recent = (seen.get(key) || []).filter((at) => at > cutoff);

      if (recent.length >= max) {
        seen.set(key, recent);
        return false;
      }

      recent.push(now());
      seen.set(key, recent);
      return true;
    },

    limit: max,
  };
}

module.exports = { OUTBOX_PATH, DEFAULT_LIMIT, createOutbox, createLoopGuard };
