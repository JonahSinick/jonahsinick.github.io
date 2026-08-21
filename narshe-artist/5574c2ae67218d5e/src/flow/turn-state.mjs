/**
 * The battle presenter's mutable spine.
 *
 * Turn sequencing, the event→view seam, the HUD and the player-input layer are
 * mutually recursive — a turn begins, presents events, an out-of-band reprisal
 * fells the acting unit and ends the turn again — and all four read and write
 * the same handful of fields. This module owns those fields, and nothing else,
 * so the four can be separate modules that share one object rather than one
 * module that shares one scope.
 *
 * The fields are deliberately plain mutable properties rather than
 * getter/setter pairs: `flow.phase` reads the same in a condition and in an
 * assignment, which is what keeps the presenter's call sites honest about who
 * writes what. Everything else a presenter needs — the scene, the units, the
 * DOM — is injected per module.
 */
export function createTurnState() {
  return {
    /** the acting order for this round, fastest first */
    queue: [],
    /** index into `queue`; -1 before the first turn of a round */
    qi: -1,
    /** rounds elapsed, 1-based once the first round begins */
    round: 0,
    /**
     * HAS THE BATTLE BEGUN? The one definition every piece of combat chrome
     * agrees on (Jonah, 2026-08-05).
     *
     * Latched true by `beginTurn` — the moment a real unit is actually taking a
     * turn — and never cleared: a battle that has started stays started through
     * the round boundaries, the animation beats and the end card. That is the
     * difference between this and `current()`, which answers "is somebody
     * acting RIGHT NOW" and goes null between turns and at every round
     * boundary. The action bar could ask the second question because a bar with
     * nothing to command should indeed go away; a health bar asking it would
     * blink off every time the queue turned over.
     *
     * Everything the battle draws over the field — the bars, their turn
     * numerals, the action menu — reads THIS, so the opening dialogue, the
     * cliffs, the gallery's scripted entrance and the act card between the two
     * encounters all play with a clean field.
     */
    started: false,
    /** 'idle' | 'player' | 'enemy' | 'anim' | 'facing' | 'over' | 'explore' */
    phase: 'idle',
    /** what the player is currently pointing at: 'move' | 'attack' | 'abil' | null */
    mode: null,
    /** ability key while `mode === 'abil'` */
    curAbil: null,
    /**
     * whether this turn is being driven by pointer/keyboard. Only a human-driven
     * turn gets the FFT facing beat; anything arriving through `__BATTLE` (the
     * balance bots) ends immediately with the facing it already has.
     */
    uiTurn: false,

    /** the unit whose turn it is, or null if the queue slot is empty or dead */
    current() {
      return this.queue[this.qi] && this.queue[this.qi].alive ? this.queue[this.qi] : null;
    },
    /** drop the pending command. These two always move together. */
    clearMode() {
      this.mode = null;
      this.curAbil = null;
    },
  };
}
