/**
 * Enemy turns, presented in the player's own visual grammar.
 *
 * A militia turn used to be a fait accompli: the figure was simply somewhere
 * else, and someone was simply hurt. The player could reconstruct what had
 * happened but never watch it being DECIDED, which is the half of a tactics
 * turn that teaches anything — how far that archer can walk, how far it can
 * shoot, and which of your three it was looking at.
 *
 * So an enemy action now plays through exactly the chrome the player's own
 * commands use, in the same order a player performs them:
 *
 *     move range lights (blue, `showHighlights`)
 *   → the chosen square marks (the move-destination cursor)
 *   → the unit walks
 *   → the action's range envelope lights (yellow-green, the same footprint
 *     `setMode('attack')` draws for the player)
 *   → the chosen target square fills orange (the selected-target cursor)
 *   → the action fires
 *
 * PRESENTATION ONLY, in the strongest sense: this module wraps three view
 * primitives the AI is handed (`moveUnit`, `attack`, `castAbility`) and defers
 * each by two beats. It never reads a rule, never scores a tile, and never
 * touches the arguments it forwards, so every AI decision is byte-identical to
 * what it was — the militia have already CHOSEN by the time anything here
 * runs, and all that changes is that the player gets to watch the choice.
 *
 * INERT UNDER FAST_SIM. Headless bots, the golden event-log gate and every
 * balance run set `fast()`, and under it each wrapper calls straight through
 * with no highlight and no timer at all — not a shortened one, none — so the
 * event streams those runs record cannot move.
 *
 * Pacing rides on AI_BEAT rather than owning a constant: the beat is already
 * the live knob for "how fast do the militia think" (the tuning panel and
 * `fast()` both move it), and telegraph pacing IS AI pacing. It arrives as an
 * accessor for the usual reason — a value captured here would freeze at
 * construction.
 */

/**
 * Fractions of one AI beat: long enough to read as deliberate selection,
 * short enough that a six-militia round does not become a cutscene.
 */
const RANGE_HOLD = 0.7;      // envelope up, before the choice is marked
const PICK_HOLD = 0.7;       // choice marked, before the action fires

export function createAiTelegraph({
  // the real actions, wrapped one for one
  moveUnit, attack, castAbility,
  // what to draw: the same functions the player's targeting uses
  reachable, attackFootprint, abilFootprint, abilityHl,
  showHighlights, clearHighlights, setMoveCursor, setAttackCursor,
  // pacing and the battle's own scheduler (generation-scoped, so a decided
  // battle cancels a telegraph mid-sequence along with everything else)
  later, aiBeat, phase, inert,
}) {
  for (const [name, value] of Object.entries({
    moveUnit, attack, castAbility,
    reachable, attackFootprint, abilFootprint, abilityHl,
    showHighlights, clearHighlights, setMoveCursor, setAttackCursor,
    later, aiBeat, phase, inert,
  })) {
    if (value === undefined || value === null)
      throw new Error(`ai-telegraph: missing context "${name}"`);
  }

  /**
   * Show the envelope, mark the choice, then do the thing.
   *
   * `fire` is called EXACTLY once on every path, including the inert one: it
   * carries the AI's `done` continuation, and a turn that never fires is a
   * battle that never advances.
   */
  function telegraph(show, mark, fire) {
    if (inert()) { fire(); return; }
    const hold = ms => Math.max(1, Math.round(aiBeat() * ms));
    show();
    later(() => {
      if (phase() === 'over') return;
      mark();
      later(() => {
        if (phase() === 'over') return;
        // put away what we put up; the action's own `beginActionAnimation`
        // would clear it a moment later anyway, but the telegraph owning both
        // ends keeps the chrome from depending on that
        clearHighlights();
        fire();
      }, hold(PICK_HOLD));
    }, hold(RANGE_HOLD));
  }

  return {
    moveUnit(u, path, done) {
      // `path` is the step list the AI already committed to; its last step is
      // where the unit is going, and it is only ever read, never chosen here
      const dest = path.length ? path[path.length - 1] : null;
      telegraph(
        () => showHighlights(reachable(u).tiles, 'move'),
        () => { if (dest) setMoveCursor(dest[0], dest[1]); },
        () => moveUnit(u, path, done),
      );
    },
    attack(att, def, done, scale) {
      telegraph(
        () => showHighlights(attackFootprint(att), 'attack'),
        () => setAttackCursor(def),
        () => attack(att, def, done, scale),
      );
    },
    /**
     * A self or burst cast has no square to point at — the caster IS the
     * target — so it plays unchanged rather than lighting a footprint nobody
     * chose. The return value is the shape the real one has; the AI ignores
     * it, and a deferred cast could not honestly report on a definition it
     * has not looked up yet.
     */
    castAbility(u, key, target = null, done = null) {
      if (!target) return castAbility(u, key, target, done);
      telegraph(
        () => showHighlights(abilFootprint(u, key), abilityHl(key) || 'attack'),
        () => setAttackCursor(target),
        () => castAbility(u, key, target, done),
      );
      return true;
    },
  };
}
