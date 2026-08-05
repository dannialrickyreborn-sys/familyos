const fs = require('fs');
const path = require('path');
const { normalizePhone } = require('./phone');

// The single source of truth for who the family is. No phone number belongs in
// code or in any other file: everything that needs to identify a person looks
// them up here by id.
const REGISTRY_PATH = path.join(process.cwd(), 'configs', 'family.json');
const EXAMPLE_PATH = path.join(process.cwd(), 'configs', 'family.example.json');

const ROLES = ['admin', 'member'];

function fail(message) {
  throw new Error(`Family registry (${REGISTRY_PATH}): ${message}`);
}

// Validates one entry and returns it with the phone normalized, so callers can
// compare numbers without worrying how they were typed.
function normalizeMember(raw, index) {
  const where = `member #${index + 1}`;

  if (!raw || typeof raw !== 'object') fail(`${where} is not an object.`);

  for (const field of ['id', 'name', 'phone', 'role']) {
    if (typeof raw[field] !== 'string' || raw[field].trim() === '') {
      fail(`${where} is missing a non-empty "${field}".`);
    }
  }

  if (!/^[a-z0-9][a-z0-9_-]*$/.test(raw.id)) {
    fail(`${where} has id "${raw.id}"; use lowercase letters, digits, "-" or "_".`);
  }

  if (!ROLES.includes(raw.role)) {
    fail(`${where} ("${raw.id}") has role "${raw.role}"; expected one of ${ROLES.join(', ')}.`);
  }

  if (typeof raw.active !== 'boolean') {
    fail(`${where} ("${raw.id}") needs "active" to be true or false.`);
  }

  let phone;
  try {
    phone = normalizePhone(raw.phone);
  } catch (err) {
    fail(`${where} ("${raw.id}") has an invalid phone: ${err.message}`);
  }

  return {
    id: raw.id,
    name: raw.name.trim(),
    phone: phone.e164,
    digits: phone.digits,
    role: raw.role,
    active: raw.active,
  };
}

function parseRegistry(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    fail(`not valid JSON: ${err.message}`);
  }

  if (!data || !Array.isArray(data.members)) {
    fail('expected an object with a "members" array.');
  }

  const members = data.members.map(normalizeMember);

  const seenIds = new Set();
  const seenPhones = new Map();
  for (const member of members) {
    if (seenIds.has(member.id)) fail(`duplicate id "${member.id}".`);
    seenIds.add(member.id);

    const owner = seenPhones.get(member.digits);
    if (owner) fail(`"${member.id}" and "${owner}" share the same phone number.`);
    seenPhones.set(member.digits, member.id);
  }

  return { members };
}

function registryExists() {
  return fs.existsSync(REGISTRY_PATH);
}

function loadRegistry() {
  if (!registryExists()) {
    fail(`not found. Copy ${path.relative(process.cwd(), EXAMPLE_PATH)} to ${path.relative(process.cwd(), REGISTRY_PATH)} and fill it in.`);
  }
  return parseRegistry(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

function activeMembers(registry) {
  return registry.members.filter((member) => member.active);
}

// Only active members resolve: deactivating someone revokes their access
// without deleting the record of who they were.
function findByPhone(registry, phone) {
  let digits;
  try {
    digits = normalizePhone(phone).digits;
  } catch {
    return null;
  }
  return activeMembers(registry).find((member) => member.digits === digits) || null;
}

function findById(registry, id) {
  return registry.members.find((member) => member.id === id) || null;
}

module.exports = {
  REGISTRY_PATH,
  EXAMPLE_PATH,
  ROLES,
  registryExists,
  loadRegistry,
  parseRegistry,
  activeMembers,
  findByPhone,
  findById,
};
