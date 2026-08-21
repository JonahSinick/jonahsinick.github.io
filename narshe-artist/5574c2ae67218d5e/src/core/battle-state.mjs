/**
 * Serializable battle-domain unit state and its damage/defeat transitions.
 *
 * This module owns hit-point changes and the downed-versus-defeated rule as
 * pure data transitions that synchronously return domain events. It knows
 * nothing about Three.js, the DOM, animation, or timing: callers hold unit
 * objects carrying at least the domain fields created here, apply transitions,
 * and present the returned events. Events reference units by id only, so an
 * event log stays replayable without live object references.
 *
 * Every temporary condition a unit can be under — the steadied bow, poison,
 * last turn's guard, grief, a queued reprisal, Cassien's mark — lives in one
 * generic collection owned by `core/statuses.mjs`; the transitions here apply
 * and read it rather than each owning a field.
 */

import {
  addStatus,
  ageSourcedStatuses,
  beginTurnStatuses,
  createStatuses,
  hasStatus,
  hasStatusFrom,
  removeStatus,
  removeStatusQuietly,
  serializeStatuses,
  statusData,
  statusOf,
} from './statuses.mjs';

/** Domain fields, in serialization order. View/render fields never appear here. */
export const UNIT_DOMAIN_FIELDS = [
  'id', 'name', 'role', 'team', 'cls',
  'x', 'z', 'hp', 'maxHp', 'atk', 'move', 'speed', 'range', 'abil',
  'alive', 'downed', 'downable',
  'tp', 'moved', 'acted', 'form', 'statuses',
];

export function createUnitState({
  id,
  name,
  role = '',
  team,
  cls = '',
  x,
  z,
  hp,
  maxHp = hp,
  atk = 0,
  move = 0,
  speed = 0,
  range = 1,
  abil = [],
  downable = false,
  form = null,
}) {
  return {
    id, name, role, team, cls,
    x, z, hp, maxHp, atk, move, speed, range, abil,
    alive: true, downed: false, downable,
    tp: 0, moved: false, acted: false, form,
    statuses: createStatuses(),
  };
}

/**
 * Grief scaling: a unit whose bond partner has fallen hits harder from that
 * point on, and any fixed reaction damage it owns scales with it.
 *
 * The multiplier is CAPTURED in the status's `data` rather than read live at
 * each use. Attack scaling is applied once, at the moment of the fall, while
 * reaction damage is computed later when it fires; reading a tunable global at
 * both moments let a mid-battle tuning change produce two different active
 * multipliers on the same unit. Storing it also makes the doubled atk
 * explainable on replay: the event says what it was multiplied by and from
 * what, so a restored save cannot double-apply it. That is why the status
 * itself is announced by this richer event rather than a bare `statusAdded`.
 */
export function applyBerserkState(unit, multiplier) {
  if (!unit.alive || isBerserk(unit)) return [];
  const atkFrom = unit.atk;
  addStatus(unit, 'berserk', { data: { multiplier } });
  unit.atk = Math.round(atkFrom * multiplier);
  return [{
    type: 'berserkApplied', unitId: unit.id, multiplier, atkFrom, atkTo: unit.atk,
  }];
}

export function isBerserk(unit) { return hasStatus(unit, 'berserk'); }

/**
 * The multiplier this unit's grief was applied with, or null if it never
 * turned. Always read through here rather than from the live tunable: this is
 * the number that already moved its atk.
 */
export function berserkMultiplierOf(unit) {
  const data = statusData(unit, 'berserk');
  return data ? data.multiplier : null;
}

/** Plain domain snapshot of a unit that may also carry presentation fields. */
export function serializeUnit(unit) {
  const snapshot = {};
  for (const field of UNIT_DOMAIN_FIELDS) snapshot[field] = unit[field];
  snapshot.abil = [...(unit.abil || [])];
  snapshot.statuses = serializeStatuses(unit);
  return snapshot;
}

/**
 * Apply damage and resolve a fall. Downable units (the militia) collapse to
 * `unitDowned` and stay on the field; anyone else falls to `unitDefeated`.
 * Stored hp may go negative, matching the display clamp staying in one place.
 * A unit that is already down never re-emits a fall event.
 */
export function applyDamageState(unit, amount, kind = 'attack', sourceId = null) {
  const wasAlive = unit.alive;
  unit.hp -= amount;
  const events = [
    { type: 'damageApplied', unitId: unit.id, amount, hp: unit.hp, kind, sourceId },
  ];
  if (unit.hp <= 0 && wasAlive) {
    unit.alive = false;
    // The reticle goes down with its owner, quietly: the fall event is the
    // news, and the fall's own view code hides the mesh.
    removeStatusQuietly(unit, 'aimed');
    // Fall events carry the damage kind so a consumer can tell an in-band
    // fall (attack/poison/cry, whose turn flow handles the ending) from an
    // out-of-band one (revenge) that nothing else observes.
    if (unit.downable) {
      unit.downed = true;
      events.push({ type: 'unitDowned', unitId: unit.id, kind });
    } else {
      events.push({ type: 'unitDefeated', unitId: unit.id, kind });
    }
  }
  return events;
}

