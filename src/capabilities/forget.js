const { register } = require('./registry');
const { forget } = require('../memory/engine');

function resolveSubject(token, member) {
  return !token || token.toLowerCase() === 'me' ? member.id : token;
}

register({
  id: 'forget',
  command: 'forget',
  aliases: [],
  description: 'forget a fact: /forget <who|me> <key>',
  action: 'memory.forget',
  execute: ({ member, args }) => {
    const [who, ...keyParts] = args;
    const key = keyParts.join(' ');

    if (!who || !key) return 'Usage: /forget <member-id|me> <key>';

    const subjectId = resolveSubject(who, member);
    const result = forget(subjectId, key);

    if (!result.ok) return `Could not forget that: ${result.detail}`;
    if (!result.forgotten) return `Nothing was remembered for ${subjectId} under "${result.key}".`;

    return `Forgot ${result.key} for ${subjectId}.`;
  },
});
