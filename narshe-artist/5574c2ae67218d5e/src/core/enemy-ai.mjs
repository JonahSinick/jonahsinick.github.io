/**
 * The militia enemy AI: one entry point, `aiTurn(u)`, dispatching by class to
 * a bruiser (melee close-and-swing), an archer (kite/reposition for a firing
 * line, focus-fire the deepest attacker), or an alchemist (poison flasks from
 * range, panics and flees a unit at arm's length). They are defenders — hold
 * the terrace, shoot what comes into range, never charge downhill.
 *
 * This module owns no state of its own; every decision reads the live board
 * through the injected context (`reachable`/`pathTo`/`attackTargets`/
 * `castAbility` and friends) so it always sees this turn's units, not a
 * snapshot. Live-tunable numbers (`AI_BEAT`, `round`, `phase`) arrive as
 * accessors rather than values for the same reason `battle-kit.mjs`'s numbers
 * do: a snapshot taken at construction would go stale the moment `fast()` or
 * a new round changed the real one.
 */

import { hasStatus } from './statuses.mjs';
import { escalatedAbilityRange } from './threat.mjs';

export const ENEMY_AI_CONTEXT_FIELDS = [
  'THREE',          // for the alchemist's panic floatText offset (Vector3)
  'living',         // (team) -> alive units on that team
  'terraceOf',      // (z) -> which terrace a row belongs to
  'reachable',      // (u) -> { tiles, ... } BFS reachability for repositioning
  'pathTo',         // (res, u, tx, tz) -> step path to a reachable tile
  'moveUnit',       // (u, path, done) -> tweened move, then done()
  'later',          // (fn, ms) -> scheduled on the battle's own generation
  'aiBeat',         // () -> current AI_BEAT pacing (fast() shrinks it)
  'endTurn',        // () -> hand the turn back
  'phase',          // () -> current battle phase ('over' aborts a stale turn)
  'attackTargets',  // (u) -> units u could strike right now
  'defendAction',   // (u) -> take the Defend stance and end the turn; FALSE if unaffordable
  'defendCost',     // () -> what a guard costs right now, so the AI can budget
  'distance',       // (a, b) -> tiles apart by the RANGE metric in force, so the
                    // AI reasons about reach in the same shape the rules apply
  'couldShootFrom', // (u, tile, foes) -> would this unit have a legal, UNBLOCKED
                    // shot from that tile? lets an archer move for a clear lane
  'approachCost',   // (targets) -> (x,z) -> steps to walk there, around scenery
  'attack',         // (attacker, defender, done) -> execute a strike
  'abilities',      // ability registry — .get('aim')/.get('flask') for cost/AI numbers
  'takeAim',        // (u) -> cast Take Aim
  'castAbility',    // (u, key, target, done) -> cast an ability
  'round',          // () -> current round number
  'escalateStart',  // () -> round at which flask range begins growing (Infinity = never)
  'advanceWhenPrepared',  // () -> may a prepared defender leave its terrace?
  'smartMilitia',   // () -> are the AI improvements on? off restores main's play
  'stickyFocus',    // () -> do the militia finish a victim before re-picking?
  'aimAlertRange',  // distance an archer steadies at when smartMilitia is OFF
  'engageRange',    // distance at which a defender starts caring at all
  'shotRange',      // (u) -> effective range this turn (aimed or not)
  'floatText',      // (text, position, colour) -> the panic '!' callout
  'tileCenter',      // (x, z) -> world position of a tile's centre
];

