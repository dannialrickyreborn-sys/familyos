const { getConfig } = require('./config');
const { getCurrentUser, getDatabase } = require('./notion');
const { readSessionInfo } = require('./whatsappSession');

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
    credentialsCheck = {
      ok: false,
      label: 'WhatsApp credentials',
      detail: 'Skipped — no session',
    };
  } else if (session.error) {
    credentialsCheck = {
      ok: false,
      label: 'WhatsApp credentials',
      detail: `Unreadable: ${session.error}`,
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
      label: 'WhatsApp reachable',
      detail: 'Skipped — not linked',
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

async function runDoctor() {
  const config = getConfig();
  const checks = [];

  checks.push(checkNode());
  checks.push(checkEnvironment(config));
  checks.push(await checkNotionToken(config));
  checks.push(await checkNotionConnection(config));
  checks.push(...(await checkDatabases(config)));
  checks.push(...(await checkWhatsapp()));

  console.log('FamilyOS Doctor\n');

  for (const check of checks) {
    const mark = check.ok ? 'OK  ' : 'FAIL';
    console.log(`[${mark}] ${check.label} — ${check.detail}`);
  }

  const failures = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failures}/${checks.length} checks passed.`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

module.exports = { runDoctor };
