/**
 * The battlefield the rules are asked about: what is walkable, who is standing
 * where, how far a unit can get, what it can hit, and what the ground is worth.
 *
 * These are the ten predicates every rules module already takes as injected
 * context (`enemy-ai.mjs` names five of them in its contract; `unit-actions`,
 * the ability kit and the debug adapter take the rest). They were defined
 * inline in the page's composition root, coupled to that file's module-scope
 * terrain arrays, which meant the only way to ask "where can this unit walk"
 * was to boot a browser. Nothing here touches Three.js, the DOM or a timer —
 * the map arrives as plain arrays and the roster as the live array the page
 * mutates, exactly as `core/grid.mjs` already takes its callbacks.
 *
 * The distinction against `core/grid.mjs` is deliberate: that module is the
 * pure square-grid algorithm (BFS, distances, path reconstruction) with no
 * notion of a battle; this one binds one battle's terrain, roster and combat
 * constants to it and hands back the predicates the game asks by name.
 */

import { heightModifier } from './combat.mjs';
import {
  CARDINAL_DIRECTIONS as DIRS,
  chebyshevDistance as cheb,
  findReachable,
  reconstructPath,
} from './grid.mjs';
import { hasStatus } from './statuses.mjs';

/**
 * @param {object} context
 * @param {number} context.width       grid columns
 * @param {number} context.depth       grid rows
 * @param {number[][]} context.heights per-tile height in height units (`H`)
 * @param {number[][]} context.tiles   per-tile terrain type (`T`)
 * @param {boolean[][]} context.blocked scenery occupancy (`BLOCKED`)
 * @param {number} context.rockTile    the terrain type nothing may stand on
 * @param {number} context.stairTile   the terrain type that bridges a 2-unit rise
 * @param {Array} context.units        the live roster array (mutated by the page)
 * @param {number} context.aimBonusRange extra tiles a steadied bow reaches
 * @param {number} context.highGroundMultiplier
 * @param {number} context.lowGroundMultiplier
 * @param {boolean} context.zonedAi    terraces the AI holds, vs one flat floor
 *
 * The last three are the REACH RULES, and they are optional because their
 * defaults are the game as main plays it: a square metric, no minimum range,
 * and nothing between two tiles that can stop a shot. Experiment batch 1
 * replaces all three (`diamondRange`, `archerMinRange`, `arrowLos`) and they
 * arrive here rather than being applied by the page, because "what can this
 * unit hit" has to have exactly ONE definition. The version of this branch that
 * kept a second `attackTargets` in the composition root is how a rule ends up
 * enforced in the UI and not in the AI that plans against it.
 *
 * @param {function} [context.rangeDistance] (a, b) -> tiles apart, for reach
 * @param {function} [context.minShotRange]  (unit) -> near edge of its envelope
 * @param {function} [context.shotBlocked]   (attacker, target) -> is the lane closed
 * @param {function} [context.bodiesBlock]   () -> do the fallen hold their tile
 */
