const { getConfig } = require('./config');
const { getCurrentUser, getDatabase } = require('./notion');
const { readSessionInfo } = require('./whatsappSession');
const { registryExists, loadRegistry, activeMembers } = require('./familyRegistry');

const MIN_NODE_MAJOR = 18;

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = major >= MIN_NODE_MAJOR;
  return {
    ok,
    label: 'Node.js version',
    detail: ok
      ? `v${process.versions.node} (>= ${MIN_NODE_MAJOR} required)`
      : `v${process.versions.node} — please upgrade to >= ${MIN_NODE_MAJOR}`,
  };
}

function checkEnvironment(config) {
  const missing = [];
  if (!config.notionToken) missing.push('NOTION_TOKEN');

  return {
    ok: missing.length === 0,
    label: 'Environment (.env)',
    detail:
      missing.length === 0
        ? 'Required variables are set'
        : `Missing: ${missing.join(', ')}`,
  };
}

async function checkNotionToken(config) {
  if (!config.notionToken) {
    return { ok: false, label: 'Notion token', detail: 'NOTION_TOKEN not set' };
  }

  try {
    await getCurrentUser(config.notionToken);
    return { ok: true, label: 'Notion token', detail: 'Valid' };
  } catch (err) {
    return { ok: false, label: 'Notion token', detail: err.message };
  }
}

async function checkNotionConnection(config) {
  if (!config.notionToken) {
    return { ok: false, label: 'Notion connection', detail: 'Skipped — no token' };
  }

  try {
    const user = await getCurrentUser(config.notionToken);
    const name = user.name || user.bot?.owner?.workspace_name || 'connected';
    return { ok: true, label: 'Notion connection', detail: `Reached API as "${name}"` };
  } catch (err) {
    return { ok: false, label: 'Notion connection', detail: err.message };
  }
}

async function checkDatabases(config) {
  const results = [];
  const entries = Object.entries(config.databases);

  for (const [name, id] of entries) {
    if (!id) {
      results.push({ ok: false, label: `Database: ${name}`, detail: 'Not configured' });
      continue;
    }

    if (!config.notionToken) {
      results.push({ ok: false, label: `Database: ${name}`, detail: 'Skipped — no token' });
      continue;
    }

    try {
      const db = await getDatabase(config.notionToken, id);
      const title = db.title?.map((t) => t.plain_text).join('') || '(untitled)';
      results.push({ ok: true, label: `Database: ${name}`, detail: `Reachable — "${title}"` });
    } catch (err) {
      results.push({ ok: false, label: `Database: ${name}`, detail: err.message });
    }
  }

  return results;
}

async function checkWhatsapp() {
  const session = readSessionInfo();

  const sessionCheck = {
    ok: session.exists,
    label: 'WhatsApp session',
    detail: session.exists
      ? 'Present'
      : 'Missing — run "npm run whatsapp:link"',
  };

  let credentialsCheck;
  if (!session.exists) {
    // Nothing to check yet: the missing session above is the one real problem,
    // so this is reported as not-yet-checkable rather than a second failure.
    credentialsCheck = {
      ok: false,
      optional: true,
      label: 'WhatsApp credentials',
      detail: 'Not checked — no session yet',
    };
  } else if (session.error) {
    credentialsCheck = {
      ok: false,
      label: 'WhatsApp credentials',
      detail: `Unreadable: ${session.error}`,
    };
  } else if (session.partial) {
    credentialsCheck = {
      ok: false,
      label: 'WhatsApp credentials',
      detail:
        'Incomplete pairing — claims an identity that was never registered (causes failure 401). "npm run whatsapp:link" resets it automatically',
    };
  } else if (!session.registered) {
    credentialsCheck = {
      ok: false,
      label: 'WhatsApp credentials',
      detail: 'Session exists but pairing never completed — run "npm run whatsapp:link"',
    };
  } else {
    credentialsCheck = {
      ok: true,
      label: 'WhatsApp credentials',
      detail: `Valid${session.phone ? ` (${session.phone})` : ''}`,
    };
  }

  let reachableCheck;
  if (!credentialsCheck.ok) {
    reachableCheck = {
      ok: false,
      optional: true,
      label: 'WhatsApp reachable',
      detail: 'Not checked — not linked yet',
    };
  } else {
    // Only opens a socket when there are valid credentials to open it with.
    const { checkConnection } = require('./transports/whatsapp');
    const result = await checkConnection();
    reachableCheck = {
      ok: result.ok,
      label: 'WhatsApp reachable',
      detail: result.message,
    };
  }

  return [sessionCheck, credentialsCheck, reachableCheck];
}

// The family registry is what makes FamilyOS usable at all, so it is checked
// here rather than only surfacing when a message arrives.
function checkRegistry() {
  if (!registryExists()) {
    return {
      ok: false,
      label: 'Family registry',
      detail: 'Not set up — run "npm run setup"',
    };
  }

  try {
    const registry = loadRegistry();
    const active = activeMembers(registry).length;
    return active > 0
      ? { ok: true, label: 'Family registry', detail: `${active} active member(s)` }
      : { ok: false, label: 'Family registry', detail: 'No active members — run "npm run setup"' };
  } catch (err) {
    return { ok: false, label: 'Family registry', detail: err.message };
  }
}

function print(title, checks) {
  console.log(`\n${title}`);
  for (const check of checks) {
    const mark = check.ok ? 'OK  ' : check.optional ? 'SKIP' : 'FAIL';
    console.log(`  [${mark}] ${check.label} — ${check.detail}`);
  }
}

// Notion powers the daily brief only. Reporting it as failure when it is simply
// not configured made a perfectly working WhatsApp setup look broken, so
// unconfigured optional checks are reported as skipped and never fail the run.
function optionalUnlessConfigured(configured, checks) {
  return configured ? checks : checks.map((check) => ({ ...check, optional: true }));
}

async function runDoctor() {
  const config = getConfig();

  const required = [checkNode(), checkRegistry(), ...(await checkWhatsapp())];

  const notionConfigured = Boolean(config.notionToken);
  const optional = optionalUnlessConfigured(notionConfigured, [
    checkEnvironment(config),
    await checkNotionToken(config),
    await checkNotionConnection(config),
    ...(await checkDatabases(config)),
  ]);

  console.log('FamilyOS Doctor');
  print('Required — WhatsApp assistant', required);
  print('Optional — Notion daily brief', optional);

  const failures = required.filter((check) => !check.ok && !check.optional);
  const optionalFailures = optional.filter((check) => !check.ok && !check.optional);

  if (failures.length === 0) {
    console.log('\nFamilyOS is ready. Start it with "npm run listen".');
  } else {
    console.log(`\n${failures.length} required check(s) failed:`);
    for (const check of failures) console.log(`  - ${check.label}: ${check.detail}`);
  }

  if (!notionConfigured) {
    console.log('\nNotion is not configured. That is fine — it only affects "npm run brief".');
  }

  if (failures.length > 0 || optionalFailures.length > 0) {
    process.exitCode = 1;
  }
}

module.exports = { runDoctor };
