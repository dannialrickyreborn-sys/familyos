const { register } = require('./registry');
const { remember } = require('../memory/engine');
const { authorize } = require('../policy/engine');

// "me" saves the sender's own facts, which is the common case in a chat.
function resolveSubject(token, member) {
  return !token || token.toLowerCase() === 'me' ? member.id : token;
}

register({
  id: 'remember',
  command: 'remember',
  aliases: ['note'],
  description: 'remember a fact: /remember <who|me> <key> <value>',
  action: 'memory.remember',
  execute: ({ member, args }) => {
    const [who, key, ...rest] = args;
    const value = rest.join(' ');

    if (!who || !key || !value) {
      return 'Usage: /remember <member-id|me> <key> <value>';
    }

    const subjectId = resolveSubject(who, member);

    // The runtime already checked that this actor may remember something at
    // all. Whose facts they may write is a decision about a resource, so the
    // Policy Engine is asked again with the subject. No role is inspected here.
    const decision = authorize(member, 'memory.remember', { subjectId });
    if (!decision.allow) return `Not allowed: ${decision.detail}`;

    const result = remember(subjectId, key, value);

    if (!result.ok) return `Could not remember that: ${result.detail}`;

    const note = result.overwritten ? ' (replaced the previous value)' : '';
    return `Remembered ${result.key} for ${subjectId}${note}.`;
  },
});
