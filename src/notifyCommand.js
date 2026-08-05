const { loadRegistry } = require('./familyRegistry');
const { notify, notifyMany, notifyAll } = require('./notifications/engine');

function describe(result) {
  if (result.ok && !result.skipped) return `sent    ${result.memberId} via ${result.channel}`;
  if (result.skipped) return `skipped ${result.memberId} — ${result.detail}`;
  return `FAILED  ${result.memberId} — ${result.detail} (${result.reason})`;
}

// Sends a notification by member id. Exists so the engine can be exercised on a
// real device; capabilities call the engine directly rather than shelling out.
async function runNotify({ to, all, message, strict }) {
  if (!message) {
    throw new Error('A message is required, e.g. familyos notify --to parent-1 "dinner is ready"');
  }
  if (!to && !all) {
    throw new Error('Specify --to <member-id[,member-id]> or --all.');
  }
  if (to && all) {
    throw new Error('Use either --to or --all, not both.');
  }

  const family = loadRegistry();
  const options = { family, strict };

  if (all) {
    const summary = await notifyAll(message, options);
    summary.results.forEach((result) => console.log(describe(result)));
    console.log(`\n${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed.`);
    if (!summary.ok) process.exitCode = 1;
    return;
  }

  const ids = to.split(',').map((id) => id.trim()).filter(Boolean);

  if (ids.length === 1) {
    const result = await notify(ids[0], message, options);
    console.log(describe(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  const summary = await notifyMany(ids, message, options);
  summary.results.forEach((result) => console.log(describe(result)));
  console.log(`\n${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed.`);
  if (!summary.ok) process.exitCode = 1;
}

module.exports = { runNotify };
