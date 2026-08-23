const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

async function notionRequest(token, method, path, body) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

function getCurrentUser(token) { return notionRequest(token, 'GET', '/users/me'); }
function getDatabase(token, databaseId) { return notionRequest(token, 'GET', `/databases/${databaseId}`); }
function queryDatabase(token, databaseId, body = {}) { return notionRequest(token, 'POST', `/databases/${databaseId}/query`, body); }
function createPage(token, parentDatabaseId, properties) {
  return notionRequest(token, 'POST', '/pages', { parent: { database_id: parentDatabaseId }, properties });
}

module.exports = { getCurrentUser, getDatabase, queryDatabase, createPage };
