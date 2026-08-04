#!/usr/bin/env node

const { runDoctor } = require('../src/doctor');
const { runBrief } = require('../src/brief');

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

  console.log('Usage: familyos <command>\n');
  console.log('Commands:');
  console.log('  doctor   Check environment and Notion setup');
  console.log('  brief    Print today\'s executive brief');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`familyos: ${err.message}`);
  process.exitCode = 1;
});
