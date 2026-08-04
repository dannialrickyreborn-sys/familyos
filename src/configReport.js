const { getConfig } = require('./config');

function mask(value) {
  if (!value) return '(not set)';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function runConfig() {
  const config = getConfig();

  console.log('FamilyOS Configuration\n');
  console.log(`Timezone: ${config.timezone}`);
  console.log(`Notion token: ${mask(config.notionToken)}`);
  console.log('Databases:');
  for (const [name, id] of Object.entries(config.databases)) {
    console.log(`  ${name}: ${id || '(not set)'}`);
  }
  console.log(`Brief transport: ${config.briefTransport}`);
  console.log(`WhatsApp target: ${config.whatsappTarget || '(not set)'}`);
}

module.exports = { runConfig };