/** Healing clamps at maxHp and is quiet when there is nothing to restore. */
export function applyHealState(unit, amount) {
  const healed = Math.min(amount, unit.maxHp - unit.hp);
  if (healed <= 0 || !unit.alive) return [];
  unit.hp += healed;
  return [{ type: 'healApplied', unitId: unit.id, amount: healed, hp: unit.hp }];
}

/**
 * A stress switch changes what a unit IS mid-battle: its form, role label,
 * and ability kit. Stats and position stay; the presentation layer owns how
 * the moment looks.
 */
export function switchFormState(unit, { form, role, abil }) {
  unit.form = form;
  unit.role = role;
  unit.abil = [...abil];
  return [{ type: 'formChanged', unitId: unit.id, form, role }];
}

/**
 * A self-inflicted cost that can never fell its payer: the charge is clamped
 * to leave 1 hp. Returns an empty event list when nothing can be paid.
 */
export function applySelfCost(unit, amount) {
  const paid = Math.min(amount, unit.hp - 1);
  if (paid <= 0) return [];
  return applyDamageState(unit, paid, 'self');
}

/** Spending turn points never goes below zero and always consumes the action. */
export function spendTp(unit, cost) {
  unit.tp = Math.max(0, unit.tp - cost);
  unit.acted = true;
  return [{ type: 'tpSpent', unitId: unit.id, cost, tp: unit.tp }];
}

export function setAimedState(unit, on) {
  if (hasStatus(unit, 'aimed') === !!on) return [];
  return on ? addStatus(unit, 'aimed') : removeStatus(unit, 'aimed');
}

export function setPoisonState(unit, turns) {
  return turns > 0 ? addStatus(unit, 'poison', { turns }) : removeStatus(unit, 'poison');
}

export function beginDefend(unit) {
  unit.acted = true;
  return addStatus(unit, 'defending');
}

/**
 * The start-of-turn economy: gain a capped turn point, recover move/action,
 * then let this unit's own statuses expire, age and bite — which is where last
 * turn's guard drops and poison stings. On the tick that exhausts the poison
 * its removal precedes the damage; that ordering is `statuses.mjs`'s rule now,
 * stated there rather than emergent here. Poison can fell its victim, so
 * callers must check `unit.alive` before proceeding.
 */
export function beginTurnState(unit, { tpGain = 1, tpCap = 5, poisonDamage = 0 } = {}) {
  unit.tp = Math.min(tpCap, unit.tp + tpGain);
  unit.moved = false;
  unit.acted = false;
  return [
    { type: 'turnStarted', unitId: unit.id, tp: unit.tp },
    // the transitions a status effect may run arrive as arguments, so the
    // definition table never has to import this module back
    ...beginTurnStatuses(unit, { poisonDamage, damage: applyDamageState }),
  ];
}

/**
 * Righteous Anger's mark: a status on the TARGET carrying its caster's id.
 * Cassien holds one at a time, so placing a new one displaces any existing
 * mark — silently, exactly as the single battle-level slot it replaces did,
 * since the displaced target's chevron is about to move to the new one anyway.
 */
export function setMarkState(units, casterId, targetId, turns = 2) {
  for (const unit of units) removeStatusQuietly(unit, 'marked');
  const target = units.find(u => u.id === targetId);
  if (!target) return [];
  return addStatus(target, 'marked', { sourceId: casterId, turns });
}

export function clearMarkState(units) {
  for (const unit of units) {
    if (statusOf(unit, 'marked')) return removeStatus(unit, 'marked');
  }
  return [];
}

/**
 * The clocks that run on THIS unit's turn but sit on someone else: today only
 * the mark, which ages at its caster's turn starts and expires unused after
 * two of them.
 */
export function tickSourcedStatuses(units, unitId) {
  return ageSourcedStatuses(units, unitId);
}

/** Is this unit carrying that caster's mark? */
export function isMarked(unit, casterId) {
  return hasStatusFrom(unit, 'marked', casterId);
}

/** Whoever currently carries a mark, or null. */
export function markedUnit(units) {
  return units.find(unit => statusOf(unit, 'marked')) || null;
}

/**
 * Victory is the enemy wiped out, checked first so a mutual final blow still
 * wins. Defeat comes in two doctrines: Battle 1 loses when the roster drops
 * below `requiredPlayers` (all three imperials survive that story), while a
 * battle may instead name `essentialIds` — FFT-style, the fight is lost only
 * when an essential unit falls, however many others do.
 */
export function battleOutcome(units, {
  playerTeam = 'player',
  enemyTeam = 'enemy',
  requiredPlayers = 3,
  essentialIds = null,
} = {}) {
  const living = team => units.filter(u => u.alive && u.team === team).length;
  if (living(enemyTeam) === 0) return 'victory';
  if (essentialIds) {
    const fallen = essentialIds.some(id => {
      const u = units.find(v => v.id === id);
      return !u || !u.alive;
    });
    if (fallen) return 'defeat';
  }
  if (living(playerTeam) < requiredPlayers) return 'defeat';
  return null;
}
