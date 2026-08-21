import { battleOutcome, beginTurnState, spendTp, tickSourcedStatuses } from '../core/battle-state.mjs';
import { hasStatus, removeStatusQuietly } from '../core/statuses.mjs';

/**
 * The battle's turn sequencer: rounds, the acting order, and the two ways a
 * turn can end.
 *
 * It owns no state of its own — the queue, the phase and the uiTurn flag all
 * live on the shared `flow` spine — but it is the only module that drives them
 * forward. Everything it needs from the world (the camera, the marker, the
 * highlights, the facing picker, the AI) arrives named.
 *
 * The boundary between turns is where it talks to the reaction registry: a
 * reaction still resolving (a reprisal mid-flight) owns domain events that
 * belong before the next turn's, so `nextTurn` waits for it rather than
 * letting frame pacing interleave the two.
 *
 * Turns end in two steps. A human-driven turn gets the FFT facing beat first;
 * anything that arrived through `__BATTLE` (the balance bots) skips straight to
 * `finishTurn` with whatever facing the unit already has, so a bot never stalls
 * on a picker it cannot click.
 */
export function createTurnMachine({
  flow, units, reactions,
  // domain economy constants
  // poisonDamage is an ACCESSOR: rules.lethalPoison moves it live
  tpGain, tpCap, poisonDamage, aiBeat,
  // view primitives
  marker, tileTop, centerOn, clearHighlights, later,
  hideFacingArrows, showFacingPicker,
  cheb, faceToward, living,
  // HUD
  banner, renderStrip, refreshButtons,
  // the event→view seam, which this module is mutually recursive with
  present,
  clearMark,
  // outcome
  outcomeOptions, onVictory, onDefeat,
  // the music hold the round boundary releases
  music, cueBattleMusic,
  // cancels every pending gameplay timer when the battle is decided
  cancelTimers,
  // the enemy AI is constructed below this module (it is handed `endTurn`), so
  // it arrives as a call
  aiTurn,
}) {
  for (const [name, value] of Object.entries({
    flow, units, reactions, tpGain, tpCap, poisonDamage, aiBeat,
    marker, tileTop, centerOn, clearHighlights, later,
    hideFacingArrows, showFacingPicker, cheb, faceToward, living,
    banner, renderStrip, refreshButtons, present, clearMark,
    outcomeOptions, onVictory, onDefeat, music, cueBattleMusic, cancelTimers, aiTurn,
  })) {
    if (value === undefined || value === null)
      throw new Error(`turn-machine: missing context "${name}"`);
  }

  /** the outcome as it stands right now, or null while the battle is live */
  const outcomeNow = () => battleOutcome(units, outcomeOptions());

  function newRound() {
    flow.round++;
    // Defensive latch releases (2026-07-31 review): these one-way flags are
    // normally cleared deep inside cinematic timer chains; if any chain is
    // ever interrupted, the round boundary restores them so a stuck hold can
    // never silently disable reprisals or music for the rest of the battle.
    reactions.resume();
    if (music.isHeld() && music.isWanted()) cueBattleMusic();
    else music.releaseHold();
    for (const u of units) removeStatusQuietly(u, 'reprisalPending');
    flow.queue = units.filter(u => u.alive).sort((a, b) => b.speed - a.speed || a.team.localeCompare(b.team) || a.id - b.id);
    flow.qi = -1;
    nextTurn();
  }
  function nextTurn() {
    // Nothing advances once the battle is decided. Normally the cancelled
    // timers guarantee that, but the hold below parks a continuation that no
    // scheduler owns, so this is the guard that stops a released hold from
    // re-entering a finished battle and firing its ending a second time.
    if (flow.phase === 'over') return;
    if (checkEnd()) return;
    // The turn boundary is a DOMAIN boundary, so it is not allowed to depend
    // on animation timing. A reprisal provoked during the turn that just ended
    // resolves at the end of its own flight, and whether its damage recorded
    // before or after the next `turnStarted` used to come down to frame pacing
    // — the golden event stream for battle 2 was a coin flip, red on about
    // half its runs with identical damage and pure ordering divergence. The
    // reprisal keeps its own pacing; the boundary simply does not open until
    // the reprisal's damage is on the stream. The end check above still runs
    // first, so a battle already decided at the boundary ends now and the
    // reprisal aborts under the outcome overlay, exactly as before.
    if (reactions.resolving) { reactions.whenResolved(nextTurn); return; }
    do { flow.qi++; } while (flow.qi < flow.queue.length && !flow.queue[flow.qi].alive);
    if (flow.qi >= flow.queue.length) { newRound(); return; }
    beginTurn(flow.queue[flow.qi]);
  }
  function beginTurn(u) {
    // The battle has begun the moment a real unit takes a turn: this is the
    // latch every piece of combat chrome reads (see `started` in turn-state).
    // Set FIRST, so the `renderStrip`/`refreshButtons` pair below already draws
    // the started battle rather than one frame of the pre-battle field.
    flow.started = true;
    flow.uiTurn = false; hideFacingArrows();
    const hadPoison = hasStatus(u, 'poison');
    // Domain economy first (capped TP gain, move/action recovery, guard drop,
    // poison bite); the events replay onto the view after the camera and banner
    // are staged, which keeps the bite visually landing on the active unit.
    // the accessor is handed the VICTIM: rules.scaledPoison measures the bite
    // against that unit's own maximum rather than in flat points
    const events = beginTurnState(u, { tpGain, tpCap, poisonDamage: poisonDamage(u) });
    u.undo = null;                       // page-level: the undo snapshot holds view rotation
    flow.clearMode();
    clearHighlights();
    marker.visible = true;
    marker.position.set(u.x + 0.5, tileTop[u.z][u.x] + 0.02, u.z + 0.5);
    centerOn(u.x, u.z);
    flow.phase = u.team === 'player' ? 'player' : 'enemy';
    banner(u.name, u.team === 'player' ? u.role : 'ENEMY TURN');
    // clocks this unit owns but that sit on someone else (the mark) age first,
    // before its own economy runs
    present(tickSourcedStatuses(units, u.id));
    renderStrip(); refreshButtons();
    present(events);
    // poison bites at the victim's turn start, then the turn proceeds normally
    if (hadPoison) {
      if (!u.alive) { later(endTurn, 420); return; }
      later(() => startActing(u), 520);
    } else startActing(u);
  }
  function startActing(u) {
    if (flow.phase === 'over' || !u.alive) return;
    renderStrip(); refreshButtons();
    if (u.team === 'enemy') later(() => aiTurn(u), aiBeat());
  }
  function endTurn() {
    const u = flow.current();
    const lastBlow = outcomeNow() !== null;
    if (flow.uiTurn && u && u.alive && !u.downed && u.team === 'player' && flow.phase !== 'over' && !lastBlow) {
      flow.uiTurn = false;
      flow.clearMode(); clearHighlights(); refreshButtons();
      showFacingPicker(u, finishTurn);
      return;
    }
    flow.uiTurn = false;
    finishTurn();
  }
  function finishTurn() {
    const u = flow.current();
    // the militia end their turn looking at whoever is closest, so a unit that spent
    // its move backing off or shuffling sideways never stands with its back to the party
    if (u && u.alive && u.team === 'enemy') faceNearestFoe(u);
    flow.clearMode(); clearHighlights();
    marker.visible = false;
    refreshButtons();
    if (flow.phase === 'over') return;
    flow.phase = 'anim';
    later(nextTurn, 180);
  }
  function faceNearestFoe(u) {
    const foes = living(u.team === 'player' ? 'enemy' : 'player');
    if (!foes.length) return;
    let best = null, bd = Infinity;
    for (const f of foes) { const d = cheb(u, f); if (d < bd) { bd = d; best = f; } }
    if (best) faceToward(u, best.x, best.z);
  }
  function spend(u, cost) { present(spendTp(u, cost)); }
  // Movement and action are independent resources. If a player acts first, hand
  // control back with Move still available; if movement is already spent (or this
  // is an AI turn), continue to the facing/end-turn sequence.
  function completeAction(u) {
    const canStillMove = u && u.team === 'player' && u.alive && !u.moved &&
      outcomeNow() === null;
    if (!canStillMove) { endTurn(); return; }
    flow.phase = 'player';
    flow.clearMode();
    clearHighlights();
    renderStrip(); refreshButtons();
  }
  // A cast takes the field: no orders while its animation plays.
  function beginActionAnimation() {
    flow.phase = 'anim'; clearHighlights(); refreshButtons();
  }

  /**
   * Has the battle ended? Which rosters count as victory or defeat belongs to
   * the battle descriptor; which end card plays belongs to the page, so both
   * endings arrive as callbacks.
   */
  function checkEnd() {
    const outcome = outcomeNow();
    if (outcome === 'victory') { onVictory(); return true; }
    if (outcome === 'defeat') { onDefeat(); return true; }
    return false;
  }
  // The battle is decided: drop every pending gameplay timer and every piece of
  // order-taking chrome, so an end card plays over a settled field. Both endings
  // need exactly this, and a staging module that owns an end card needs it
  // without owning `phase` — it is handed this function, not the state.
  function haltBattlePresentation() {
    cancelTimers();
    // The cancelled timers were carrying any reaction still resolving, so
    // nothing will ever close it; drop the count and anything parked on it
    // rather than leave a hold no one can release.
    reactions.abandonResolutions();
    flow.phase = 'over'; flow.clearMode();
    clearHighlights(); marker.visible = false; clearMark();
    banner('', ''); refreshButtons();
  }

  return {
    newRound, nextTurn, beginTurn, endTurn, finishTurn,
    spend, completeAction, beginActionAnimation,
    checkEnd, haltBattlePresentation,
  };
}
