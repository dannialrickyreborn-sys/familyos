const fs = require('fs');
const path = require('path');
const { defaultRegistry } = require('./registry');

// Files in this directory that are the runtime itself rather than capabilities.
const INFRASTRUCTURE = new Set(['index.js', 'registry.js', 'runtime.js']);

let loaded = false;

// Loads every capability module in this directory. Each one registers itself on
// require, so adding a capability means dropping a file in here — no dispatch
// table and no router change.
function loadCapabilities() {
  if (loaded) return defaultRegistry;

  const files = fs
    .readdirSync(__dirname)
    .filter((file) => file.endsWith('.js') && !INFRASTRUCTURE.has(file))
    .sort();

  for (const file of files) {
    require(path.join(__dirname, file));
  }

  loaded = true;
  return defaultRegistry;
}

module.exports = { loadCapabilities };
