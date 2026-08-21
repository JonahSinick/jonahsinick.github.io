/**
 * The warning-bell encounter's powered-play doctrine, ported from
 * `tools/warbell_kit_bot.py`.
 *
 * Same discipline as `policies/kit.mjs`: line-by-line, same branch order, same
 * comparator keys, same points at which the board is re-read — including the
 * places where the original measures a post-move position against a pre-move
 * roster snapshot (Seira's `wounded`/`patient` lists, Cassien's `marked`). Those
 * are load-bearing: enemies cannot move during a player turn, so the only stale
 * entry is the acting unit's own, and re-reading it would change which ally she
 * considers in range to mend.
 */

import { cheb, manh, maxBy, minBy } from '../bot.mjs';

const MAX_ROUNDS = 20;
const SEIRA_SAFE = 6;         // Ragna moves 4 and reaches 1: six keeps her out of the hunt
const CASSIEN_BREAK = 0.45;   // below this he disengages; the mark keeps for two turns

/** Manhattan tiles the melee pair can cover next phase (move + reach). */
function threat(tile, foes) {
  return foes.filter(f => manh(tile, f) <= f.move + 1).length;
}

/** One target at a time — whichever half of the pair dies first. */
function focusOf(foes) {
  return minBy(foes, f => [f.hp, f.name]);
}

const sameTile = (a, b) => a.x === b.x && a.z === b.z;

function stepTo(bot, me, cands, key) {
  const dest = maxBy(cands, key);
  if (!sameTile(dest, me)) bot.moveTo(dest.x, dest.z);
  return bot.me();
}

/**
 * Spend the move AFTER the blow, which the turn structure explicitly allows.
 * Against a melee-only pair that is the difference between paying a reprisal
 * and paying a reprisal plus two swings.
 */
function withdraw(bot, foes) {
  const s = bot.state();
  if (s.phase !== 'player' || s.moved) return;
  const me = bot.me();
  if (!me) return;
  const cands = [bot.here(me)].concat(bot.reach());
  const dest = maxBy(cands, t => [
    -threat(t, foes), Math.min(...foes.map(f => manh(t, f))), -t.d,
  ]);
  if (!sameTile(dest, me)) bot.moveTo(dest.x, dest.z);
}

// ------------------------------------------------------------------ Cassien
function cassien(bot, s) {
  const foes = bot.live('enemy');
  let me = bot.me();
  if (!foes.length || !me) return;
  const mk = s.mark;
  let marked = null;
  if (mk && mk.caster === 'Cassien') marked = foes.find(f => f.name === mk.target) || null;
  const goal = marked || focusOf(foes);

  // Standing next to the pair is what kills him, and a dead Cassien takes the
  // ×3 out of the fight for good. The mark survives two of his turns.
  if (me.hp < CASSIEN_BREAK * me.maxHp) {
    if (!s.moved) {
      const cands = [bot.here(me)].concat(bot.reach());
      me = stepTo(bot, me, cands, t => [-threat(t, foes), -t.d]);
    }
    if (me) bot.defend();
    return;
  }

  if (marked) {
    // cash it: the ×3 strike is the whole reason the mark was spent
    if (manh(me, marked) !== 1 && !s.moved) {
      const cands = [bot.here(me)].concat(bot.reach());
      const adj = cands.filter(t => manh(t, marked) === 1);
      if (adj.length) me = stepTo(bot, me, adj, t => -t.d);
    }
    if (me && manh(me, marked) === 1 && bot.attackAt(marked.x, marked.z)) {
      bot.note(`x3 cash -> ${marked.name}`);
      withdraw(bot, bot.live('enemy'));
      return;
    }
  }

  me = bot.me();
  if (!me) return;
  if (bot.abils().includes('anger')) {
    // mark from wherever is safest inside the 4-tile envelope; the swing comes
    // next turn, so there is no reason to stand in reach tonight
    if (!s.moved) {
      const cands = [bot.here(me)].concat(bot.reach());
      const inrange = cands.filter(t => cheb(t, goal) <= 4);
      if (inrange.length) me = stepTo(bot, me, inrange, t => [-threat(t, foes), -t.d]);
    }
    if (me && cheb(me, goal) <= 4 && bot.cast('anger', goal.x, goal.z)) {
      bot.note(`anger -> ${goal.name}`);
      return;
    }
  }

  // no mark and no TP to place one: an unprepared swing buys a reprisal at a
  // terrible rate, so close the ground and brace instead
  me = bot.me();
  if (!me) return;
  if (!s.moved) {
    const cands = [bot.here(me)].concat(bot.reach());
    me = stepTo(bot, me, cands, t => [-cheb(t, goal), -t.d]);
  }
  if (me && threat(bot.here(me), foes)) { bot.defend(); return; }
  bot.wait();
}

