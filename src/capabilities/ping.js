const { register } = require('./registry');

register({
  id: 'ping',
  command: 'ping',
  aliases: [],
  description: 'check that FamilyOS is responding',
  permissions: [],
  execute: ({ member }) => `pong — hello ${member.name}.`,
});
