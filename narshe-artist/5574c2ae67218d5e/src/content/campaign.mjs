/**
 * Part I — the campaign, as data.
 *
 * The integrated game is both encounters in one session, in order. WHICH
 * encounters, in WHAT order, behind WHAT card, and ending on WHAT terminal
 * card is all here; how a session is driven from one step to the next is
 * `src/boot/campaign.mjs`. That split is the point: reordering the game, or
 * inserting battle 3 between these two, is an edit to this list and nothing
 * else.
 *
 * NARRATIVE ORDER — RULED (Jonah, 2026-08-03): opening, the gate battle, the
 * post-battle script, the act card, the warning bell, "To Be Continued". The
 * order was assumed when this was first built; it is now his, and so is what
 * is NOT in it.
 *
 * THE MINE FINALE IS NOT BETWEEN THE BATTLES — RULED (Jonah, 2026-08-03). The
 * songbeast scene belongs at the END of the arc and is not fully developed
 * yet, so the campaign does not run it. Nothing about the finale changed: it
 * is still staged in full by `?scene=mine`, by `__BATTLE.beginMine()`, and by
 * battle 1 played as a single encounter, which is the version
 * tools/mine_scene_check.py asserts. What changed is only which of battle 1's
 * two endings a campaign takes.
 *
 * WHAT A STEP DOES NOT DECLARE. A battle's own cinematics are its own: the
 * cliffs overlook and the gate exchange open `narshe-gate` and the bell
 * entrance opens `warning-bell` whether they are entered from a campaign or
 * from `?battle=`. So does the post-battle script, which is how battle 1
 * finishes rather than how the campaign continues. The campaign does not stage
 * anything; it decides what happens at the SEAM between two battles, which is
 * exactly two things — the entry card the next battle arrives behind, and the
 * closing sequence (if any) the previous one leaves on.
 */

/**
 * @typedef {object} CampaignStep
 * @property {string} id       stable checkpoint token; survives reordering, so
 *                             a saved position never resumes the wrong battle
 * @property {string|null} battle  the `?battle=` value; null is the default
 *                             encounter, exactly as a bare URL resolves it
 * @property {object|null} card    entry-card overrides for THIS step
 *                             (`{ title, floor, fade, className, curtain }`),
 *                             null for the battle's own card unchanged
 * @property {object|null} ending  what the player sees when this battle's arc
 *                             finishes: `{ card: { text } }` draws a terminal
 *                             card and waits on it; null cuts straight into
 *                             the next step, under that step's entry card
 */

/** The shipped campaign: the gate, then the bell. */
export const PART_ONE_CAMPAIGN = {
  id: 'part-one',
  steps: [
    {
      id: 'narshe-gate',
      // Opens on the cliffs overlook and the gate exchange, and finishes on
      // the post-battle script, all of it battle 1's own.
      battle: null,
      card: null,
      // Nothing at the seam: no card, and — per the ruling above — no mine
      // finale either. Cassien's last line ends the fight, and the act card
      // covers the cut into the mines. That card IS the transition now that
      // the white-out is not there to be one; it is opaque from the frame it
      // appears on, which is what the finale's flash used to provide.
      ending: null,
    },
    {
      id: 'warning-bell',
      // Its scripted entrance (bell, sentry, the bonded pair) is intact: the
      // campaign enters this battle exactly as `?battle=warningbell` does.
      battle: 'warningbell',
      // The act break. Battle 2's own card already reads NARSHE MINES, which
      // is the place AND the act, so nothing is overridden here — the entry
      // is byte-identical to the single-battle one. Jonah judges the feel of
      // an unmodified card between two battles; if it wants to be quieter,
      // `{ curtain: false }` or a `className` is the whole of the change.
      card: null,
      // Part I's real ending, moved here from battle 1: the game now runs on
      // past the mine, so "to be continued" belongs after the last encounter.
      //
      // `hold` is the safe default Jonah asked for on 2026-08-03: the card is
      // where the game STOPS. Clicking it used to take it down and hand the
      // player back the battlefield it was drawn over, which is not an ending.
      // Held, it stays, opaque, with no "click or space" prompt. He is still
      // deciding between this and an aftermath tableau — if that wins, it
      // replaces this card here, and nothing else has to move.
      ending: { card: { text: 'To Be Continued', hold: true } },
    },
  ],
};

/** Every campaign the boot path can resolve. One, for now. */
export const CAMPAIGNS = [PART_ONE_CAMPAIGN];

export const DEFAULT_CAMPAIGN = PART_ONE_CAMPAIGN;

/**
 * Where a saved checkpoint resumes.
 *
 * By STEP ID rather than by index, because an index saved before a reorder
 * resumes the wrong battle silently, and an id that no longer exists is
 * recognisably stale. An unknown id restarts the campaign rather than
 * throwing — a stale token in a browser tab must still give the player a game.
 */
export function stepIndexById(campaign, id) {
  if (!id) return 0;
  const at = campaign.steps.findIndex(step => step.id === id);
  return at < 0 ? 0 : at;
}