// ------------------------------------------------------------------ Brecht
function brecht(bot, s) {
  const foes = bot.live('enemy');
  let me = bot.me();
  if (!foes.length || !me) return;
  const goal = focusOf(foes);
  const reach = me.reach;

  if (me.aimed) {
    // loose the steadied shot from as far back as it still carries; only spend
    // the move if the shot does not already carry
    if (!s.moved && !(2 <= cheb(me, goal) && cheb(me, goal) <= reach)) {
      const cands = [bot.here(me)].concat(bot.reach());
      const good = cands.filter(t => 2 <= cheb(t, goal) && cheb(t, goal) <= reach);
      if (good.length) {
        me = stepTo(bot, me, good, t => [-threat(t, foes), cheb(t, goal), -t.d]);
      }
    }
    if (me && 2 <= cheb(me, goal) && cheb(me, goal) <= reach &&
        bot.attackAt(goal.x, goal.z)) {
      bot.note(`x2 shot -> ${goal.name}`);
      withdraw(bot, bot.live('enemy'));
      return;
    }
  }

  me = bot.me();
  if (!me) return;
  if (bot.abils().includes('aim')) {
    // steady the bow from a tile the pair cannot walk into and hit; the
    // steadied shot reaches two further, so hold that distance
    if (!s.moved) {
      const cands = [bot.here(me)].concat(bot.reach());
      me = stepTo(bot, me, cands, t => [
        -threat(t, foes), -Math.abs(cheb(t, goal) - (reach + 2)), -t.d,
      ]);
    }
    if (bot.cast('aim')) { bot.note(`take aim (focus ${goal.name})`); return; }
  }

  me = bot.me();
  if (me && threat(bot.here(me), foes)) { bot.defend(); return; }
  bot.wait();
}

// ------------------------------------------------------------------ Seira
function seira(bot, s) {
  const foes = bot.live('enemy');
  let me = bot.me();
  if (!foes.length || !me) return;
  const allies = bot.live('player');

  const hurt = u => u.maxHp - Math.max(0, u.hp);
  // Whoever is nearest to falling, as a FRACTION rather than a raw deficit:
  // Seira comes out of the opening 23 HP down and healing by deficit would have
  // her topping herself off while the attacker paying the reprisals bleeds out.
  const frailty = u => [-Math.max(0, u.hp) / u.maxHp, hurt(u)];

  const wounded = allies.filter(u => hurt(u) > 0);
  // The two attackers pay the reprisals, and a dead attacker is damage the
  // party never gets back. She tops herself up only once both are comfortable.
  const front = wounded.filter(u => u.name !== 'Seira');
  let patient;
  if (front.length && Math.min(...front.map(u => u.hp / u.maxHp)) < 0.85) {
    patient = maxBy(front, frailty);
  } else {
    patient = wounded.length ? maxBy(wounded, frailty) : null;
  }

  if (!s.moved) {
    const cands = [bot.here(me)].concat(bot.reach());
    const outside = (tile, floor) => !foes.some(f => manh(tile, f) < floor);

    // Stand as far out as the heal still reaches. Giving ground entirely is
    // useless when the man she has to mend is in melee, so the ring is relaxed
    // one step at a time rather than abandoned.
    let pool = null;
    for (const floor of [SEIRA_SAFE, 4, 3]) {
      const reachablePatient = cands.filter(
        t => outside(t, floor) && patient && cheb(t, patient) <= 3);
      if (reachablePatient.length) { pool = reachablePatient; break; }
    }
    if (pool === null) {
      const safe = cands.filter(t => outside(t, SEIRA_SAFE));
      pool = safe.length ? safe : cands;
    }
    me = stepTo(bot, me, pool, t => [Math.min(...foes.map(f => manh(t, f))), -t.d]);
  }

  if (me && patient && bot.abils().includes('heal')) {
    const local = wounded.filter(u => cheb(me, u) <= 3);
    const target = local.length ? maxBy(local, frailty) : null;
    if (target && bot.cast('heal', target.x, target.z)) {
      bot.note(`heal -> ${target.name}`);
      return;
    }
  }

  // nothing to mend: hold the line, never buy a reprisal with her own HP
  me = bot.me();
  if (me && threat(bot.here(me), foes)) { bot.defend(); return; }
  bot.wait();
}

const TURN = { Cassien: cassien, Brecht: brecht, Seira: seira };

export function warbellKitTurn(bot, s) {
  const fn = TURN[s.cur];
  if (fn) fn(bot, s);
}

export const warbellKitPolicy = {
  id: 'warbell-kit',
  battle: 'warningbell',
  maxRounds: MAX_ROUNDS,
  gate: true,
  turn: warbellKitTurn,
  /**
   * ALL-UNITS-DEFEATED (Jonah, 2026-08-02, retiring his own Seira-only rule):
   * "cleared AND Seira standing" is no longer the encounter's defeat rule, so
   * it is no longer this gate's claim. A line that loses her and wins on the
   * survivors is legal now. Her state is still REPORTED, because whether the
   * winning line costs the protagonist is a thing the designer wants to see
   * even when it is not a loss.
   */
  verdict(roster, state, outcome = null) {
    const players = roster.filter(u => u.team === 'player');
    const seira = roster.find(u => u.name === 'Seira') || null;
    const standing = players.filter(u => u.alive).length;
    return {
      won: outcome === 'victory',
      seiraStanding: !!seira && seira.alive,
      pass: outcome === 'victory',
      standing, round: state.round,
    };
  },
};
