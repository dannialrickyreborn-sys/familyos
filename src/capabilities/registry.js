const { actions, ruleFor } = require('../policy/rules');

// The in-code registry of capabilities. Not to be confused with the family
// registry (who the family is) or docs/capabilities/CAPABILITY-REGISTRY.md
// (the written record). This one maps command words to executable behaviour.
//
// A capability descriptor:
//   id           unique, stable handle
//   command       the primary word, without the leading "/"
//   aliases       alternative words, may be empty
//   description   one line, shown by /help
//   action        the policy action it performs; the Policy Engine decides who
//                 may run it, so a capability never names a role
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

    if (typeof capability.action !== 'string' || capability.action.trim() === '') {
      fail(`"${capability.id}" needs an "action" naming what it does, e.g. "memory.recall".`);
    }

    // Registering an action no policy defines would make the capability
    // permanently denied at runtime, so it is caught here instead.
    if (!ruleFor(capability.action)) {
      fail(
        `"${capability.id}" declares action "${capability.action}", which no policy defines. Known actions: ${actions().join(', ')}.`
      );
    }

    // A role list on a descriptor would be a permission decision made outside
    // the Policy Engine.
    if (capability.permissions !== undefined) {
      fail(
        `"${capability.id}" still declares "permissions". Permissions live in src/policy/rules.js; declare an "action" instead.`
      );
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
