const { queryDatabase } = require('./notion');

// Single point of access for reading page content out of any configured
// Notion database — keeps the page_size/query shape in one place so
// consumers (brief, future capabilities) never duplicate it.
async function getDatabasePages(token, databaseId) {
  const result = await queryDatabase(token, databaseId, { page_size: 100 });
  return result.results || [];
}

module.exports = { getDatabasePages };
