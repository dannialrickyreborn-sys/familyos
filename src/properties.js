// Small helpers for reading values out of a Notion page's properties
// without needing to know the exact property names in a given database.

function getTitle(page) {
  const prop = Object.values(page.properties).find((p) => p.type === 'title');
  if (!prop || !prop.title || prop.title.length === 0) return '(untitled)';
  return prop.title.map((t) => t.plain_text).join('');
}

function getFirstOfType(page, type) {
  const prop = Object.values(page.properties).find((p) => p.type === type);
  if (!prop) return null;
  return prop[type];
}

function getDateValue(page) {
  const date = getFirstOfType(page, 'date');
  return date ? date.start : null;
}

function getStatusName(page) {
  const status = getFirstOfType(page, 'status') || getFirstOfType(page, 'select');
  return status ? status.name : null;
}

function getCheckboxValue(page) {
  const value = getFirstOfType(page, 'checkbox');
  return value === null ? false : value;
}

function getNumberValue(page) {
  return getFirstOfType(page, 'number');
}

module.exports = {
  getTitle,
  getDateValue,
  getStatusName,
  getCheckboxValue,
  getNumberValue,
};
