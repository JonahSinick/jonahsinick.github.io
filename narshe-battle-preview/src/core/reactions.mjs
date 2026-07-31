/**
 * Declarative reactions: which domain events provoke a mechanic, and when
 * those provocations are held back.
 *
 * Reactive mechanics used to be `if (THIS_BATTLE && ...)` lines inside the
 * event seam, and the one place that needed to delay them was a module-global
 * array the mechanic itself checked. Both problems are the same problem: the
 * rule about WHEN a reaction fires was written at the call site instead of
 * being data.
 *
 * A registry answers "what does this event provoke" and owns suspension. It
 * deliberately does NOT run anything: reactions are animated, timed, noisy
 * things that belong to the presentation layer, so the caller maps a matched
 * declaration id to its own handler. That keeps this module pure and testable
 * while still moving the decision out of the seam.
 */

/**
 * @param {Array<{
 *   id: string,
 *   on: string|string[],      // domain event type(s) that provoke it
 *   kinds?: string[],         // damage kinds, when the event carries one
 *   requiresSource?: boolean, // only provocations with a known attacker
 *   classes?: string[],       // unit classes the reaction belongs to
 * }>} declarations
 */
export function createReactionRegistry(declarations = []) {
  /** null = running; otherwise the list of provocations held back so far. */
  let held = null;
  /** null = every reaction is held; otherwise only these ids are. */
  let heldIds = null;

  const types = decl => (Array.isArray(decl.on) ? decl.on : [decl.on]);

  const matches = (decl, event, unit) => {
    if (!types(decl).includes(event.type)) return false;
    if (decl.kinds && !decl.kinds.includes(event.kind)) return false;
    if (decl.requiresSource && event.sourceId == null) return false;
    if (decl.classes && !(unit && decl.classes.includes(unit.cls))) return false;
    return true;
  };

  const isHeld = id => held !== null && (heldIds === null || heldIds.includes(id));

  return {
    declarations,

    /** True while anything is being held back. */
    get suspended() { return held !== null; },

    /** How many provocations are waiting — a gate can assert this is zero. */
    get pending() { return held ? held.length : 0; },

    /**
     * Hold matching provocations instead of returning them. `ids` limits the
     * hold to specific reactions; omitting it holds all of them. Suspending
     * twice is not an error, so a scripted beat that runs again cannot lose
     * what the first run captured.
     */
    suspend(ids = null) {
      if (held === null) { held = []; heldIds = ids; }
    },

    /**
     * Release the hold and hand back everything caught while it was on, in
     * the order it was provoked. Safe to call when nothing is suspended, so a
     * round boundary can release defensively without knowing the state.
     */
    resume() {
      const pending = held || [];
      held = null;
      heldIds = null;
      return pending;
    },

    /**
     * What this event provokes, as `{ id, event, unitId }` records. Returns
     * an empty list while the matching reactions are suspended — the caller
     * gets them later from `resume()` instead.
     */
    provoked(event, unit) {
      const out = [];
      for (const decl of declarations) {
        if (!matches(decl, event, unit)) continue;
        const record = { id: decl.id, event, unitId: unit ? unit.id : null };
        if (isHeld(decl.id)) held.push(record);
        else out.push(record);
      }
      return out;
    },
  };
}
