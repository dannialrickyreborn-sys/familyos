const { loadEnv } = require('./env');

loadEnv();

function getConfig() {
  return {
    notionToken: process.env.NOTION_TOKEN || '',
    timezone: process.env.TIMEZONE || 'UTC',
    databases: {
      tasks: process.env.NOTION_DB_TASKS || '',
      calendar: process.env.NOTION_DB_CALENDAR || '',
      bills: process.env.NOTION_DB_BILLS || '',
      documents: process.env.NOTION_DB_DOCUMENTS || '',
    },
  };
}

module.exports = { getConfig };
