#!/usr/bin/env node

const { runDoctor } = require('../src/doctor');
const { runBrief } = require('../src/brief');
const { runConfig } = require('../src/configReport');

async function main() {
  const command = process.argv[2];

  if (command === 'doctor') {
    await runDoctor();
    return;
  }

  if (command === 'brief') {
    await runBrief();
    return;
  }

  if (command === 'config') {
    runConfig();
    return;
  }

  console.log('Usage: familyos <command>\n');
  console.log('Commands:');
  console.log('  doctor   Check environment and Notion setup');
  console.log('  brief    Print today\'s executive brief');
  console.log('  config   Show current configuration (secrets masked)');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`familyos: ${err.message}`);
  process.exitCode = 1;
});
