/**
 * Which tiles the enemy could reach and hit — the model behind danger-zone
 * shading and the threat arcs drawn from it.
 *
 * The ruling this implements (DESIGN.md, 2026-08-02) is GEOMETRIC threat, not
 * behavioural. A tile is dangerous when some living enemy COULD attack it on
 * its next turn, whether or not that enemy would: the militia's hold-your-
 * terrace discipline stays hidden, and so does their focus-fire rule. Two
 * reasons, and the second is the important one. The first is that a shading
 * derived from AI policy is a strategy guide, which is not what the player is
 * owed. The second is failure direction: a geometric answer can only ever
 * over-warn, and over-warning costs the player a cautious move, while
 * under-warning costs them a unit.
 *
 * Everything map-shaped arrives as a predicate, the way `core/grid.mjs` takes
 * its traversal rules, so the same model serves the ravine and the gallery and
 * can be tested against a flat board with no scene graph in sight.
 */

import { gridKey } from './grid.mjs';

/**
 * An ability's reach at a given round, including any pacing escalation it
 * declares.
 *
 * The alchemist's flask grows +1 tile every two rounds past ESCALATE_START so
 * that stalling is never free, and that growth is what actually reaches a
 * careless player by round 10 — the definition's declared `range` alone
 * understates it by up to five tiles. `core/enemy-ai.mjs` plans with this and
 * the threat model shades with it, from one function, because a warning drawn
 * from a smaller number than the AI is about to use is a warning that lies.
 */
export function escalatedAbilityRange(def, { round = 1, escalateStart = Infinity } = {}) {
  const ai = def && def.ai;
  if (!ai || !ai.escalateEveryRounds) return def ? def.range : 0;
  const grown = Math.max(0, Math.floor((round - escalateStart) / ai.escalateEveryRounds));
  return Math.min(ai.rangeCap, def.range + grown);
}

/**
 * Every tile at least one plan can strike, mapped to the ids that can strike it.
 *
 * A plan is one threatening unit's worst case, already resolved by the caller:
 *
 *   id        who threatens
 *   stances   every tile it could act FROM — its reachable set plus where it
 *             already stands, which is the stance a unit that never moves uses
 *   melee     the step offsets it may swing along, or null if it has no swing
 *   minRange  near edge of its shooting envelope (1 = no minimum, and a hole in
 *             the middle of the arc is what rules.archerMinRange creates)
 *   maxRange  far edge, 0 if it has no ranged option at all
 *
 * `tileAllowed` filters what may be marked (the caller passes walkability: a
 * tile the player cannot stand on cannot be a tile they are warned about), and
 * `stepAllowed` gates each melee swing the way the real attack does — the
 * climb limit, chiefly.
 */
export function threatenedTiles(plans, {
  width,
  depth,
  tileAllowed = () => true,
  stepAllowed = () => true,
  // How far apart two tiles count as being, for RANGE purposes. Chebyshev
  // (square envelope) by default; the diamondRange rule swaps in Manhattan.
  // It arrives as a parameter rather than being imported so the shading can
  // never disagree with the legality check the game will actually apply.
  metric = (ax, az, bx, bz) => Math.max(Math.abs(ax - bx), Math.abs(az - bz)),
  // (plan, stanceX, stanceZ, tileX, tileZ) -> is the shot actually available?
  // rules.arrowLos means a body in the way refuses the shot, and a lane the
  // rules refuse is not a threat. Defaults to "always clear" so a caller
  // without the rule pays nothing.
  laneClear = () => true,
} = {}) {
  const out = new Map();
  const mark = (x, z, id) => {
    if (x < 0 || x >= width || z < 0 || z >= depth) return;
    if (!tileAllowed(x, z)) return;
    const key = gridKey(x, z, width);
    let ids = out.get(key);
    if (!ids) out.set(key, ids = []);
    if (!ids.includes(id)) ids.push(id);
  };
  for (const plan of plans) {
    const max = Math.max(0, plan.maxRange || 0);
    const min = Math.max(1, plan.minRange || 1);
    for (const stance of plan.stances) {
      if (plan.melee) {
        for (const [dx, dz] of plan.melee) {
          const nx = stance.x + dx, nz = stance.z + dz;
          if (stepAllowed(stance.x, stance.z, nx, nz)) mark(nx, nz, plan.id);
        }
      }
      if (max < min) continue;
      // The envelope, hollow when the unit has a minimum range. The bounding
      // box is always the square one — a diamond of radius N fits inside it —
      // and `metric` decides which tiles inside it actually count. Testing the
      // ring with the SAME metric the game applies is deliberate: rebuilding
      // the shape any other way is how a shading starts disagreeing with what
      // the game will let happen.
      for (let z = stance.z - max; z <= stance.z + max; z++) {
        for (let x = stance.x - max; x <= stance.x + max; x++) {
          const d = metric(stance.x, stance.z, x, z);
          if (d < min || d > max) continue;
          if (!laneClear(plan, stance.x, stance.z, x, z)) continue;
          mark(x, z, plan.id);
        }
      }
    }
  }
  return out;
}

/** Who threatens one tile, as ids, or an empty array. */
export function threatsAt(map, x, z, width) {
  return map.get(gridKey(x, z, width)) || [];
}
