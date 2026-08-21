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
 *
 * It does, however, count what is still resolving. An animated reaction lands
 * its domain effects at the end of its animation, so anything that must be
 * ordered against those effects — the turn boundary, above all — needs to ask
 * "is one still in the air?" and be told when the answer becomes no. That is
 * bookkeeping, not execution: `beginResolution`/`whenResolved` hold no timer
 * and know nothing about stones, tweens or frames.
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
  /** provocations handed to a runner whose domain effects have not landed yet. */
  let resolvingCount = 0;
  /** continuations parked until nothing is mid-resolution. */
  let waiting = [];

  // One at a time, and re-checking the count each round: a released
  // continuation may itself provoke a reaction, and everything still parked
  // has to wait for that one too.
  function drainWaiting() {
    while (resolvingCount === 0 && waiting.length) waiting.shift()();
  }

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
     * A provocation has gone to its runner and its domain effects have not
     * landed yet. Returns a one-shot callback the runner calls once they have.
     *
     * The runner must call it on EVERY exit — including the paths that abort
     * without doing anything — because a resolution that is never closed parks
     * `whenResolved` callers for the rest of the battle.
     */
    beginResolution() {
      resolvingCount++;
      let closed = false;
      return () => {
        if (closed) return;      // idempotent: an exit path may be reached twice
        closed = true;
        resolvingCount--;
        drainWaiting();
      };
    },

    /** How many provocations are still mid-resolution. */
    get resolving() { return resolvingCount; },

    /**
     * Run `fn` once nothing is mid-resolution — immediately when nothing is.
     * This is how "the turn waits for a reaction" is expressed without the
     * waiter knowing what the reaction is or how long its animation runs.
     */
    whenResolved(fn) {
      if (resolvingCount === 0) fn();
      else waiting.push(fn);
    },

    /**
     * Forget everything still resolving and everything parked. The battle is
     * decided: the timers those resolutions were riding are being cancelled,
     * so nothing will ever close them, and no parked continuation should run
     * into a finished battle.
     */
    abandonResolutions() {
      resolvingCount = 0;
      waiting = [];
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
