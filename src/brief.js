const { getConfig } = require('./config');
const { queryDatabase } = require('./notion');
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

async function fetchPages(token, databaseId) {
  const result = await queryDatabase(token, databaseId, { page_size: 100 });
  return result.results || [];
}

async function buildTasksSection(token, databaseId, today) {
  const pages = await fetchPages(token, databaseId);
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
  const pages = await fetchPages(token, databaseId);
  const events = [];

  for (const page of pages) {
    const date = getDateValue(page);
    if (date && date.slice(0, 10) === today) events.push(getTitle(page));
  }

  return events;
}

async function buildBillsSection(token, databaseId, today) {
  const pages = await fetchPages(token, databaseId);
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
  const pages = await fetchPages(token, databaseId);
  const recent = [...pages]
    .sort((a, b) => new Date(b.last_edited_time) - new Date(a.last_edited_time))
    .slice(0, 5)
    .map(getTitle);

  return { total: pages.length, recent };
}

function printList(items) {
  if (items.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const item of items) console.log(`  - ${item}`);
}

async function runBrief() {
  const config = getConfig();

  if (!config.notionToken) {
    console.error('NOTION_TOKEN is not set. Run "npm run doctor" first.');
    process.exitCode = 1;
    return;
  }

  const today = todayInTimezone(config.timezone);

  console.log(`FamilyOS — Today's Executive Brief`);
  console.log(`${today} (${config.timezone})\n`);

  if (config.databases.tasks) {
    const { overdue, dueToday } = await buildTasksSection(
      config.notionToken,
      config.databases.tasks,
      today
    );
    console.log('Overdue Tasks:');
    printList(overdue);
    console.log('\nTasks Due Today:');
    printList(dueToday);
  } else {
    console.log('Tasks: not configured (NOTION_DB_TASKS)');
  }

  console.log('');

  if (config.databases.calendar) {
    const events = await buildCalendarSection(
      config.notionToken,
      config.databases.calendar,
      today
    );
    console.log("Today's Calendar:");
    printList(events);
  } else {
    console.log('Calendar: not configured (NOTION_DB_CALENDAR)');
  }

  console.log('');

  if (config.databases.bills) {
    const dueSoon = await buildBillsSection(
      config.notionToken,
      config.databases.bills,
      today
    );
    console.log('Bills Due Within 7 Days:');
    printList(dueSoon);
  } else {
    console.log('Bills: not configured (NOTION_DB_BILLS)');
  }

  console.log('');

  if (config.databases.documents) {
    const { total, recent } = await buildDocumentsSection(
      config.notionToken,
      config.databases.documents
    );
    console.log(`Documents: ${total} tracked. Recently updated:`);
    printList(recent);
  } else {
    console.log('Documents: not configured (NOTION_DB_DOCUMENTS)');
  }
}

module.exports = { runBrief };
