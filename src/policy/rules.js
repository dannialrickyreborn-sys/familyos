// The single place permissions are decided. Nothing else in FamilyOS compares a
// role: capabilities declare which action they perform, and this table says who
// may perform it.
//
// A rule is either:
//   * an array of roles — anyone with one of those roles may act; or
//   * { self, others } — the actor's own record versus somebody else's, which
//     is how "remember about yourself" differs from "remember about others".
//
// Actions absent from this table are denied. Failing closed means a capability
// cannot accidentally become public by declaring an action nobody defined.

const ROLES = ['owner', 'parent', 'sibling', 'child', 'guest'];

const EVERYONE = [...ROLES];
const ADULTS = ['owner', 'parent'];

const RULES = {
  // Anyone in the family can ask what FamilyOS is and whether it is healthy.
  'system.help': EVERYONE,
  'system.status': EVERYONE,
  'system.ping': EVERYONE,

  // Reading who is in the family is open; changing it is not.
  'registry.read': EVERYONE,
  'registry.modify': ['owner'],

  // Memory: reading is open, writing about yourself is open, writing about
  // someone else is not. Forgetting is restricted outright — losing a fact is
  // harder to undo than adding one.
  'memory.recall': EVERYONE,
  'memory.remember': { self: EVERYONE, others: ADULTS },
  'memory.forget': ADULTS,

  // Notifications: messaging yourself is open, messaging another member is not,
  // and messaging the whole family is the owner's call.
  'notification.notify': { self: EVERYONE, others: ADULTS },
  'notification.notifyAll': ['owner'],
};

function actions() {
  return Object.keys(RULES).sort();
}

function ruleFor(action) {
  return Object.prototype.hasOwnProperty.call(RULES, action) ? RULES[action] : null;
}

module.exports = { ROLES, EVERYONE, RULES, actions, ruleFor };
