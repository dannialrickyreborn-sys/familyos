const { register } = require('./registry');
const { remember } = require('../memory/engine');

// "me" saves the sender's own facts, which is the common case in a chat.
function resolveSubject(token, member) {
  return !token || token.toLowerCase() === 'me' ? member.id : token;
}

register({
  id: 'remember',
  command: 'remember',
  aliases: ['note'],
  description: 'remember a fact: /remember <who|me> <key> <value>',
  permissions: [],
  execute: ({ member, args }) => {
    const [who, key, ...rest] = args;
    const value = rest.join(' ');

    if (!who || !key || !value) {
      return 'Usage: /remember <member-id|me> <key> <value>';
    }

    const subjectId = resolveSubject(who, member);
    const result = remember(subjectId, key, value);

    if (!result.ok) return `Could not remember that: ${result.detail}`;

    const note = result.overwritten ? ' (replaced the previous value)' : '';
    return `Remembered ${result.key} for ${subjectId}${note}.`;
  },
});
