#!/usr/bin/env node

const { runDoctor } = require('../src/doctor');
const { runBrief } = require('../src/brief');
const { runConfig } = require('../src/configReport');

function getFlagValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

async function main() {
  const command = process.argv[2];

  if (command === 'doctor') {
    await runDoctor();
    return;
  }

  if (command === 'brief') {
    const transportName = getFlagValue(process.argv, '--transport');
    await runBrief(transportName);
    return;
  }

  if (command === 'config') {
    runConfig();
    return;
  }

  if (command === 'whatsapp:link') {
    const { link } = require('../src/transports/whatsapp');
    await link();
    return;
  }

  console.log('Usage: familyos <command>\n');
  console.log('Commands:');
  console.log('  doctor         Check environment, Notion, and WhatsApp link status');
  console.log('  brief [--transport console|whatsapp]   Print (or send) today\'s executive brief');
  console.log('  config         Show current configuration (secrets masked)');
  console.log('  whatsapp:link  Link this device to a personal WhatsApp account (scan QR code)');
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`familyos: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    // Baileys keeps its WebSocket/timers alive even after sock.end(),
    // which would otherwise leave the process hanging after a one-shot command.
    process.exit(process.exitCode ?? 0);
  });
