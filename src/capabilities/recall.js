const { register } = require('./registry');
const { recall } = require('../memory/engine');

function resolveSubject(token, member) {
  return !token || token.toLowerCase() === 'me' ? member.id : token;
}

function formatValue(value) {
  return Array.isArray(value) ? value.map((entry) => `- ${entry}`).join('\n') : String(value);
}

register({
  id: 'recall',
  command: 'recall',
  aliases: ['what'],
  description: 'look up a fact: /recall <who|me> <key>',
  action: 'memory.recall',
  execute: ({ member, args }) => {
    const [who, ...keyParts] = args;
    const key = keyParts.join(' ');

    if (!who || !key) return 'Usage: /recall <member-id|me> <key>';

    const subjectId = resolveSubject(who, member);
    const result = recall(subjectId, key);

    if (!result.ok) return `Could not look that up: ${result.detail}`;
    if (!result.found) return `Nothing remembered for ${subjectId} under "${result.key}".`;

    return `${result.key} for ${subjectId}:\n${formatValue(result.value)}`;
  },
});
