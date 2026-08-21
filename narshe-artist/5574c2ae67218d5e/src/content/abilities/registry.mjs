/**
 * The ability registry: one definition per ability, one consumer per question.
 *
 * An ability used to be spread across six places — a metadata table, a
 * targeting switch, a legality switch, a forecast branch, an execution
 * function, and the three dispatch sites that picked which execution function
 * to call — so adding one meant six coordinated edits and any of them could be
 * forgotten. The classic symptom is a forecast that stops mirroring execution.
 *
 * This module answers the questions that are pure: what can this ability be
 * pointed at, and may this unit cast it right now. It holds no rules of its
 * own — the shape of a target set follows from the definition's declared `aim`,
 * and everything battlefield-specific (who is alive, how far apart two tiles
 * are, which tiles a burst may cover) arrives as an injected `field`, so the
 * same registry works for any map.
 *
 * Definitions themselves live in content (`battle-kit.mjs`). Execution and
 * forecast stay on the definition rather than here because they are animated
 * and rendered; the registry's job is to make sure every consumer reaches them
 * through the same door.
 */

/**
 * How a definition declares what it may be pointed at:
 * - `self`   nothing to pick; the caster is the target
 * - `ally`   a living unit on the caster's team within range
 * - `enemy`  a living unit on the other team within range
 * - `burst`  the caster's own footprint — every castable tile within range
 */
export const ABILITY_AIMS = ['self', 'ally', 'enemy', 'burst'];

/** Named rather than duck-typed so an incomplete definition fails at boot. */
const REQUIRED_FIELDS = ['id', 'name', 'cost', 'range', 'aim', 'hl'];

/**
 * `field` is the battlefield the questions are asked about:
 *   units      live roster array
 *   distance   (a, b) -> tiles apart, by the map's own metric
 *   width      grid columns
 *   depth      grid rows
 *   castable   (x, z) -> may a burst cover this tile
 *   burstDistance  the metric a BURST measures with, which is not necessarily
 *                  the one a pointed ability measures with: Mournful Cry is a
 *                  5x5 square around the caster by Jonah's spec, and stays
 *                  square even when weapon ranges become diamonds
 */
function targetsOf(def, unit, field) {
  const { distance } = field;
  const burstDistance = field.burstDistance || distance;
  if (def.aim === 'enemy') {
    return field.units.filter(t => t.alive && t.team !== unit.team && distance(unit, t) <= def.range);
  }
  if (def.aim === 'ally') {
    return field.units.filter(t => t.alive && t.team === unit.team && distance(unit, t) <= def.range);
  }
  if (def.aim === 'burst') {
    // the square the burst will cover, drawn around the caster as a preview
    const out = [];
    for (let z = 0; z < field.depth; z++) {
      for (let x = 0; x < field.width; x++) {
        if (field.castable(x, z) && burstDistance(unit, { x, z }) <= def.range) out.push({ x, z });
      }
    }
    return out;
  }
  return [];
}

/**
 * The same reach as `targetsOf`, drawn over TILES: every square this ability
 * could in principle be pointed at, empty ones included.
 *
 * A pointed ability (`enemy`/`ally`) used to highlight its target LIST, so its
 * range was invisible until something walked into it — the same complaint the
 * attack highlight answered with `attackFootprint`, and the answer here is the
 * same shape so that one colour means one thing across every action. A burst
 * already draws its own footprint, so it is returned unchanged; `self` has no
 * square to point at.
 *
 * `standable` is the "could a unit be there" test (the page's walkability);
 * a square nothing can occupy can never hold a target, so lighting it would be
 * noise. Fields that do not declare one fall back to `castable`, the burst's
 * own tile test.
 */
function footprintOf(def, unit, field) {
  if (def.aim === 'burst') return targetsOf(def, unit, field);
  if (def.aim !== 'enemy' && def.aim !== 'ally') return [];
  const { distance } = field;
  const standable = field.standable || field.castable;
  const out = [];
  for (let z = 0; z < field.depth; z++) {
    for (let x = 0; x < field.width; x++) {
      if (!standable(x, z)) continue;
      // an enemy-pointed ability can never be aimed at the caster's own square,
      // the way `attackFootprint` never lights the attacker's; an ally-pointed
      // one can, because the caster is a legal target of its own heal
      if (def.aim === 'enemy' && x === unit.x && z === unit.z) continue;
      if (distance(unit, { x, z }) <= def.range) out.push({ x, z });
    }
  }
  return out;
}

export function createAbilityRegistry(definitions = []) {
  const byId = Object.create(null);
  for (const def of definitions) {
    const missing = REQUIRED_FIELDS.filter(key => def[key] === undefined);
    if (missing.length) {
      throw new Error(`ability '${def.id || '(unnamed)'}': missing ${missing.join(', ')}`);
    }
    if (!ABILITY_AIMS.includes(def.aim)) {
      throw new Error(`ability '${def.id}': unknown aim '${def.aim}'`);
    }
    if (byId[def.id]) throw new Error(`duplicate ability id '${def.id}'`);
    byId[def.id] = def;
  }

  return {
    definitions,
    /** Keyed view, for the debug adapter and for metadata reads by id. */
    byId,
    ids: definitions.map(def => def.id),

    get(id) { return byId[id] || null; },
    has(id) { return !!byId[id]; },

    /** Tiles or units this ability may be pointed at. Unknown ids target nothing. */
    targets(unit, id, field) {
      const def = byId[id];
      return def ? targetsOf(def, unit, field) : [];
    },

    /**
     * The range envelope as tiles, for the HIGHLIGHT only. Legality still comes
     * from `targets`/`canCast` at every commit site.
     */
    footprint(unit, id, field) {
      const def = byId[id];
      return def ? footprintOf(def, unit, field) : [];
    },

    /**
     * May this unit cast this now: it has to be in the unit's kit, the unit
     * must not have acted, the points must be there, and a pointed ability
     * needs something to point at. Self and burst abilities always have a
     * legal target — the caster's own tile.
     */
    canCast(unit, id, field) {
      const def = byId[id];
      if (!def) return false;
      if (!unit.abil.includes(id) || unit.acted || unit.tp < def.cost) return false;
      if (def.aim === 'self' || def.aim === 'burst') return true;
      return targetsOf(def, unit, field).length > 0;
    },
  };
}
