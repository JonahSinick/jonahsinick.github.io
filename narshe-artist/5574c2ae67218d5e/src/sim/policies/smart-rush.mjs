/**
 * The smart rush INSTRUMENT, ported from `tools/smart_rush_bot.py`.
 *
 * Not a gate, and the port must not turn it into one. `rush_bot.py` is a straw
 * man that dies; Jonah beat Battle 1 with attack-only play, so the straw man
 * stopped being evidence for "abilities must be ESSENTIAL". This is the
 * stronger instrument: Move/Attack/Defend/Wait only, played the way a
 * competent first-timer plays them. If THIS wins, the doctrine is unmet. It
 * reports a result; it never reports a pass.
 *
 * What it is allowed to know is deliberately limited to what a player sees —
 * the roster projection, the move highlight, the terrace heights and the
 * forecast panel's arithmetic. It never reads the enemy AI, the defeat
 * condition, the RNG or ability internals. The port preserves that boundary:
 * `bot.heights` is `__BATTLE.tileTop`, which is what the Python reads, and the
 * damage model here is the tooltip's, not `core/combat.mjs`'s.
 *
 * One structural change from the original, which uses module-level `HEIGHTS`
 * and `RULES` globals: those live on the bot instead, so a thousand replays in
 * one process cannot bleed into each other. The Python hangs its stall state on
 * the bot for the same reason.
 */

import { cheb, manh, maxBy, minBy } from '../bot.mjs';

const MAX_ROUNDS = 25;

// The forecast panel's arithmetic, as the player reads it off the tooltip.
const HI_MOD = 1.25, LO_MOD = 0.8;
const ADJ_PENALTY = 0.4;
const LO_ROLL = 0.82, HI_ROLL = 1.18;
const CLIMB = 2 * 0.3 + 0.05;     // a melee swing crosses one terrace

const LOW_HP = 0.30;
const POISON_TICK = 6;
const STALL_ROUNDS = 3;

/**
 * Python's `round`: half-to-even, not JavaScript's half-up. The kill test is
 * `round(mid * 0.82) >= hp`, so on an exact half this is the difference between
 * committing to a kill and holding — a one-line divergence that would surface
 * as a different battle several rounds later.
 */
