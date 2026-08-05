const { ruleFor, actions } = require('./rules');

// Decides whether an actor may perform an action, optionally on a resource.
// This is the only code in FamilyOS that compares a role against a permission.
//
// Authorization happens in two stages, on purpose:
//   * the runtime asks without a resource before running a capability at all —
//     a coarse gate: could this actor ever perform this action?
//   * a capability that acts on a specific subject asks again with that
//     resource — the precise decision, e.g. remembering about yourself is
//     allowed where remembering about a sibling is not.
//
// Asking without a resource on a { self, others } rule allows the actor if
// either branch would, so the coarse gate never blocks something the precise
// check would have permitted.

const REASON = {
  UNKNOWN_ACTOR: 'unknown_actor',
  INACTIVE_ACTOR: 'inactive_actor',
  UNKNOWN_ACTION: 'unknown_action',
  PERMISSION_DENIED: 'permission_denied',
};

function deny(reason, detail, context) {
  return { ok: false, allow: false, deny: true, reason, detail, ...context };
}

function allow(detail, context) {
  return { ok: true, allow: true, deny: false, reason: null, detail, ...context };
}

// A resource may be a subject id, or an object carrying one.
function subjectOf(resource) {
  if (!resource) return null;
  if (typeof resource === 'string') return resource;
  return resource.subjectId || resource.memberId || resource.id || null;
}

function rolesFor(rule, actor, resource) {
  if (Array.isArray(rule)) return rule;

  const subject = subjectOf(resource);

  // No resource named: the coarse gate. Permit if either branch would.
  if (!subject) return [...new Set([...(rule.self || []), ...(rule.others || [])])];

  return subject === actor.id ? rule.self || [] : rule.others || [];
}

function authorize(actor, action, resource = null) {
  const context = {
    actor: actor && actor.id ? actor.id : null,
    action,
    resource: subjectOf(resource),
  };

  // An unresolved sender never reaches a capability, but the check is repeated
  // here so the policy engine is safe to call from anywhere.
  if (!actor || !actor.id || !actor.role) {
    return deny(REASON.UNKNOWN_ACTOR, 'The actor is not a known family member.', context);
  }

  if (actor.active === false) {
    return deny(
      REASON.INACTIVE_ACTOR,
      `${actor.name || actor.id} is not an active family member.`,
      context
    );
  }

  const rule = ruleFor(action);
  if (!rule) {
    return deny(
      REASON.UNKNOWN_ACTION,
      `No policy defines "${action}", so it is denied. Known actions: ${actions().join(', ')}.`,
      context
    );
  }

  const permitted = rolesFor(rule, actor, resource);
  if (!permitted.includes(actor.role)) {
    const scope = context.resource && context.resource !== actor.id ? ' for another member' : '';
    return deny(
      REASON.PERMISSION_DENIED,
      `The "${actor.role}" role may not ${action}${scope}. Allowed: ${permitted.join(', ') || 'nobody'}.`,
      context
    );
  }

  return allow(`The "${actor.role}" role may ${action}.`, context);
}

module.exports = { REASON, authorize };
