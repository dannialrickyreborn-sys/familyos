const { getConfig } = require('./config');
const { getDatabasePages } = require('./databases');
const { getTransport } = require('./transport');
const {
  getTitle,
  getDateValue,
  getStatusName,
  getCheckboxValue,
} = require('./properties');

function todayInTimezone(timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

function addDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isDone(page) {
  const status = getStatusName(page);
  if (status) return /done|complete/i.test(status);
  return getCheckboxValue(page);
}

function formatList(items) {
  return items.length === 0 ? ['  (none)'] : items.map((item) => `  - ${item}`);
}

async function buildTasksSection(token, databaseId, today) {
  const pages = await getDatabasePages(token, databaseId);
  const overdue = [];
  const dueToday = [];

  for (const page of pages) {
    if (isDone(page)) continue;
    const date = getDateValue(page);
    if (!date) continue;
    const day = date.slice(0, 10);
    if (day < today) overdue.push(getTitle(page));
    else if (day === today) dueToday.push(getTitle(page));
  }

  return { overdue, dueToday };
}

async function buildCalendarSection(token, databaseId, today) {
  const pages = await getDatabasePages(token, databaseId);
  const events = [];

  for (const page of pages) {
    const date = getDateValue(page);
    if (date && date.slice(0, 10) === today) events.push(getTitle(page));
  }

  return events;
}

async function buildBillsSection(token, databaseId, today) {
  const pages = await getDatabasePages(token, databaseId);
  const weekAhead = addDays(today, 7);
  const dueSoon = [];

  for (const page of pages) {
    if (getCheckboxValue(page)) continue; // already paid
    const date = getDateValue(page);
    if (!date) continue;
    const day = date.slice(0, 10);
    if (day <= weekAhead) dueSoon.push(getTitle(page));
  }

  return dueSoon;
}

async function buildDocumentsSection(token, databaseId) {
  const pages = await getDatabasePages(token, databaseId);
  const recent = [...pages]
    .sort((a, b) => new Date(b.last_edited_time) - new Date(a.last_edited_time))
    .slice(0, 5)
    .map(getTitle);

  return { total: pages.length, recent };
}

// Builds the brief as plain text, independent of how it gets delivered —
// terminal output today, any other transport (e.g. WhatsApp) later just
// needs to take this string and send it somewhere.
async function buildBrief(config) {
  const today = todayInTimezone(config.timezone);
  const lines = [];

  lines.push("FamilyOS — Today's Executive Brief");
  lines.push(`${today} (${config.timezone})`);
  lines.push('');

  if (config.databases.tasks) {
    const { overdue, dueToday } = await buildTasksSection(
      config.notionToken,
      config.databases.tasks,
      today
    );
    lines.push('Overdue Tasks:', ...formatList(overdue), '');
    lines.push('Tasks Due Today:', ...formatList(dueToday));
  } else {
    lines.push('Tasks: not configured (NOTION_DB_TASKS)');
  }
  lines.push('');

  if (config.databases.calendar) {
    const events = await buildCalendarSection(
      config.notionToken,
      config.databases.calendar,
      today
    );
    lines.push("Today's Calendar:", ...formatList(events));
  } else {
    lines.push('Calendar: not configured (NOTION_DB_CALENDAR)');
  }
  lines.push('');

  if (config.databases.bills) {
    const dueSoon = await buildBillsSection(
      config.notionToken,
      config.databases.bills,
      today
    );
    lines.push('Bills Due Within 7 Days:', ...formatList(dueSoon));
  } else {
    lines.push('Bills: not configured (NOTION_DB_BILLS)');
  }
  lines.push('');

  if (config.databases.documents) {
    const { total, recent } = await buildDocumentsSection(
      config.notionToken,
      config.databases.documents
    );
    lines.push(`Documents: ${total} tracked. Recently updated:`, ...formatList(recent));
  } else {
    lines.push('Documents: not configured (NOTION_DB_DOCUMENTS)');
  }

  return lines.join('\n');
}

async function runBrief(transportName) {
  const config = getConfig();

  if (!config.notionToken) {
    console.error('NOTION_TOKEN is not set. Run "npm run doctor" first.');
    process.exitCode = 1;
    return;
  }

  const text = await buildBrief(config);
  const transport = getTransport(transportName || config.briefTransport);
  await transport.send(text, config);
}

module.exports = { runBrief, buildBrief };