function pyRound(x) {
  const floor = Math.floor(x);
  const frac = x - floor;
  if (frac > 0.5) return floor + 1;
  if (frac < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

const sameTile = (a, b) => a.x === b.x && a.z === b.z;

// --------------------------------------------------------------- board reading
const height = (bot, t) => bot.heights[t.z][t.x];

function hmod(bot, att, dfn) {
  const a = height(bot, att), b = height(bot, dfn);
  return a > b ? HI_MOD : a < b ? LO_MOD : 1.0;
}

/**
 * The distance a weapon's range is measured in on THIS build. Square envelope
 * by default, a diamond under `diamondRange` — the player is told which by the
 * shape the target highlight paints, so the bot gets the same answer.
 */
const rdist = (bot, a, b) => (bot.rules.diamondRange ? manh(a, b) : cheb(a, b));

/** How far this militiaman can reach, as the player has seen it happen. */
const covers = f => f.reach + (f.cls === 'alchemist' ? 1 : 0);

const threat = (bot, tile, foes) => foes.filter(f => rdist(bot, tile, f) <= covers(f)).length;

/** HP minus the poison already ticking — the number a rusher misreads. */
const effectiveHp = u => u.hp - u.poison * POISON_TICK;

/** How badly this one wants killing first, all else equal. */
const danger = f => (f.cls === 'archer' && f.aimed ? 2 : f.cls === 'archer' ? 1 : 0);

const pointBlank = (bot, me, tile, foe) => me.reach > 1 && rdist(bot, tile, foe) <= 1;

function canHit(bot, me, tile, foe) {
  if (me.reach > 1) {
    if (pointBlank(bot, me, tile, foe) && bot.rules.archerMinRange) return false;
    return rdist(bot, tile, foe) <= me.reach;
  }
  return manh(tile, foe) === 1 && Math.abs(height(bot, tile) - height(bot, foe)) <= CLIMB;
}

/** Mid-roll damage the forecast would print for this strike. */
function damage(bot, me, tile, foe) {
  const scale = pointBlank(bot, me, tile, foe) ? ADJ_PENALTY : 1.0;
  let base = me.atk * scale * hmod(bot, tile, foe);
  if (foe.defending) base /= 2;
  return base;
}

// ------------------------------------------------------------------ the policy
/** Every (stand here, hit that) pair available this turn. */
function options(bot, me, tiles, foes) {
  const out = [];
  for (const t of tiles) {
    for (const f of foes) {
      if (!canHit(bot, me, t, f)) continue;
      const mid = damage(bot, me, t, f);
      out.push({
        tile: t, foe: f, mid,
        sureKill: pyRound(mid * LO_ROLL) >= f.hp,
        mayKill: pyRound(mid * HI_ROLL) >= f.hp,
        threat: threat(bot, t, foes),
      });
    }
  }
  return out;
}

/** Walk to the chosen tile (if any) and swing. Returns true if it landed. */
function take(bot, opt, me, why) {
  const t = opt.tile;
  if (!sameTile(t, me)) bot.moveTo(t.x, t.z);
  bot.note(why, me.name);
  return bot.attackAt(opt.foe.x, opt.foe.z);
}

function reposition(bot, me, tiles, score) {
  const dest = maxBy(tiles, score);
  if (!sameTile(dest, me)) bot.moveTo(dest.x, dest.z);
  return bot.me();
}

/** End a turn that had no strike in it: brace if under fire, else hold. */
function finish(bot, me, foes) {
  if (me && threat(bot, bot.here(me), foes) > 0 && bot.defend()) {
    bot.note('defend', me.name);
    return;
  }
  bot.wait();
}

export function smartTurn(bot, s) {
  /** Live view: me, the tiles I may still take, the militia still up. */
  const board = () => {
    const st = bot.state();
    const u = bot.me();
    if (!u) return [null, [], bot.live('enemy')];
    return [u, [bot.here(u)].concat(st.moved ? [] : bot.reach()), bot.live('enemy')];
  };

  let [me, tiles, foes] = board();
  if (!foes.length || !me) return;
  const allies = bot.live('player').filter(u => u.name !== me.name);
  const pressing = !!bot.pressing;
  const critical = effectiveHp(me) < LOW_HP * me.maxHp && !pressing;

  // ---- 1. kill securing ---------------------------------------------------
  // A unit about to die does not trade: it is worth more alive next round than
  // one dead militiaman is now. The exception is the swing that ends the battle.
  let opts = options(bot, me, tiles, foes);
  const kills = (!critical || foes.length === 1) ? opts.filter(o => o.mayKill) : [];
  if (kills.length) {
    const best = maxBy(kills, o => [
      o.sureKill, danger(o.foe), -o.threat, o.mid, -o.tile.d, -o.foe.hp,
    ]);
    if (take(bot, best, me, `kill shot -> ${best.foe.name} (${best.foe.hp} hp)`)) return;
    [me, tiles, foes] = board();          // the swing was refused: re-plan from here
  }

  // ---- 2. self-preservation ----------------------------------------------
  if (me && critical && tiles.length > 1) {
    bot.note(`hurt (${me.hp} hp${me.poison ? `, ${me.poison} poison` : ''}): breaking off`,
      me.name);
    const foesNow = foes;
    me = reposition(bot, me, tiles, t => [
      -threat(bot, t, foesNow), Math.min(...foesNow.map(f => rdist(bot, t, f))), t.z, -t.d,
    ]);
    finish(bot, me, bot.live('enemy'));
    return;
  }

  // ---- 3. focus fire ------------------------------------------------------
  opts = me ? options(bot, me, tiles, foes) : [];
  if (opts.length) {
    const weakest = minBy(opts, o => [o.foe.hp, -danger(o.foe), o.foe.x, o.foe.z]).foe;
    const onIt = opts.filter(o => o.foe.name === weakest.name);
    const best = maxBy(onIt, o => [o.mid, -o.threat, -o.tile.d]);
    if (take(bot, best, me, `focus ${weakest.name} (${weakest.hp} hp)`)) return;
    [me, tiles, foes] = board();
  }

  // ---- 4. group advance ---------------------------------------------------
  if (me && foes.length && tiles.length > 1) {
    // approach urgency: alchemists first (they flee on contact and their poison
    // is what actually grinds a rusher down), then whoever is already hurt
    const foesNow = foes;
    const pull = t => Math.min(...foesNow.map(
      f => rdist(bot, t, f) * 2 + (f.cls === 'alchemist' ? 0 : 1) + f.hp / 100.0));

    // "arriving together": someone is already in the fire, or at least two of us
    // could be in it this turn
    const arriving = [me].concat(allies).filter(
      u => Math.min(...foesNow.map(f => rdist(bot, u, f) - covers(f))) <= u.move).length;
    const supported = allies.some(u => threat(bot, bot.here(u), foesNow) > 0) || arriving >= 2;
    const openGround = tiles.filter(t => threat(bot, t, foesNow) === 0);
    const pool = (supported || pressing || !openGround.length) ? tiles : openGround;
    if (!(supported || pressing) && openGround.length)
      bot.note('holding short — going in alone', me.name);
    me = reposition(bot, me, pool, t => [-pull(t), -threat(bot, t, foesNow), -t.d]);
  }

  // ---- 5. brace or hold ---------------------------------------------------
  me = bot.me();
  foes = bot.live('enemy');
  if (me && foes.length) {
    // the walk may have opened a shot the plan did not have
    const late = options(bot, me, [bot.here(me)], foes);
    if (late.length) {
      const best = maxBy(late, o => [o.mayKill, -o.foe.hp, o.mid]);
      if (bot.attackAt(best.foe.x, best.foe.z)) return;
    }
  }
  finish(bot, me, foes);
}

/**
 * The impatience valve: three rounds without denting the militia and the
 * caution comes off. A human does not stand in the road all afternoon, and the
 * flask range escalates on a stall anyway.
 */
export function smartRushTurn(bot, s) {
  const hpNow = bot.live('enemy').reduce((sum, u) => sum + Math.max(u.hp, 0), 0);
  if (s.round !== bot.stallRound) {
    if (hpNow < (bot.stallHp ?? Infinity)) bot.stallAt = s.round;
    bot.stallHp = hpNow;
    bot.stallRound = s.round;
    const was = !!bot.pressing;
    bot.pressing = s.round - (bot.stallAt ?? s.round) >= STALL_ROUNDS;
    if (bot.pressing && !was) bot.note('STALL-BREAK: pressing', 'bot');
  }
  smartTurn(bot, s);
}

export const smartRushPolicy = {
  id: 'smart-rush',
  battle: null,
  maxRounds: MAX_ROUNDS,
  /**
   * NOT a gate. `smart_rush_bot.py` exits 0 on any clean run and says so in its
   * header: reading the verdict is the point. A `pass` field here would quietly
   * promote an instrument into a doctrine nobody ruled on.
   */
  gate: false,
  setup(bot, sim) {
    bot.heights = sim.api.tileTop;
    // Which combat rules this build is running — the rules the PLAYER is
    // playing under, spelled out by the forecast panel and the tile shading.
    // Absent (main today) means the default rule set.
    bot.rules = (sim.api.rules ? sim.api.rules() : {}) || {};
  },
  turn: smartRushTurn,
  verdict(roster, state, outcome = null) {
    const players = roster.filter(u => u.team === 'player');
    const enemies = roster.filter(u => u.team === 'enemy');
    // The ENGINE decides which of these happened, so this reads the same under
    // either outcome rule. Deriving it from the roster instead hard-codes one:
    // under the old rule one casualty was the whole verdict, so a run that lost
    // Cassien in round 4 and cleared the gate in round 9 was filed as a loss.
    const standing = players.filter(u => u.alive).length;
    const won = outcome === 'victory';
    const lost = outcome === 'defeat';
    return {
      result: won ? 'WIN' : lost ? 'LOSS' : 'TIMEOUT',
      militiaDown: enemies.filter(u => !u.alive).length,
      standing: players.filter(u => u.alive).length,
      round: state.round,
    };
  },
};
