/**
 * Serializable battle-domain unit state and its damage/defeat transitions.
 *
 * This module owns hit-point changes and the downed-versus-defeated rule as
 * pure data transitions that synchronously return domain events. It knows
 * nothing about Three.js, the DOM, animation, or timing: callers hold unit
 * objects carrying at least the domain fields created here, apply transitions,
 * and present the returned events. Events reference units by id only, so an
 * event log stays replayable without live object references.
 */

/** Domain fields, in serialization order. View/render fields never appear here. */
export const UNIT_DOMAIN_FIELDS = [
  'id', 'name', 'role', 'team', 'cls',
  'x', 'z', 'hp', 'maxHp', 'atk', 'move', 'speed', 'range', 'abil',
  'alive', 'downed', 'downable', 'defending',
  'tp', 'moved', 'acted', 'aimed', 'poison', 'form',
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
    alive: true, downed: false, downable, defending: false,
    tp: 0, moved: false, acted: false, aimed: false, poison: 0, form,
  };
}

/** Plain domain snapshot of a unit that may also carry presentation fields. */
export function serializeUnit(unit) {
  const snapshot = {};
  for (const field of UNIT_DOMAIN_FIELDS) snapshot[field] = unit[field];
  snapshot.abil = [...(unit.abil || [])];
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
    unit.aimed = false;
    if (unit.downable) {
      unit.downed = true;
      events.push({ type: 'unitDowned', unitId: unit.id });
    } else {
      events.push({ type: 'unitDefeated', unitId: unit.id });
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
  if (unit.aimed === !!on) return [];
  unit.aimed = !!on;
  return [{ type: on ? 'statusAdded' : 'statusRemoved', unitId: unit.id, status: 'aimed' }];
}

export function setPoisonState(unit, turns) {
  const had = unit.poison > 0;
  unit.poison = turns;
  if (turns > 0) return [{ type: 'statusAdded', unitId: unit.id, status: 'poison', turns }];
  return had ? [{ type: 'statusRemoved', unitId: unit.id, status: 'poison' }] : [];
}

export function beginDefend(unit) {
  unit.defending = true;
  unit.acted = true;
  return [{ type: 'statusAdded', unitId: unit.id, status: 'defending' }];
}

/**
 * The start-of-turn economy: gain a capped turn point, recover move/action,
 * drop last turn's guard, then let poison bite. On the tick that exhausts the
 * poison, its removal precedes the damage — the sting still lands. Poison can
 * fell its victim, so callers must check `unit.alive` before proceeding.
 */
export function beginTurnState(unit, { tpGain = 1, tpCap = 5, poisonDamage = 0 } = {}) {
  unit.tp = Math.min(tpCap, unit.tp + tpGain);
  unit.moved = false;
  unit.acted = false;
  const events = [{ type: 'turnStarted', unitId: unit.id, tp: unit.tp }];
  if (unit.defending) {
    unit.defending = false;
    events.push({ type: 'statusRemoved', unitId: unit.id, status: 'defending' });
  }
  if (unit.poison > 0) {
    unit.poison--;
    if (unit.poison === 0) events.push({ type: 'statusRemoved', unitId: unit.id, status: 'poison' });
    events.push(...applyDamageState(unit, poisonDamage, 'poison'));
  }
  return events;
}

/**
 * Battle-level serializable state. Holds what no single unit owns; round and
 * turn-queue migrate in here as later slices land. Righteous Anger's mark
 * references units by id only, one mark at a time.
 */
export function createBattleState() {
  return { mark: null };
}

export function setMarkState(battle, casterId, targetId, turns = 2) {
  battle.mark = { casterId, targetId, turns };
  return [{ type: 'statusAdded', unitId: targetId, status: 'marked', casterId, turns }];
}

export function clearMarkState(battle) {
  if (!battle.mark) return [];
  const { casterId, targetId } = battle.mark;
  battle.mark = null;
  return [{ type: 'statusRemoved', unitId: targetId, status: 'marked', casterId }];
}

/** The mark ages only at its caster's turn starts and expires unused after two. */
export function tickMark(battle, unitId) {
  if (!battle.mark || battle.mark.casterId !== unitId) return [];
  battle.mark.turns--;
  return battle.mark.turns <= 0 ? clearMarkState(battle) : [];
}

export function isMarked(battle, casterId, targetId) {
  return !!(battle.mark && battle.mark.casterId === casterId && battle.mark.targetId === targetId);
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
