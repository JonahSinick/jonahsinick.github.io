/**
 * Balance gate A's doctrine, ported from `tools/rush_bot.py`, and the
 * warning-bell encounter's mirror of it, from
 * `tools/warbell_indiscriminate_bot.py`.
 *
 * Both are straw men on purpose and both MUST LOSE: rush walks up the road at
 * the nearest guard and swings, and indiscriminate does the same to the bonded
 * pair, where every unprepared hit buys a fixed reprisal. If either survives,
 * the abilities are decorative and the encounter is not carrying its design.
 *
 * Ported line-by-line under the rules in `policies/kit.mjs`'s header.
 */

import { cheb, manh, minBy, sortedBy } from '../bot.mjs';

const sameTile = (a, b) => a.x === b.x && a.z === b.z;

// ------------------------------------------------------------------ battle 1
export function rushTurn(bot, s) {
  const foes = bot.live('enemy');
  let me = bot.me();
  if (!foes.length || !me) return;
  const goal = minBy(foes, f => cheb(me, f));
  if (!s.moved) {
    const tiles = bot.reach();
    if (tiles.length) {
      // closest to the target, and among equals the one that got furthest up the road
      const best = minBy(tiles, t => [cheb(t, goal), t.z, -t.d]);
      if (compare([cheb(best, goal), best.z], [cheb(me, goal), me.z]) < 0)
        bot.moveTo(best.x, best.z);
    }
  }
  me = bot.me();
  if (!me) return;
  for (const f of sortedBy(bot.live('enemy'), f => cheb(me, f))) {
    if (bot.attackAt(f.x, f.z)) return;
  }
  bot.wait();
}

/** The one place rush compares two tuples directly rather than through a key. */
function compare(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

export const rushPolicy = {
  id: 'rush',
  battle: null,
  maxRounds: 12,
  gate: true,
  turn: rushTurn,
  /**
   * ALL-UNITS-DEFEATED: the old stop -- "the moment an imperial falls" -- now
   * halts a battle that is still being fought, and would score a party of two
   * that goes on to clear the gate as a collapse. It stops on a WIPE now.
   */
  stop: bot => bot.roster().filter(u => u.team === 'player').every(u => !u.alive),
  /**
   * tools/rush_bot.py, and it tracks that file's claim exactly -- SIM_USAGE's
   * trap: a verdict that stops matching the doctrine keeps reporting healthy
   * rates against a claim nobody is making any more.
   *
   * INTERIM (lead, 2026-08-03; Jonah may supersede): rush-only play must not
   * take the gate INTACT. The wipe reading it replaces cannot be met at all
   * under `rules.lastStanding` -- a rush party is never wiped in battle 1 --
   * while the intact reading leaves the measured balance untouched: the same
   * 39 seeds in 1,000 that beat it before the ruling beat it after.
   *
   * `collapsed` and `cleared` are still reported, so the engine's own answer
   * stays visible next to the doctrine's.
   */
  verdict(roster, state, outcome = null) {
    const players = roster.filter(u => u.team === 'player');
    const down = players.filter(u => !u.alive).map(u => u.name);
    const cleared = roster.filter(u => u.team === 'enemy').every(u => !u.alive);
    const intact = players.length > 0 && players.every(u => u.alive);
    return {
      down, collapsed: outcome === 'defeat', cleared, intact,
      pass: !(cleared && intact) && state.round <= 12, round: state.round,
    };
  },
};

// ------------------------------------------------------------- warning bell
/** Melee reach is the four orthogonal neighbours; bows use their envelope. */
function inStrike(tile, foe, me) {
  if (me.reach > 1) return cheb(tile, foe) <= me.reach;
  return manh(tile, foe) === 1;
}

export function indiscriminateTurn(bot, s) {
  const foes = bot.live('enemy');
  let me = bot.me();
  if (!foes.length || !me) return;
  const goal = minBy(foes, f => [cheb(me, f), f.hp]);
  if (!s.moved) {
    const cands = [bot.here(me)].concat(bot.reach());
    const shooting = cands.filter(t => foes.some(f => inStrike(t, f, me)));
    // get in range if possible, otherwise simply close the distance
    const dest = shooting.length
      ? minBy(shooting, t => t.d)
      : minBy(cands, t => [cheb(t, goal), t.d]);
    if (!sameTile(dest, me)) bot.moveTo(dest.x, dest.z);
  }
  me = bot.me();
  if (!me) return;
  for (const f of sortedBy(bot.live('enemy'), f => [cheb(me, f), f.hp])) {
    if (bot.attackAt(f.x, f.z)) return;
  }
  bot.wait();
}

export const warbellRushPolicy = {
  id: 'warbell-rush',
  battle: 'warningbell',
  maxRounds: 12,
  gate: true,
  turn: indiscriminateTurn,
  /**
   * ALL-UNITS-DEFEATED, here too (Jonah retired the Seira-only rule in BOTH
   * battles): her fall no longer ends the encounter, so the run continues
   * until nobody is standing.
   */
  stop: bot => bot.roster().filter(u => u.team === 'player').every(u => !u.alive),
  /**
   * The claim survives the rule change with its wording updated: unprepared
   * attacking into the bonded pair must LOSE, which now means wiped rather
   * than "Seira fell". A cleared field is still an explicit failure -- it
   * would mean the pair is not punishing unprepared attacks.
   */
  verdict(roster, state, outcome = null) {
    const seira = roster.find(u => u.name === 'Seira') || null;
    const cleared = roster.filter(u => u.team === 'enemy').every(u => !u.alive);
    return {
      lost: outcome === 'defeat', cleared, round: state.round,
      seiraHp: seira ? Math.max(0, seira.hp) : null,
      pass: outcome === 'defeat' && !cleared && state.round <= 12,
    };
  },
};
