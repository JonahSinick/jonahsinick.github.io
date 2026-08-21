/**
 * The formation layer, ported from `tools/tandem.py`.
 *
 * Two bots share it byte for byte and differ in ONE respect — whether they use
 * abilities — which is what makes the pair a doctrine test rather than two
 * anecdotes. Everything here is movement:
 *
 *   COHESION  never get more than LEAD tiles ahead of the rear-most ally. A
 *             unit that outruns the party becomes the sole focus-fire target,
 *             which is the failure the traces showed: a four-tile column with
 *             the lead unit draining 52 hp to 6 while an ally at full health
 *             was never shot at.
 *   ROTATION  the front seat belongs to whoever can afford it. A front unit
 *             below ROTATE_HP falls back and a healthier ally steps up. Every
 *             policy before this one pinned one unit to the front and it held
 *             the seat until it died.
 *
 * Ported under the rules in `policies/kit.mjs`'s header: Python's `min` with a
 * tuple key is `minBy` with an array key, and the environment ablations
 * (NARSHE_TANDEM_ROTATE, NARSHE_SCREEN) become explicit options, because a sim
 * policy that reads process.env is a policy nobody can pin to a fixture.
 */

import { cheb, manh, minBy } from '../bot.mjs';

export const LEAD = 2;          // tiles a unit may lead the rear-most ally by
export const ROTATE_HP = 0.50;  // below this the front unit hands the seat over
export const STANDOFF = 3;      // where a hurt unit wants to sit: back, not gone
export const PRESS_AFTER = 3;   // rounds without progress before caution comes off

/** Measure the way the build measures — diamond or square. */
export function dist(bot, a, b) {
  return bot.sim.api.rules().diamondRange ? manh(a, b) : cheb(a, b);
}

export function toEnemy(bot, tile, foes) {
  return Math.min(...foes.map(f => dist(bot, tile, f)));
}

export const party = bot => bot.live('player');
const alliesOf = (bot, me) => party(bot).filter(u => u.name !== me.name);

export function frontOf(bot, foes, pool = null) {
  const units = pool || party(bot);
  return units.length ? minBy(units, u => toEnemy(bot, u, foes)) : null;
}

const fitForFront = (u, rotateHp) => u.hp >= rotateHp * u.maxHp;

/**
 * Should this unit be taking the front seat right now? Yes when it is fit and
 * either nobody fit is in front, or the current front unit has dropped below
 * the rotation threshold — which is what makes a fresh ally step up as the tank
 * falls back, instead of the tank simply dying.
 */
export function wantsFront(bot, me, foes, rotateHp = ROTATE_HP) {
  if (!fitForFront(me, rotateHp)) return false;
  const front = frontOf(bot, foes);
  if (!front || front.name === me.name) return true;
  return !fitForFront(front, rotateHp);
}

/**
 * Would standing here keep the party together? Measured in distance-to-enemy
 * rather than distance-to-ally: what matters is not being scattered, it is not
 * being the one out in front alone.
 */
export function cohesive(bot, tile, me, foes) {
  const others = alliesOf(bot, me);
  if (!others.length) return true;
  const rear = Math.max(...others.map(a => toEnemy(bot, a, foes)));
  return rear - toEnemy(bot, tile, foes) <= LEAD;
}

/**
 * Who the militia are committed to killing, inferred from the board alone.
 * Fair play: `rules.stickyFocus` makes them finish the most wounded reachable
 * imperial, so the most wounded imperial IS the victim — and staying that way
 * is the problem, since rotating out no longer sheds the attention.
 */
export function likelyVictim(bot, foes) {
  const live = party(bot);
  if (!live.length) return null;
  return minBy(live, u => [u.hp / Math.max(u.maxHp, 1), toEnemy(bot, u, foes)]);
}

/**
 * Would standing here put a body in the lane to the victim? Approximated as
 * "between them and the enemy, and right next to them", which is what a
 * screening body looks like on this map — and under `rules.arrowLos` that is a
 * real answer rather than a gesture.
 */
export function screens(bot, tile, victim, foes) {
  if (!victim) return false;
  if (tile.x === victim.x && tile.z === victim.z) return false;
  return toEnemy(bot, tile, foes) < toEnemy(bot, victim, foes)
    && dist(bot, tile, victim) <= 1;
}

/**
 * The sort key for choosing a tile. Cohesion is the PRIMARY term for everyone:
 * a tile that breaks formation is rejected before anything else is considered,
 * because breaking formation is the failure this module exists to prevent.
 */
export function moveKey(bot, me, foes, { screen = false, rotateHp = ROTATE_HP } = {}) {
  const forward = wantsFront(bot, me, foes, rotateHp);
  const victim = screen ? likelyVictim(bot, foes) : null;
  const guarding = !!victim && victim.name !== me.name && victim.hp < 0.6 * victim.maxHp;
  return t => {
    const near = toEnemy(bot, t, foes);
    const broke = cohesive(bot, t, me, foes) ? 0 : 1;
    if (guarding) {
      const shield = screens(bot, t, victim, foes) ? 0 : 1;
      return [broke, shield, near, t.d];
    }
    // A fit unit taking the front closes; everyone else holds a STANDOFF —
    // deliberately a target distance rather than "as far as possible", because
    // maximising the gap deadlocked the party: hurt units retreated without a
    // floor, cohesion dragged the fit one back with them, and a run froze from
    // round 15 to the cap with two militia standing and nobody moving.
    const role = forward ? near : Math.abs(near - STANDOFF);
    return [broke, role, t.d];
  };
}

/**
 * Has the party stopped making progress? Tracked by militia hit points rather
 * than kills so that chipping still counts; once nothing has moved for
 * PRESS_AFTER rounds the caution comes off and the party closes regardless.
 */
export function pressing(bot, s, foes) {
  const total = foes.reduce((sum, f) => sum + Math.max(f.hp, 0), 0) + foes.length * 1000;
  if (total < (bot.progress ?? Infinity)) {
    bot.progress = total;
    bot.progressRound = s.round;
  }
  return s.round - (bot.progressRound ?? s.round) >= PRESS_AFTER;
}

/** Move in formation if there is anywhere better to stand. Returns the unit. */
export function step(bot, me, s, foes, options = {}) {
  if (s.moved || !foes.length) return bot.me();
  const tiles = [bot.here(me), ...bot.reach()];
  if (pressing(bot, s, foes)) {
    const spot = minBy(tiles, t => [toEnemy(bot, t, foes), t.d]);
    if (spot.x !== me.x || spot.z !== me.z) {
      bot.moveTo(spot.x, spot.z);
      bot.note(`pressing (stalled ${PRESS_AFTER} rounds)`);
    }
    return bot.me();
  }
  const spot = minBy(tiles, moveKey(bot, me, foes, options));
  if (spot && (spot.x !== me.x || spot.z !== me.z)) bot.moveTo(spot.x, spot.z);
  return bot.me();
}
