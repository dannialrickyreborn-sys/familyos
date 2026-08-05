const { register } = require('./registry');

// Built from the registry, so a newly added capability appears here without
// this file being touched.
register({
  id: 'help',
  command: 'help',
  aliases: ['commands'],
  description: 'show this list',
  action: 'system.help',
  execute: ({ capabilities }) => {
    const width = Math.max(...capabilities.all().map((c) => c.command.length));
    const lines = capabilities
      .all()
      .map((c) => `/${c.command.padEnd(width)}  ${c.description}`);

    return ['FamilyOS commands', '', ...lines].join('\n');
  },
});
