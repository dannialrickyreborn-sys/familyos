const fs = require('fs');
const path = require('path');
const { writeJsonAtomic, readJsonOrNull } = require('../atomicJson');

// Where remembered facts live. A single JSON file, written atomically so a
// crash mid-write cannot leave it truncated — the same persistence the WhatsApp
// session uses, shared through src/atomicJson.js.
const MEMORY_PATH = path.join(process.cwd(), '.familyos', 'memory.json');

const SCHEMA_VERSION = 1;

function emptyMemory() {
  return { version: SCHEMA_VERSION, subjects: {} };
}

// A file that does not parse, or parses into the wrong shape, is moved aside
// rather than overwritten. Recovery continues from empty memory, and the damaged
// file stays on disk for whoever wants to look at it.
function quarantine(filePath, log) {
  const quarantined = `${filePath}.corrupt`;
  try {
    fs.renameSync(filePath, quarantined);
    log(`[memory] ${path.basename(filePath)} was unreadable; moved to ${path.basename(quarantined)} and starting empty.`);
  } catch {
    log(`[memory] ${path.basename(filePath)} was unreadable and could not be moved aside; starting empty.`);
  }
}

function isWellFormed(data) {
  return Boolean(data) && typeof data === 'object' && data.subjects && typeof data.subjects === 'object';
}

function createFileStore({ filePath = MEMORY_PATH, log = console.log } = {}) {
  return {
    describe: () => filePath,

    load() {
      if (!fs.existsSync(filePath)) return emptyMemory();

      const data = readJsonOrNull(filePath);
      if (!isWellFormed(data)) {
        quarantine(filePath, log);
        return emptyMemory();
      }

      return { version: data.version || SCHEMA_VERSION, subjects: data.subjects };
    },

    save(data) {
      writeJsonAtomic(filePath, data, { label: 'memory' });
    },
  };
}

// Used by tests so they never touch the real file.
function createInMemoryStore(initial) {
  let data = initial ? JSON.parse(JSON.stringify(initial)) : emptyMemory();
  return {
    describe: () => '(in memory)',
    load: () => JSON.parse(JSON.stringify(data)),
    save: (next) => {
      data = JSON.parse(JSON.stringify(next));
    },
  };
}

module.exports = { MEMORY_PATH, SCHEMA_VERSION, emptyMemory, createFileStore, createInMemoryStore };
