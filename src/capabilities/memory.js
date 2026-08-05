const { register } = require('./registry');
const { search, listSubject, listAll } = require('../memory/engine');

function describe(fact) {
  const value = Array.isArray(fact.value) ? fact.value.join('; ') : fact.value;
  return `- ${fact.subjectId} / ${fact.key}: ${value}`;
}

function render(title, facts) {
  if (facts.length === 0) return `${title}\n\nNothing remembered yet.`;
  return [title, '', ...facts.map(describe)].join('\n');
}

register({
  id: 'memory',
  command: 'memory',
  aliases: ['memories'],
  description: 'list or search memory: /memory [member-id | query]',
  action: 'memory.recall',
  execute: ({ args }) => {
    const term = args.join(' ').trim();

    if (!term) return render('Everything remembered', listAll().facts);

    // A bare member id lists that member; anything else is a keyword search.
    const asSubject = listSubject(term);
    if (asSubject.ok) return render(`Remembered about ${term}`, asSubject.facts);

    const found = search(term);
    return render(`Memory matching "${found.query}"`, found.matches);
  },
});
