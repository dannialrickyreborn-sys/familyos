const { loadRegistry } = require('./familyRegistry');
const { listen } = require('./transports/whatsapp');

// Runs the inbound listener until interrupted. The registry is loaded per
// event, so members can be added or deactivated without restarting.
async function runListen() {
  // Fail fast on a broken registry rather than after connecting.
  const initial = loadRegistry();
  const active = initial.members.filter((member) => member.active).length;
  console.log(`FamilyOS listener — ${active} active member(s) registered.`);
  console.log('Press Ctrl+C to stop.\n');

  const controller = new AbortController();
  let stopping = false;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('\nStopping...');
    controller.abort();
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await listen({ loadFamily: loadRegistry, signal: controller.signal });
}

module.exports = { runListen };
