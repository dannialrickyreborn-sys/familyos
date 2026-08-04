const fs = require('fs');
const path = require('path');
const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

// Drop-in replacement for Baileys' useMultiFileAuthState.
//
// The bundled version persists with an async fs.writeFile, which truncates the
// target to zero bytes before writing, and the creds.update listener never
// awaits the returned promise. A short-lived CLI regularly ends before that
// write flushes, leaving an empty creds.json that fails to parse with
// "Unexpected end of JSON input" — a session reported as linked but unusable.
//
// Two changes prevent that:
//   * every write goes to a temp file, is fsynced, then renamed over the
//     target. rename(2) is atomic within a filesystem, so a reader sees either
//     the old file or the complete new one — never a truncated one.
//   * the writes are synchronous, so they are already durable by the time
//     saveCreds() returns. Nothing stays in flight for process exit to lose.

function fixFileName(file) {
  // Matches Baileys' own mapping so existing session folders stay readable.
  return file?.replace(/\//g, '__')?.replace(/:/g, '-');
}

// Reports what was persisted and how large it ended up, measured after the
// rename. creds.json is always reported because it is the file whose loss
// breaks a link; the many key files are only reported with FAMILYOS_DEBUG=1.
function logWrite(filePath, bytes) {
  const name = path.basename(filePath);
  if (name === 'creds.json' || process.env.FAMILYOS_DEBUG === '1') {
    console.log(`[session] wrote ${name} (${bytes} bytes) via atomic rename`);
  }
}

function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  const json = JSON.stringify(data, BufferJSON.replacer);

  if (typeof json !== 'string' || json.length === 0) {
    throw new Error(`Refusing to write empty session data to ${path.basename(filePath)}.`);
  }

  try {
    const handle = fs.openSync(tmpPath, 'w');
    try {
      fs.writeFileSync(handle, json);
      // Flush to disk before publishing, so a power loss right after the
      // rename cannot expose an empty file.
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }

  logWrite(filePath, fs.statSync(filePath).size);
}

// Missing, empty, or corrupt files all read as absent, which lets Baileys fall
// back to fresh credentials instead of throwing.
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'), BufferJSON.reviver);
  } catch {
    return null;
  }
}

async function useAtomicFileAuthState(folder) {
  fs.mkdirSync(folder, { recursive: true });

  const filePath = (file) => path.join(folder, fixFileName(file));
  const creds = readJson(filePath('creds.json')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = readJson(filePath(`${type}-${id}.json`));
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const file = filePath(`${category}-${id}.json`);
              if (value) {
                writeJsonAtomic(file, value);
              } else {
                fs.rmSync(file, { force: true });
              }
            }
          }
        },
      },
    },
    saveCreds: async () => {
      writeJsonAtomic(filePath('creds.json'), creds);
    },
  };
}

module.exports = { useAtomicFileAuthState };