export function createEnemyAI(context) {
  const missing = ENEMY_AI_CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('enemy AI: missing context field(s) ' + missing.join(', '));
  }
  const {
    THREE, living, terraceOf, reachable, pathTo, moveUnit, later, aiBeat,
    endTurn, phase, attackTargets, defendAction, defendCost, distance: dist,
    couldShootFrom, approachCost, attack, abilities, takeAim,
    castAbility, round, escalateStart, advanceWhenPrepared, engageRange, shotRange,
    smartMilitia, stickyFocus, aimAlertRange,
    floatText, tileCenter,
  } = context;

  /**
   * Guard, bank, or just end the turn.
   *
   * The militia pay for Defend HONESTLY under rules.defendCostsTp — the same
   * 1 TP the player pays. That is the whole reason the rule works: pricing the
   * guard makes it compete with abilities for one currency, and a militia that
   * guards free while the player buys it is not playing the same game.
   *
   * But paying honestly means BUDGETING honestly, and that is what `reserve`
   * is for: the points this unit is saving for its own kit. Without it an
   * alchemist starves itself — +1 at turn start, −1 on a reflex guard, pinned
   * below the flask's 2 forever, so it flees and braces and never throws
   * again. (Measured: turn-start TP `[1,1,1,1]`, zero flasks, zero poison in a
   * whole battle.) A unit that cannot afford both keeps the point instead:
   * ending the turn unguarded to throw next turn beats bracing every turn and
   * never throwing at all.
   *
   * Reserve 0 (the default) is the old behaviour, and it is right for the
   * archers: Sentinel's Eye costs 1, the same as a guard, so an archer is never
   * pinned BELOW its own ability the way a 2-point flask leaves the alchemist.
   */
  function guardOrEnd(u, foes, reserve = 0) {
    if (!smartMilitia()) { if (!defendAction(u)) endTurn(); return; }
    const cost = defendCost();
    // A FREE guard is always worth taking — it costs nothing, and a skilled
    // player would take it. Everything below is about a guard you have to BUY.
    if (cost > 0) {
      // A guard is a response to danger. Bracing against an enemy that cannot
      // reach you this coming turn is a point spent on nothing, and it is how
      // an archer holding the back terrace burned eleven of its fourteen turns
      // pinned at 1 TP — never banking, so never able to steady the bow when
      // the assault finally arrived.
      if (!threatened(u, foes)) { endTurn(); return; }
      // And never buy the guard with points this unit's own kit needs.
      if (u.tp - cost < reserve) { endTurn(); return; }
    }
    if (!defendAction(u)) endTurn();
  }
  /**
   * Could any of these foes actually reach this unit on their next turn?
   *
   * Move plus reach, worst case — the same geometric question the player's
   * danger-zone shading answers, asked from the other side of the board. Real
   * numbers rather than a magic radius, so a faster or longer-ranged party
   * makes the militia correspondingly more careful without anyone retuning a
   * constant.
   */
  function threatened(u, foes) {
    return foes.some(f => dist(u, f) <= f.move + shotRange(f));
  }

  // How close to falling a defender has to be before it stops preparing and
  // starts protecting itself. AI policy rather than game tuning, so it lives
  // here beside the decision it governs rather than in the page's constants.
  const CRITICAL_HP = 1 / 3;

  /**
   * ELEMENT 5 — when does a defender stop holding and start walking?
   *
   * The trigger is PREPARED AND IDLE, decided per unit rather than by a global
   * stall counter. A skilled defender holds while holding is doing work: while
   * the bow is still being steadied, or while anyone is in the arc. Once it is
   * prepared and there is nothing to shoot from where it stands, standing there
   * achieves nothing at all, and the strong move is to close the distance and
   * make the intruders fight on the militia's terms.
   *
   * Per-unit rather than global because it needs no hidden state and it READS:
   * the line steadies up, then starts moving, and a player can see the causal
   * chain. A round counter would produce the same walk with no visible cause.
   */
  function prepared(u) {
    // an archer is prepared once steadied; nobody else has a stance to take
    return u.cls !== 'archer' || hasStatus(u, 'aimed');
  }
  function shouldAdvance(u) {
    return advanceWhenPrepared() && prepared(u) && attackTargets(u).length === 0;
  }

  function weakest(list) { return list.reduce((a, b) => (b.hp < a.hp ? b : a)); }
  function nearestFoe(t, foes) { return Math.min(...foes.map(f => dist(t, f))); }
  // Focus fire: the militia all shoot whoever has pushed deepest into the town
  // (ties to the weaker one). Every archer derives the same answer from the same
  // board, so they converge on one target without any shared bookkeeping.
  function advanced(list) { return list.reduce((a, b) => (b.z < a.z || (b.z === a.z && b.hp < a.hp) ? b : a)); }
  /**
   * Who the line shoots at.
   *
   * Default (main's rule): whoever has pushed deepest, re-decided every turn.
   * That is legible but it is exploitable — a party that advances in cohesion
   * never presents an isolated front-runner, so the damage spreads across
   * three bodies and nobody dies, which is the whole win condition.
   *
   * rules.stickyFocus makes them finish what they start: pick the most wounded
   * they can reach, and keep shooting that one until it falls. Skilled play by
   * the group doctrine — securing a kill beats chipping three targets — and it
   * punishes damage-spreading directly.
   */
  let victimId = null;
  function focusOf(cands) {
    if (stickyFocus()) {
      const held = cands.find(c => c.id === victimId);
      if (held) return held;
      // The lock belongs to the LINE, not to whoever is shooting. A shooter
      // whose own candidate list happens to lack the victim — out of its
      // envelope, inside the minimum-range hole, lane blocked — is not
      // evidence that the victim is finished, so it takes a local target and
      // leaves the lock alone. Overwriting it here is what turned "commit
      // until it falls" into thrash between victims, and it handed the player
      // a way to shed the lock by cycling the victim out of ONE archer's
      // reach. The lock is re-taken only when the unit holding it is actually
      // gone from the board.
      const victim = victimId === null ? null : living('player').find(u => u.id === victimId);
      if (victim) return cands.reduce((a, b) => (b.hp < a.hp ? b : a));
      // Fraction, not absolute hit points: at first contact everybody is at
      // full health, and an absolute-HP argmin commits the whole line to
      // whoever has the smallest bar — Seira, at 40 against Cassien's 52 —
      // before anyone has been wounded at all. "Most wounded" is the rule this
      // is supposed to express, and a 45/52 knight is more wounded than an
      // untouched mage.
      const pick = cands.reduce((a, b) =>
        (b.hp / b.maxHp < a.hp / a.maxHp ? b : a));
      victimId = pick.id;
      return pick;
    }
    const call = advanced(living('player'));
    return cands.includes(call) ? call : advanced(cands);
  }
  // pick the reachable tile on our own terrace that scores best, "stand still" included
  /**
   * `anyTerrace` releases the hold-your-terrace rule. Holding is the militia's
   * DESIGNED posture (DESIGN.md: defenders hold their terrace and do not charge
   * downhill), and element 5 is the one case that overrides it — a prepared
   * defender with nothing left to do.
   */
  function repositionTo(u, score, { anyTerrace = false } = {}) {
    const res = reachable(u);
    const mine = terraceOf(u.z);
    let best = { x: u.x, z: u.z, d: 0 }, bestScore = score({ x: u.x, z: u.z, d: 0 });
    for (const t of res.tiles) {
      if (!anyTerrace && terraceOf(t.z) !== mine) continue;
      const s = score(t);
      if (s > bestScore) { bestScore = s; best = t; }
    }
    if (best.x === u.x && best.z === u.z) return null;
    return { res, tile: best };
  }
  function aiMoveThen(u, plan, after) {
    u.moved = true;
    moveUnit(u, pathTo(plan.res, u, plan.tile.x, plan.tile.z), () => {
      if (!u.alive) { endTurn(); return; }
      later(after, aiBeat());
    });
  }
  function aiTurn(u) {
    if (!u.alive || phase() === 'over') return;
    const foes = living('player');
    if (!foes.length) { endTurn(); return; }
    (u.cls === 'alchemist' ? aiAlchemist
      : (u.cls === 'champion' || u.cls === 'beast') ? aiBruiser : aiArcher)(u, foes);
  }
  // The bonded pair are straightforward melee: close on the nearest imperial and
  // swing. Their menace is the cross-retaliation, not their footwork. When a
  // swing is out of reach they guard ONLY under real threat — an imperial close
  // enough to strike first — and otherwise just advance and hold, so the
  // approach reads as a hunt rather than inexplicable turtling (Jonah's note).
  function aiBruiser(u, foes) {
    const act = () => {
      const near = attackTargets(u);
      if (near.length) { u.acted = true; attack(u, weakest(near), endTurn); return; }
      if (nearestFoe(u, foes) <= engageRange) { guardOrEnd(u, foes); return; }
      endTurn();
    };
    if (attackTargets(u).length) { later(act, aiBeat()); return; }
    // Melee can only swing at CARDINAL neighbors, but chebyshev calls a diagonal
    // "distance 1" — without the swing bonus she parks one diagonal step from
    // her prey and shields forever, certain she can get no closer.
    const canSwingFrom = t => foes.some(f => Math.abs(f.x - t.x) + Math.abs(f.z - t.z) === 1);
    const plan = repositionTo(u, t => (canSwingFrom(t) ? 1000 : 0) - nearestFoe(t, foes) * 10 - t.d * 0.5);
    if (plan) { aiMoveThen(u, plan, act); return; }
    later(act, aiBeat());
  }
  function aiArcher(u, foes) {
    const shootable = () => attackTargets(u).filter(t => dist(u, t) >= 2);
    const act = () => {
      const shots = shootable();
      if (shots.length) { u.acted = true; attack(u, focusOf(shots), endTurn); return; }
      const near = attackTargets(u);
      if (near.length) { u.acted = true; attack(u, focusOf(near), endTurn); return; }
      // nothing in the arc: steady the bow and hold the ground for whoever crests next
      // No shot this turn. A skilled defender STEADIES THE BOW rather than
      // bracing (Jonah, playtest 2026-08-02: "he should at least be using his
      // other special ability if he doesn't need guard"). Preparing early is
      // free — the aimed stance is held until it is spent, it never decays —
      // and an aimed line is precisely what makes a careless approach
      // expensive, which DESIGN.md gives as the whole point of arming the
      // militia with Take Aim. Bracing instead buys nothing against an enemy
      // that is not there yet.
      //
      // This replaces a distance gate (the retired AIM_ALERT_RANGE, 6 tiles).
      // That knob existed in case rounds 1-2 felt static, and holding the aim
      // back was the wrong cure: an archer that steadies up IS doing
      // something, and one that braces at an empty horizon is not.
      //
      // The one exception is a unit about to fall, which brings its shield up
      // instead of preparing a shot it may not live to take.
      const critical = smartMilitia()
        && u.hp <= u.maxHp * CRITICAL_HP && threatened(u, foes);
      // With smartMilitia OFF this is main's rule again: steady up only once
      // the assault is inside AIM_ALERT_RANGE, and never mind being critical.
      const mayAim = smartMilitia() || nearestFoe(u, foes) <= aimAlertRange;
      if (!critical && mayAim && !hasStatus(u, 'aimed') && u.tp >= abilities.get('aim').cost) {
        takeAim(u); return;
      }
      guardOrEnd(u, foes);
    };
    // Someone is in our face: back off first. Under the 40% adjacent penalty
    // that was an efficiency argument; under rules.archerMinRange the shot is
    // simply gone, and this reposition is the only thing standing between the
    // archer and a wasted turn. The behaviour is right either way, which is why
    // the rule needed no branch here — `attackTargets` already stopped offering
    // the shot, and `act`'s fallbacks (steady the bow, else guard) take over.
    if (nearestFoe(u, foes) <= 1) {
      const plan = repositionTo(u, t => {
        const mn = nearestFoe(t, foes);
        return (mn <= 1 ? -200 : 0) + (couldShootFrom(u, t, foes) ? 500 : 0)
          - Math.abs(mn - shotRange(u)) * 4 - t.d * 0.5;
      });
      if (plan) { aiMoveThen(u, plan, act); return; }
      act(); return;
    }
    if (shootable().length) { act(); return; }
    // ELEMENT 5: prepared, and nothing in the arc from here. Holding gains
    // nothing now, so close on them — leaving the terrace, which is the only
    // case that overrides the hold-your-ground posture. A clear lane still
    // dominates the score: the point of walking is to get a shot, not to melee.
    if (shouldAdvance(u)) {
      // Closing the gap is scored on WALKING distance, not straight-line: with
      // a building in the way every reachable tile can be further from the
      // target than standing still, and the archer then stands still for the
      // rest of the battle. One measured case ran twenty-six rounds with a
      // militiaman six tiles from a lone imperial at 4 hit points, both of
      // them behind opposite corners of the bunkhouse. Shooting is still
      // judged straight-line, because that is how an arrow travels.
      const field = smartMilitia() && approachCost ? approachCost(foes) : null;
      const plan = repositionTo(u, t => {
        const mn = nearestFoe(t, foes);
        const gap = field ? Math.min(field(t.x, t.z), 99) : mn;
        return (couldShootFrom(u, t, foes) ? 1000 : 0) + (mn <= 1 ? -200 : 0)
          - gap * 10 - t.d * 0.5;
      }, { anyTerrace: true });
      if (plan) { aiMoveThen(u, plan, act); return; }
    }
    // Engaged but with no shot: shuffle along our own terrace for a firing
    // line. `couldShootFrom` is the strong term because under rules.arrowLos
    // being at the right DISTANCE is no longer the same as having a shot — a
    // friend standing in the lane refuses it — so an archer that only chased
    // the distance band would keep parking behind its own front rank.
    if (nearestFoe(u, foes) <= engageRange) {
      const plan = repositionTo(u, t => {
        const mn = nearestFoe(t, foes);
        return (couldShootFrom(u, t, foes) ? 1000 : 0)
          + (mn >= 2 && mn <= shotRange(u) ? 100 : 0) + (mn <= 1 ? -200 : 0)
          - Math.abs(mn - shotRange(u)) * 3 - t.d * 0.5;
      });
      if (plan) { aiMoveThen(u, plan, act); return; }
    }
    later(act, aiBeat());
  }
  function aiAlchemist(u, foes) {
    // the flask's own declared planning numbers; only WHEN the escalation starts
    // is a battle-wide pacing knob
    // The escalation formula moved to core/threat.mjs, unchanged, because the
    // danger-zone shading has to project the SAME reach this plans with — a
    // warning drawn from a smaller number than the AI is about to use is a
    // warning that lies. One function, two consumers, no drift.
    const flask = abilities.get('flask');
    const flaskR = escalatedAbilityRange(flask, { round: round(), escalateStart: escalateStart() });
    const flaskable = () => foes.filter(f => !hasStatus(f, 'poison') && dist(u, f) <= flaskR
      && dist(u, f) >= flask.ai.minDistance);
    const act = () => {
      if (u.tp >= flask.cost) {
        const cand = flaskable();
        // prod the front-runner: whoever has pushed deepest into the town
        if (cand.length) { castAbility(u, 'flask', advanced(cand), endTurn); return; }
      }
      const shots = attackTargets(u).filter(t => dist(u, t) >= 2);
      if (shots.length) { u.acted = true; attack(u, weakest(shots), endTurn); return; }
      // nothing to throw and nothing to shoot: brace only with points the flask
      // does not want, otherwise bank them
      guardOrEnd(u, foes, flask.cost);
    };
    // Panic: an alchemist with a soldier at arm's length runs first — but it
    // ACTS afterwards like every other branch. Handing `act` here rather than a
    // bare guard is the fix for the defect Jonah found: the flee used to be
    // terminal (move, then brace, unconditionally), so an alchemist that had
    // backed off never re-checked whether its new tile put someone in throwing
    // range. Measured on main with no flags at all: one alchemist banked to
    // 4 TP and still never threw, because every one of its turns ended in that
    // branch. The 'keep station' branch below always passed `act`; this one
    // simply never did.
    if (nearestFoe(u, foes) <= 1) {
      const plan = repositionTo(u, t => nearestFoe(t, foes) * 10 - t.d * 0.5);
      floatText('!', tileCenter(u.x, u.z).add(new THREE.Vector3(0, 1.9, 0)), '#8fe07a');
      // smartMilitia OFF restores main's terminal flee: run, then brace, and
      // never re-check whether the new tile put anyone in throwing range.
      const after = smartMilitia() ? act : (() => guardOrEnd(u, foes));
      if (plan) { aiMoveThen(u, plan, after); return; }
      later(after, aiBeat()); return;
    }
    if (flaskable().length || attackTargets(u).some(t => dist(u, t) >= 2)) { later(act, aiBeat()); return; }
    // ELEMENT 5: the alchemists advance too, but they NEVER LEAD. The score
    // keeps them at throwing distance and heavily penalises any tile where no
    // ally stands closer to the enemy than they would — an alchemist at the
    // front is a dead alchemist, and it panics and flees the moment anyone
    // reaches it, which would undo the whole push.
    if (shouldAdvance(u)) {
      const plan = repositionTo(u, t => {
        const mn = nearestFoe(t, foes);
        const screened = living(u.team).some(a =>
          a.id !== u.id && a.alive && nearestFoe(a, foes) < mn);
        return (screened ? 0 : -300) + (mn <= 2 ? -200 : 0)
          - Math.abs(mn - flaskR) * 5 - t.d * 0.5;
      }, { anyTerrace: true });
      if (plan) { aiMoveThen(u, plan, act); return; }
    }
    // keep station behind the archers, at about flask range
    if (nearestFoe(u, foes) <= engageRange) {
      const plan = repositionTo(u, t => {
        const mn = nearestFoe(t, foes);
        return (mn <= 2 ? -200 : 0) - Math.abs(mn - flaskR) * 5 - t.d * 0.5;
      });
      if (plan) { aiMoveThen(u, plan, act); return; }
    }
    later(act, aiBeat());
  }

  return { aiTurn };
}
