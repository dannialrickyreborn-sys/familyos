const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./atomicJson');
const { normalizePhone } = require('./phone');
const { ROLES } = require('./policy/rules');
const { REGISTRY_PATH, EXAMPLE_PATH, parseRegistry, registryExists } = require('./familyRegistry');
const { readSessionInfo } = require('./whatsappSession');
const { isInteractive, withPrompt, chooseOption } = require('./prompt');

const MIN_NODE_MAJOR = 18;
const ENV_PATH = path.join(process.cwd(), '.env');
const ENV_EXAMPLE_PATH = path.join(process.cwd(), '.env.example');

function heading(text) {
  console.log(`\n${text}\n${'-'.repeat(text.length)}`);
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    throw new Error(
      `FamilyOS needs Node ${MIN_NODE_MAJOR} or newer; this is v${process.versions.node}. In Termux: pkg install nodejs-lts`
    );
  }
  console.log(`Node v${process.versions.node} — ok`);
}

// .env only matters for the Notion-backed brief. Creating it here means nobody
// has to know that, and leaving it empty is a perfectly working setup.
function ensureEnv() {
  if (fs.existsSync(ENV_PATH)) {
    console.log('.env — already present');
    return;
  }
  if (!fs.existsSync(ENV_EXAMPLE_PATH)) {
    console.log('.env — no template found, skipping (only needed for the Notion brief)');
    return;
  }
  fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
  console.log('.env — created from .env.example (optional; only the Notion brief uses it)');
}

// Asks until the answer is a valid international number, so a typo is caught
// here rather than by a silent non-delivery later.
async function askPhone(ask, label) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const answer = await ask(`  ${label} (with country code, e.g. +6281234567890): `);
    try {
      return normalizePhone(answer).e164;
    } catch (err) {
      console.log(`  ${err.message}`);
    }
  }
  throw new Error('Too many invalid phone numbers.');
}

async function askName(ask) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const answer = (await ask('  Name: ')).trim();
    if (answer) return answer;
    console.log('  A name is required.');
  }
  throw new Error('No name given.');
}

// Ids are generated from the name so nobody has to invent one, and stay unique.
function idFor(name, taken) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'member';

  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function askMember(ask, { first, taken }) {
  const name = await askName(ask);
  const phone = await askPhone(ask, 'WhatsApp number');

  // The first person set up owns the system; asking would only invite a wrong
  // answer on the very first question.
  const role = first
    ? 'owner'
    : await chooseOption(
        ask,
        '  Role:',
        ROLES.map((value) => ({ value, label: value })),
        3
      );

  if (first) console.log('  Role: owner (the person who sets FamilyOS up)');

  return { id: idFor(name, taken), name, phone, role, active: true };
}

// Builds the registry by asking, instead of making someone hand-edit JSON.
async function buildRegistry(ask) {
  const members = [];
  const taken = new Set();
  const numbers = new Set();

  for (;;) {
    const position = members.length === 0 ? 'yourself' : `family member ${members.length + 1}`;
    console.log(`\nAdding ${position}:`);

    const member = await askMember(ask, { first: members.length === 0, taken });

    if (numbers.has(member.phone)) {
      console.log(`  ${member.phone} is already registered — skipping.`);
    } else {
      members.push(member);
      taken.add(member.id);
      numbers.add(member.phone);
      console.log(`  Added ${member.name} (${member.id}) as ${member.role}.`);
    }

    const more = await ask('\nAdd another family member? [y/N]: ');
    if (!/^y(es)?$/i.test(more.trim())) break;
  }

  return { members };
}

function saveRegistry(registry) {
  // Validate through the real loader before writing, so setup can never produce
  // a file the rest of FamilyOS would reject.
  parseRegistry(JSON.stringify(registry));
  writeJsonAtomic(REGISTRY_PATH, registry, { label: 'family registry' });
  console.log(`\nSaved ${path.relative(process.cwd(), REGISTRY_PATH)} — ${registry.members.length} member(s).`);
}

function describeRegistry() {
  try {
    const registry = parseRegistry(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    return { ok: true, count: registry.members.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function ensureRegistry(ask) {
  if (registryExists()) {
    const existing = describeRegistry();

    if (existing.ok) {
      console.log(`Family registry — ${existing.count} member(s) already configured`);
      const replace = await ask('Replace it and start over? [y/N]: ');
      if (!/^y(es)?$/i.test(replace.trim())) return;
    } else {
      console.log(`Family registry — unusable: ${existing.error}`);
      console.log('Rebuilding it.');
    }
  } else {
    console.log(`Family registry — not set up yet (template: ${path.relative(process.cwd(), EXAMPLE_PATH)})`);
  }

  saveRegistry(await buildRegistry(ask));
}

async function ensureWhatsApp(ask) {
  const session = readSessionInfo();

  if (session.registered) {
    console.log(`WhatsApp — already linked${session.phone ? ` as ${session.phone}` : ''}`);
    return true;
  }

  console.log('WhatsApp — not linked yet');
  const now = await ask('Link WhatsApp now? [Y/n]: ');
  if (/^n(o)?$/i.test(now.trim())) {
    console.log('Skipped. Run "npm run whatsapp:link" when you are ready.');
    return false;
  }

  // Loaded here so a setup that skips linking never pays for the transport.
  const { link } = require('./transports/whatsapp');
  await link({});
  return readSessionInfo().registered;
}

function summarize({ linked }) {
  heading('Setup summary');

  const registry = describeRegistry();
  console.log(`Family registry: ${registry.ok ? `${registry.count} member(s)` : `NOT READY — ${registry.error}`}`);
  console.log(`WhatsApp:        ${linked ? 'linked' : 'not linked'}`);

  if (registry.ok && linked) {
    console.log('\nFamilyOS is ready. Start it with:\n\n    npm run listen\n');
    console.log('Then message this WhatsApp account from a registered number:');
    console.log('    /ping    /help    /status\n');
    return true;
  }

  console.log('\nStill to do:');
  if (!registry.ok) console.log('  npm run setup          (finish the family registry)');
  if (!linked) console.log('  npm run whatsapp:link  (pair WhatsApp)');
  console.log('');
  return false;
}

async function runSetup() {
  heading('FamilyOS setup');

  checkNode();
  ensureEnv();

  if (!isInteractive()) {
    console.log('\nThis terminal is not interactive, so setup cannot ask questions.');
    console.log('Run "npm run setup" from a normal terminal, or configure manually:');
    console.log(`  1. cp ${path.relative(process.cwd(), EXAMPLE_PATH)} ${path.relative(process.cwd(), REGISTRY_PATH)}`);
    console.log('     then edit it: name, WhatsApp number, and role for each member');
    console.log('  2. npm run whatsapp:link');
    console.log('  3. npm run listen');
    process.exitCode = 1;
    return;
  }

  const linked = await withPrompt(async ({ ask }) => {
    heading('Who is in the family?');
    await ensureRegistry(ask);

    heading('WhatsApp');
    return ensureWhatsApp(ask);
  });

  const ready = summarize({ linked });

  if (!ready) {
    process.exitCode = 1;
    return;
  }

  const start = await withPrompt(({ ask }) => ask('Start the listener now? [Y/n]: '));
  if (/^n(o)?$/i.test(start.trim())) {
    console.log('Not started. Run "npm run listen" when you are ready.');
    return;
  }

  const { runListen } = require('./listenCommand');
  await runListen();
}

module.exports = { runSetup, idFor, buildRegistry, saveRegistry, describeRegistry };
