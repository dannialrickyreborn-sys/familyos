const { ROLES } = require('../familyRegistry');

// The in-code registry of capabilities. Not to be confused with the family
// registry (who the family is) or docs/capabilities/CAPABILITY-REGISTRY.md
// (the written record). This one maps command words to executable behaviour.
//
// A capability descriptor:
//   id           unique, stable handle
//   command       the primary word, without the leading "/"
//   aliases       alternative words, may be empty
//   description   one line, shown by /help
//   permissions   roles allowed to run it; [] means any active member
//   execute       ({ member, family, capabilities, args }) => string

function createRegistry() {
  const byId = new Map();
  const byWord = new Map();

  function fail(message) {
    throw new Error(`Capability registration failed: ${message}`);
  }

  function validate(capability) {
    if (!capability || typeof capability !== 'object') fail('descriptor is not an object.');

    for (const field of ['id', 'command', 'description']) {
      if (typeof capability[field] !== 'string' || capability[field].trim() === '') {
        fail(`missing a non-empty "${field}".`);
      }
    }

    if (typeof capability.execute !== 'function') {
      fail(`"${capability.id}" has no execute() function.`);
    }

    if (!Array.isArray(capability.aliases)) {
      fail(`"${capability.id}" needs "aliases" to be an array (use [] for none).`);
    }

    if (!Array.isArray(capability.permissions)) {
      fail(`"${capability.id}" needs "permissions" to be an array ([] means any member).`);
    }

    for (const role of capability.permissions) {
      if (!ROLES.includes(role)) {
        fail(`"${capability.id}" lists unknown role "${role}"; expected one of ${ROLES.join(', ')}.`);
      }
    }

    for (const word of [capability.command, ...capability.aliases]) {
      if (typeof word !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(word)) {
        fail(`"${capability.id}" has invalid command word "${word}"; use lowercase letters, digits, "-" or "_".`);
      }
    }
  }

  function register(capability) {
    validate(capability);

    if (byId.has(capability.id)) fail(`duplicate id "${capability.id}".`);

    // Commands and aliases share one namespace, so a clash is caught wherever
    // it comes from rather than silently shadowing an existing capability.
    for (const word of [capability.command, ...capability.aliases]) {
      const owner = byWord.get(word);
      if (owner) fail(`"${capability.id}" claims "${word}", already used by "${owner.id}".`);
    }

    const stored = Object.freeze({ ...capability, aliases: [...capability.aliases] });
    byId.set(stored.id, stored);
    for (const word of [stored.command, ...stored.aliases]) {
      byWord.set(word, stored);
    }

    return stored;
  }

  return {
    register,
    all: () => [...byId.values()].sort((a, b) => a.command.localeCompare(b.command)),
    resolve: (word) => byWord.get(String(word || '').toLowerCase()) || null,
    get: (id) => byId.get(id) || null,
    size: () => byId.size,
  };
}

// The registry the application uses; capability modules register into it when
// they are loaded.
const defaultRegistry = createRegistry();

module.exports = {
  createRegistry,
  defaultRegistry,
  register: (capability) => defaultRegistry.register(capability),
};
