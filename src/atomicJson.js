const fs = require('fs');
const path = require('path');

// Crash-safe JSON persistence, shared by everything that has to survive the
// process ending abruptly.
//
// A plain fs.writeFile truncates the target to zero bytes before writing, and
// an async one can be abandoned mid-flight when the process exits — which is
// how a WhatsApp session once ended up as an empty, unparseable file. Both
// problems are avoided the same way:
//   * write to a temp file, fsync it, then rename over the target. rename(2) is
//     atomic within a filesystem, so a reader sees either the previous file or
//     the complete new one, never a partial one.
//   * do it synchronously, so the data is durable by the time the call returns
//     and nothing is left in flight for process exit to lose.

function writeJsonAtomic(filePath, data, { replacer, label = 'data' } = {}) {
  const json = JSON.stringify(data, replacer);

  if (typeof json !== 'string' || json.length === 0) {
    throw new Error(`Refusing to write empty ${label} to ${path.basename(filePath)}.`);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const tmpPath = `${filePath}.tmp`;
  try {
    const handle = fs.openSync(tmpPath, 'w');
    try {
      fs.writeFileSync(handle, json);
      // Flush before publishing, so a power loss right after the rename cannot
      // expose an empty file.
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }

  return fs.statSync(filePath).size;
}

// Missing, empty, and corrupt files all read as null, so callers can fall back
// to a fresh value instead of crashing on a damaged file.
function readJsonOrNull(filePath, { reviver } = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'), reviver);
  } catch {
    return null;
  }
}

module.exports = { writeJsonAtomic, readJsonOrNull };
