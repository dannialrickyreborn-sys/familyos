const { register } = require('./registry');
const { activeMembers } = require('../familyRegistry');

// Deliberately omits phone numbers: a chat reply can be forwarded or
// screenshotted. "familyos family" is the local view that shows them.
register({
  id: 'family',
  command: 'family',
  aliases: ['members'],
  description: 'list active family members',
  action: 'registry.read',
  execute: ({ family }) => {
    const members = activeMembers(family);
    if (members.length === 0) return 'No active family members are registered.';

    const lines = members.map((member) => `- ${member.name} (${member.id}) — ${member.role}`);
    return [`Family members (${members.length} active)`, '', ...lines].join('\n');
  },
});