export function createBattleGrid({
  width, depth, heights, tiles, blocked, rockTile, stairTile,
  units, aimBonusRange, highGroundMultiplier, lowGroundMultiplier, zonedAi,
  rangeDistance = cheb, minShotRange = () => 1, shotBlocked = () => false,
  bodiesBlock = () => false,
}) {
  for (const [name, value] of Object.entries({
    width, depth, heights, tiles, blocked, rockTile, stairTile,
    units, aimBonusRange, highGroundMultiplier, lowGroundMultiplier, zonedAi,
  })) {
    if (value === undefined || value === null)
      throw new Error(`battle-grid: missing context "${name}"`);
  }

  function inBounds(x, z) { return x >= 0 && x < width && z >= 0 && z < depth; }
  function walkable(x, z) {
    return inBounds(x, z) && tiles[z][x] !== rockTile && !blocked[z][x];
  }
  // stairs bridge the 2-unit terrace jumps; everything else is a 1-unit step
  function stepOK(x0, z0, x1, z1) {
    const lim = (tiles[z0][x0] === stairTile || tiles[z1][x1] === stairTile) ? 2 : 1;
    return Math.abs(heights[z1][x1] - heights[z0][x0]) <= lim;
  }
  // an unzoned battlefield is one level: the AI may roam all of it
  function terraceOf(z) {
    return !zonedAi ? 0 : z >= 14 ? 0 : z >= 10 ? 1 : z >= 6 ? 2 : 3;
  }

  function unitAt(x, z) { return units.find(u => u.alive && u.x === x && u.z === z); }
  /**
   * Anyone lying on this tile, standing or fallen — where "fallen" means
   * `downed`, and NOT merely `!alive`.
   *
   * That distinction is the whole subtlety. A DOWNED unit kneels and stays
   * where it dropped: nothing is ever removed or faded, because the
   * post-battle scene needs the bodies visible. A DEFEATED one (`downable:
   * false` — the bonded pair) fades, sinks and is taken off the field
   * entirely. Both are `!alive`, and only the first leaves anything behind.
   * So blocking on `!alive` would wall off a square with nothing standing on
   * it, which is the same readability error as standing inside a corpse, run
   * backwards — and the warning bell asserts exactly that, because Cassien
   * walks over the felled beast's tile on his way in.
   *
   * Only `reachable` asks this, and only while `rules.bodiesBlock` is on.
   * TARGETING still asks `unitAt`, because a body is not a foe — a melee swing
   * at the tile next to you must not find the militiaman who already fell
   * there.
   */
  function bodyAt(x, z) {
    return units.find(u => (u.alive || (u.downed && bodiesBlock()))
      && u.x === x && u.z === z);
  }
  function unitById(id) { return units.find(v => v.id === id); }
  function living(team) { return units.filter(u => u.alive && u.team === team); }

  // BFS over walkable tiles: standing enemies block pass-through, allies are
  // passable but not standable, and a fallen body of either team is treated
  // like an ally — you step over it, you do not come to rest on top of it.
  function reachable(u) {
    return findReachable({
      start: u,
      maxSteps: u.move,
      width,
      canTraverse: (x, z, nx, nz) =>
        walkable(nx, nz) && stepOK(x, z, nx, nz),
      occupantAt: bodyAt,
      isHostile: occupant => occupant.alive && occupant.team !== u.team,
    });
  }
  function pathTo(res, u, tx, tz) {
    const path = reconstructPath(res, u, { x: tx, z: tz });
    if (!path)
      throw new Error(`path invariant failed: (${tx},${tz}) is not reachable`);
    return path;
  }

  // a steadied bow reaches two tiles further, which is the whole point of Take Aim
  function shotRange(u) {
    return u.range > 1 && hasStatus(u, 'aimed') ? u.range + aimBonusRange : u.range;
  }
  // melee: 4-neighbours, climbable within 2 height units. Ranged: the reach
  // envelope, which by default is the Chebyshev square with no near edge and no
  // line-of-sight test — the terraces are open enough that occlusion never
  // bites — and which the injected reach rules turn into a diamond with a hole
  // in the middle and a lane that a body or a wall can close.
  function attackTargets(u) {
    if (u.range > 1) {
      const near = minShotRange(u), far = shotRange(u);
      return units.filter(t => t.alive && t.team !== u.team
        && rangeDistance(u, t) <= far && rangeDistance(u, t) >= near
        && !shotBlocked(u, t));
    }
    const out = [];
    for (const [dx, dz] of DIRS) {
      const nx = u.x + dx, nz = u.z + dz;
      if (!inBounds(nx, nz)) continue;
      if (Math.abs(heights[nz][nx] - heights[u.z][u.x]) > 2) continue;
      const t = unitAt(nx, nz);
      if (t && t.team !== u.team) out.push(t);
    }
    return out;
  }

  /**
   * The same envelope as `attackTargets`, drawn over TILES instead of bodies:
   * every square this unit could in principle strike, whether or not anything
   * is standing on it.
   *
   * It exists because range has to READ as range. The attack highlight used to
   * be the target list, so a bow with nothing in its arc lit nothing at all and
   * a bow with one victim lit one square — the player could see who was
   * reachable but never how far the weapon went, and the only way to learn the
   * envelope was to walk into it. Lighting the whole envelope makes the reach
   * visible on an empty field.
   *
   * IN-PRINCIPLE ELIGIBLE, deliberately: LINE OF SIGHT IS IGNORED here even
   * when `rules.arrowLos` is on. A lane that a body or a wall happens to close
   * this instant is still inside the weapon's reach, and shading it as out of
   * range would teach the player the wrong shape — the blocked lane is the
   * transient fact, the envelope is the permanent one. Legality is unaffected:
   * every commit site still asks `attackTargets`, which does test the lane, so
   * a highlight can never grant a shot the rules refuse (the same discipline
   * the move highlight documents — it colours squares, it never grants them).
   *
   * Squares nothing could stand on (rock, scenery footprints, off the board)
   * are left out: they can never hold a target, so lighting them would be
   * noise rather than information.
   */
  function attackFootprint(u) {
    const out = [];
    if (u.range > 1) {
      const near = minShotRange(u), far = shotRange(u);
      for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
          if (!walkable(x, z)) continue;
          const d = rangeDistance(u, { x, z });
          if (d <= far && d >= near) out.push({ x, z });
        }
      }
      return out;
    }
    for (const [dx, dz] of DIRS) {
      const nx = u.x + dx, nz = u.z + dz;
      if (!walkable(nx, nz)) continue;
      if (Math.abs(heights[nz][nx] - heights[u.z][u.x]) > 2) continue;
      out.push({ x: nx, z: nz });
    }
    return out;
  }

  function heightMod(att, def) {
    return heightModifier(
      heights[att.z][att.x],
      heights[def.z][def.x],
      highGroundMultiplier,
      lowGroundMultiplier,
    );
  }

  /**
   * How many steps each tile is from the nearest of `targets`, walking.
   *
   * A multi-source BFS over walkable tiles, climb limits included, ignoring
   * bodies — it answers "how far is that, going round", which straight-line
   * distance cannot. The militia needed it: an archer holding the terrace
   * behind the bunkhouse would sit six tiles from a lone imperial for
   * twenty-six rounds, because every tile it could reach in one turn was
   * straight-line FURTHER from the target than standing still. Its advance
   * scored greedily on a distance the building made meaningless, so it stalled
   * in a dead end no human would stall in, and the battle ran to the round cap
   * with nobody able to reach anybody.
   *
   * Returns `(x, z) -> steps`, and Infinity for a tile with no route at all.
   */
  function approachCost(targets) {
    const steps = new Map();
    const key = (x, z) => x + z * width;
    const queue = [];
    for (const t of targets) {
      if (!inBounds(t.x, t.z)) continue;
      steps.set(key(t.x, t.z), 0);
      queue.push([t.x, t.z]);
    }
    for (let head = 0; head < queue.length; head++) {
      const [x, z] = queue[head];
      const cost = steps.get(key(x, z));
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (!walkable(nx, nz) || steps.has(key(nx, nz))) continue;
        if (!stepOK(x, z, nx, nz)) continue;
        steps.set(key(nx, nz), cost + 1);
        queue.push([nx, nz]);
      }
    }
    return (x, z) => (steps.has(key(x, z)) ? steps.get(key(x, z)) : Infinity);
  }

  return {
    inBounds, walkable, stepOK, terraceOf,
    unitAt, bodyAt, unitById, living,
    reachable, pathTo, approachCost,
    shotRange, attackTargets, attackFootprint, heightMod,
  };
}
