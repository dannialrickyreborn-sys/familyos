#!/usr/bin/env node

const { runDoctor } = require('../src/doctor');
const { runBrief } = require('../src/brief');
const { runConfig } = require('../src/configReport');

function getFlagValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function getPositionals(argv, flagsWithValues) {
  const rest = argv.slice(3);
  const positionals = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (flagsWithValues.includes(rest[i])) { i += 1; continue; }
    if (rest[i].startsWith('--')) continue;
    positionals.push(rest[i]);
  }
  return positionals;
}

async function main() {
  const command = process.argv[2];
  if (command === 'doctor') { await runDoctor(); return; }
  if (command === 'brief') { await runBrief(getFlagValue(process.argv, '--transport')); return; }
  if (command === 'personalized-brief') { const { runPersonalizedBrief } = require('../src/personalizedBrief'); await runPersonalizedBrief(); return; }
  if (command === 'config') { runConfig(); return; }
  if (command === 'whatsapp:link') { const { link } = require('../src/transports/whatsapp'); await link({ method: getFlagValue(process.argv, '--method'), phone: getFlagValue(process.argv, '--phone') }); return; }
  if (command === 'whatsapp:status') { const { runStatus } = require('../src/whatsappStatus'); await runStatus(); return; }
  if (command === 'setup') { const { runSetup } = require('../src/setup'); await runSetup(); return; }
  if (command === 'family') { const { runFamily } = require('../src/familyReport'); runFamily(); return; }
  if (command === 'notify') { const { runNotify } = require('../src/notifyCommand'); await runNotify({ to: getFlagValue(process.argv, '--to'), all: process.argv.includes('--all'), strict: process.argv.includes('--strict'), message: getPositionals(process.argv, ['--to']).join(' ') }); return; }
  if (command === 'listen') { const { runListen } = require('../src/listenCommand'); await runListen(); return; }
  if (command === 'message') { const { runMessage } = require('../src/messageCommand'); runMessage({ from: getFlagValue(process.argv, '--from'), text: getPositionals(process.argv, ['--from']).join(' ') }); return; }

  console.log('Usage: familyos <command>\n');
  console.log('Commands:');
  console.log('  setup');
  console.log('  doctor');
  console.log('  brief [--transport console|whatsapp]');
  console.log('  personalized-brief   Send profile-based daily brief from Notion');
  console.log('  config');
  console.log('  whatsapp:link [--method qr|code] [--phone <number>]');
  console.log('  whatsapp:status');
  console.log('  family');
  console.log('  listen');
  console.log('  message --from <phone|jid> "<text>"');
  console.log('  notify (--to <member-id[,id]> | --all) [--strict] "<text>"');
  process.exitCode = 1;
}

main().catch((err) => { console.error(`familyos: ${err.message}`); process.exitCode = 1; }).finally(() => process.exit(process.exitCode ?? 0));
