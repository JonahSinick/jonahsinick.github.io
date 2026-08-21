/**
 * The campaign flow controller: one battle after another, in one session.
 *
 * It owns exactly three things — WHICH step is current, WHEN the session moves
 * to the next one, and WHERE that position is remembered across a reload.
 * Everything else it delegates: the order and the cards are data
 * (`src/content/campaign.mjs`), building and freeing a battle is the session
 * (`src/boot/session.mjs`), and every cinematic belongs to the battle that
 * stages it. This module never touches a scene.
 *
 * HOW A BATTLE HANDS BACK. A battle's arc ends in its own dialogue runner — the
 * post-battle script and mine finale for the gate, the end card for the bell —
 * so the seam is expressed as an `outro`: the terminal beats to play (possibly
 * none) and the callback that fires when they are done. `session.start` passes
 * it to the scene, which uses it in place of the card it would show if it were
 * being played alone. A battle entered WITHOUT an outro is unchanged, which is
 * what keeps `?battle=` entries identical to today.
 *
 * WHY THE TRANSITION IS DEFERRED. `onEnd` fires from inside the battle's own
 * dialogue completion, and the first thing the next step does is dispose that
 * battle — cancelling the timers and abandoning the dialogue whose stack we are
 * standing on. One turn of the event loop puts the teardown outside it.
 *
 * DOWNED UNITS RECOVER (Jonah's downed-not-dead ruling, 2026-08-02). Nothing
 * carries across the seam: every battle builds its roster from its own
 * descriptor, so the party arrives at the bell whole however the gate ended.
 * That is a property of not persisting unit state rather than of restoring it,
 * and this is the module that would have to change to make it otherwise.
 */

import { DEFAULT_CAMPAIGN, stepIndexById } from '../content/campaign.mjs';

/**
 * Where the position is written. sessionStorage, not localStorage: the
 * checkpoint means "the tab is partway through the game", and it should not
 * outlive the tab.
 */
export const CHECKPOINT_KEY = 'narshe:campaign';

/**
 * sessionStorage that cannot throw. Storage access raises in privacy modes and
 * inside some embedded views, and a game that will not boot because it could
 * not save a checkpoint is a worse outcome than a game that forgets where it
 * was. Failure degrades to a memory-backed store for this page load.
 */
function safeStorage(storage) {
  const memory = new Map();
  const fallback = {
    getItem: key => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => { memory.set(key, value); },
    removeItem: key => { memory.delete(key); },
  };
  if (!storage) return fallback;
  return {
    getItem(key) { try { return storage.getItem(key); } catch { return fallback.getItem(key); } },
    setItem(key, value) { try { storage.setItem(key, value); } catch { fallback.setItem(key, value); } },
    removeItem(key) { try { storage.removeItem(key); } catch { fallback.removeItem(key); } },
  };
}

/**
 * @param {object} options
 * @param {object} options.session   the `createSession` handle (start/dispose/current)
 * @param {object} [options.campaign] a campaign descriptor; defaults to Part I
 * @param {Storage} [options.storage] where the checkpoint lives; defaults to none
 * @param {(fn: Function) => void} [options.defer] schedule the transition off
 *        the current stack; injected so a test can run it synchronously
 */
export function createCampaignFlow({
  session,
  campaign = DEFAULT_CAMPAIGN,
  storage = null,
  defer = fn => setTimeout(fn, 0),
}) {
  if (!session) throw new Error('campaign: no session to drive');
  if (!campaign || !campaign.steps || !campaign.steps.length)
    throw new Error('campaign: descriptor has no steps');

  const store = safeStorage(storage);
  const steps = campaign.steps;
  let index = -1;
  let started = null;      // the scene id the session handed back for this step
  let finished = false;

  const readCheckpoint = () => store.getItem(CHECKPOINT_KEY);
  const clearCheckpoint = () => store.removeItem(CHECKPOINT_KEY);

  /**
   * The terminal beats for a step, built from its `ending` data.
   *
   * The LAST step's card is where the campaign completes, and completion is
   * recorded when the card is SHOWN rather than when it is clicked away: the
   * player has finished the game at that moment, and a checkpoint surviving
   * until they dismiss a card would resume a finished campaign on a reload.
   */
  function endingBeats(step, at) {
    const card = step.ending && step.ending.card;
    if (!card) return [];
    return [{
      kind: 'tbc',
      text: card.text,
      // `hold` stops the card being clicked away (src/ui/dialogue.mjs). A card
      // that lifts hands the player back the battlefield it was drawn over,
      // which is not how a game ends; the descriptor decides per card, because
      // a mid-campaign card between two acts might well want to lift.
      hold: !!card.hold,
      onShow: () => { if (at === steps.length - 1) complete(); },
    }];
  }

  function complete() {
    if (finished) return;
    finished = true;
    clearCheckpoint();
  }

  function startStep(at) {
    index = at;
    finished = false;
    const step = steps[at];
    // Written as the step STARTS, so a reload during a battle resumes that
    // battle's entry rather than the game's. There are deliberately no mid-
    // battle saves: the unit of progress is an encounter.
    store.setItem(CHECKPOINT_KEY, step.id);
    const scene = session.start(step.battle, {
      card: step.card || null,
      outro: {
        beats: endingBeats(step, at),
        onEnd: () => {
          if (at >= steps.length - 1) { complete(); return; }
          advance();
        },
      },
    });
    started = scene && scene.id;
    return scene;
  }

  /** Leave the current step and enter the next one, off the current stack. */
  function advance() {
    if (index >= steps.length - 1) { complete(); return; }
    const leaving = started;
    const next = index + 1;
    defer(() => {
      session.dispose(leaving);
      startStep(next);
    });
  }

  /**
   * Enter the campaign: at the saved position, or at the start.
   *
   * `fresh` is `?campaign=fresh` — the dev and playtest escape hatch from a
   * checkpoint, and the one way to see the opening again without a new tab.
   */
  function begin({ fresh = false } = {}) {
    if (fresh) clearCheckpoint();
    return startStep(stepIndexById(campaign, readCheckpoint()));
  }

  return {
    id: campaign.id,
    begin,
    advance,
    index: () => index,
    step: () => (index < 0 ? null : steps[index].id),
    steps: () => steps.map(step => step.id),
    finished: () => finished,
    checkpoint: () => readCheckpoint(),
    clearCheckpoint,
  };
}
