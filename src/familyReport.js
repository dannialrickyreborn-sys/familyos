const { loadRegistry } = require('./familyRegistry');

// Local terminal view of the registry. Unlike the /family chat command this
// includes inactive members and phone numbers, which should not be broadcast
// into a chat but are exactly what you need when editing the registry.
function runFamily() {
  const registry = loadRegistry();

  console.log('FamilyOS Family Registry\n');

  if (registry.members.length === 0) {
    console.log('No members registered.');
    return;
  }

  const widths = {
    id: Math.max(2, ...registry.members.map((m) => m.id.length)),
    name: Math.max(4, ...registry.members.map((m) => m.name.length)),
    phone: Math.max(5, ...registry.members.map((m) => m.phone.length)),
    role: Math.max(4, ...registry.members.map((m) => m.role.length)),
  };

  const row = (id, name, phone, role, active) =>
    `${id.padEnd(widths.id)}  ${name.padEnd(widths.name)}  ${phone.padEnd(widths.phone)}  ${role.padEnd(widths.role)}  ${active}`;

  console.log(row('ID', 'NAME', 'PHONE', 'ROLE', 'ACTIVE'));
  for (const member of registry.members) {
    console.log(row(member.id, member.name, member.phone, member.role, member.active ? 'yes' : 'no'));
  }

  const active = registry.members.filter((m) => m.active).length;
  console.log(`\n${active} active of ${registry.members.length} registered.`);
}

module.exports = { runFamily };
