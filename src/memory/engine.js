const { loadRegistry, findById } = require('../familyRegistry');
const { createFileStore } = require('./store');

// Remembers structured facts about family members.
//
// Subjects are Family Registry member ids — never phone numbers, never free
// text — so memory and identity cannot drift apart. This layer knows nothing
// about WhatsApp or notifications; it reads and writes a store and nothing else.
//
// Every operation is synchronous and deterministic: the same store and the same
// arguments always produce the same result, listings and search results are
// sorted, and the clock is injectable so callers can pin timestamps.

const REASON = {
  UNKNOWN_SUBJECT: 'unknown_subject',
  INVALID_KEY: 'invalid_key',
  INVALID_VALUE: 'invalid_value',
  NOT_FOUND: 'not_found',
};

let sharedStore = null;
function defaultStore() {
  if (!sharedStore) sharedStore = createFileStore();
  return sharedStore;
}

function resolveContext({ family, store, now } = {}) {
  return {
    family: family || loadRegistry(),
    store: store || defaultStore(),
    now: now || (() => new Date().toISOString()),
  };
}

function failure(reason, detail, extra = {}) {
  return { ok: false, reason, detail, ...extra };
}

// Keys are normalized so "Allergy", "allergy" and " allergy " are one fact.
function normalizeKey(key) {
  return typeof key === 'string' ? key.trim().toLowerCase() : '';
}

// Inactive members are deliberately allowed: memory is a record, not an action
// aimed at someone. Deactivating a member must not make their history
// unreachable — the result flags `active` so callers can decide for themselves.
// (Contrast the notification engine, where an inactive member is skipped
// because sending them a message would be an action.)
function resolveSubject(family, subjectId) {
  const member = findById(family, subjectId);
  if (!member) {
    return {
      error: failure(
        REASON.UNKNOWN_SUBJECT,
        `No family member has the id "${subjectId}".`,
        { subjectId }
      ),
    };
  }
  return { member };
}

function readSubject(memory, subjectId) {
  return memory.subjects[subjectId] || {};
}

// Stores a fact. By default a second write to the same key replaces the first;
// with { append: true } the values accumulate into a list instead.
function remember(subjectId, key, value, options = {}) {
  const { family, store, now } = resolveContext(options);

  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return failure(REASON.INVALID_KEY, 'A fact needs a non-empty key.', { subjectId });
  }

  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return failure(REASON.INVALID_VALUE, 'A fact needs a non-empty value.', {
      subjectId,
      key: normalizedKey,
    });
  }

  const { member, error } = resolveSubject(family, subjectId);
  if (error) return error;

  const memory = store.load();
  const facts = readSubject(memory, subjectId);
  const existing = facts[normalizedKey];

  let stored = value;
  let mode = 'set';

  if (options.append && existing) {
    const previous = Array.isArray(existing.value) ? existing.value : [existing.value];
    stored = [...previous, value];
    mode = 'append';
  }

  memory.subjects[subjectId] = {
    ...facts,
    [normalizedKey]: { value: stored, updatedAt: now() },
  };
  store.save(memory);

  return {
    ok: true,
    subjectId,
    key: normalizedKey,
    value: stored,
    mode,
    overwritten: mode === 'set' && Boolean(existing),
    active: member.active,
  };
}

// Reads one fact back. A key that was never stored is not an error — `found` is
// false and `value` is null.
function recall(subjectId, key, options = {}) {
  const { family, store } = resolveContext(options);

  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return failure(REASON.INVALID_KEY, 'A fact needs a non-empty key.', { subjectId });
  }

  const { member, error } = resolveSubject(family, subjectId);
  if (error) return error;

  const fact = readSubject(store.load(), subjectId)[normalizedKey];
  if (!fact) {
    return {
      ok: true,
      found: false,
      subjectId,
      key: normalizedKey,
      value: null,
      active: member.active,
    };
  }

  return {
    ok: true,
    found: true,
    subjectId,
    key: normalizedKey,
    value: fact.value,
    updatedAt: fact.updatedAt,
    active: member.active,
  };
}

// Removes one fact. Forgetting something that was never stored is not an error.
function forget(subjectId, key, options = {}) {
  const { family, store } = resolveContext(options);

  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return failure(REASON.INVALID_KEY, 'A fact needs a non-empty key.', { subjectId });
  }

  const { member, error } = resolveSubject(family, subjectId);
  if (error) return error;

  const memory = store.load();
  const facts = readSubject(memory, subjectId);

  if (!facts[normalizedKey]) {
    return { ok: true, forgotten: false, subjectId, key: normalizedKey, active: member.active };
  }

  const remaining = { ...facts };
  delete remaining[normalizedKey];

  // Drop the subject entirely once nothing is remembered about them, so the
  // store does not accumulate empty shells.
  if (Object.keys(remaining).length === 0) delete memory.subjects[subjectId];
  else memory.subjects[subjectId] = remaining;

  store.save(memory);

  return { ok: true, forgotten: true, subjectId, key: normalizedKey, active: member.active };
}

// Simple case-insensitive keyword matching over the key and the value.
//
// Search is expressed as a matcher so the strategy can be replaced — a vector
// or AI-backed matcher can be passed in as `options.matcher` without changing
// what search() accepts or returns.
function keywordMatcher(query, fact) {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;

  const haystack = [fact.key, JSON.stringify(fact.value)].join(' ').toLowerCase();
  return haystack.includes(needle);
}

// Flattens the store into facts, sorted by subject then key, so results are
// stable regardless of insertion order.
function allFacts(memory) {
  const facts = [];
  for (const subjectId of Object.keys(memory.subjects).sort()) {
    const subject = memory.subjects[subjectId];
    for (const key of Object.keys(subject).sort()) {
      facts.push({ subjectId, key, value: subject[key].value, updatedAt: subject[key].updatedAt });
    }
  }
  return facts;
}

function search(query, options = {}) {
  const { store } = resolveContext(options);
  const matcher = options.matcher || keywordMatcher;

  if (typeof query !== 'string' || query.trim() === '') {
    return { ok: true, query: '', matches: [] };
  }

  const facts = allFacts(store.load());
  const subjectFilter = options.subjectId;

  const matches = facts
    .filter((fact) => (subjectFilter ? fact.subjectId === subjectFilter : true))
    .filter((fact) => matcher(query, fact));

  return { ok: true, query, matches };
}

// Everything remembered about one subject, sorted by key.
function listSubject(subjectId, options = {}) {
  const { family, store } = resolveContext(options);

  const { member, error } = resolveSubject(family, subjectId);
  if (error) return error;

  const facts = allFacts(store.load()).filter((fact) => fact.subjectId === subjectId);
  return { ok: true, subjectId, facts, active: member.active };
}

// Everything remembered, for a whole-store overview.
function listAll(options = {}) {
  const { store } = resolveContext(options);
  return { ok: true, facts: allFacts(store.load()) };
}

module.exports = {
  REASON,
  remember,
  recall,
  forget,
  search,
  listSubject,
  listAll,
  keywordMatcher,
};
