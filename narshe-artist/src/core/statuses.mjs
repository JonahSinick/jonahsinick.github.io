/**
 * One generic collection of status effects, in place of six ad-hoc unit fields.
 *
 * Before this module a status was `aimed`/`poison`/`defending`/`berserk` +
 * `berserkMult`/`reprisalPending` on the unit and `mark` on the battle, and
 * adding one meant six coordinated edits: a field on the unit, a setter in
 * `battle-state.mjs`, a branch in the turn-start economy, an entry in
 * `UNIT_DOMAIN_FIELDS`, a view branch in the event seam and a line in the HUD.
 * That is the same failure mode `abilities/registry.mjs` was written to kill,
 * and the Enneagram stress/growth switching this game is built on is a
 * status-shaped problem by construction — per-type triggers, per-type
 * conditions, per-form kits. Adding a status is now an entry in `STATUS_DEFS`
 * plus however it wants to LOOK (a view branch in the seam, a HUD chip).
 *
 * A status instance is `{ id, sourceId, turns, data }`:
 *
 *  - `sourceId` is the unit that applied it, or null when the status has no
 *    author. Only the mark uses it, and it earns its place twice: the mark ages
 *    on its CASTER's turns rather than its bearer's, and "is this unit carrying
 *    *that* caster's mark" is the question the attack profile asks.
 *  - `turns` is a countdown, or null for a status with no clock of its own.
 *  - `data` holds values CAPTURED at onset. Berserk's multiplier lives here for
 *    the reason `applyBerserkState` has always stored it rather than read the
 *    tunable live: attack scaling is applied once at the moment of the fall
 *    while reaction damage is computed later, and reading a live global at both
 *    moments let one mid-battle slider move produce two different active
 *    multipliers on the same unit. Statuses carry captured values, never
 *    accessors.
 *
 * There is deliberately no stack count, no potency, no immunity table and no
 * on-apply hook: none of the six statuses needs one, and a speculative
 * mechanism is a rule nobody can point at a battle for.
 */

/**
 * What each status IS. Recognised declarations:
 *
 *  - `expiresAtTurnStart` — a stance that lasts "until your next turn": dropped
 *    whole at the bearer's turn start, no clock involved.
 *  - `agesAtTurnStart: 'bearer' | 'source'` — a countdown, spent either on the
 *    turns of whoever carries it or on the turns of whoever applied it.
 *  - `tick(unit, context)` — events produced each turn the status ages, whether
 *    or not that tick exhausted it. The context carries the turn economy's
 *    numbers plus the domain transitions the effect needs, so this table never
 *    has to import `battle-state.mjs` back.
 *  - `silent` — the collection announces nothing for it. Berserk's onset is
 *    reported by the richer `berserkApplied` event (it also moves atk, which a
 *    bare `statusAdded` could not explain on replay), and the reprisal latch is
 *    pure bookkeeping the player never sees.
 */
export const STATUS_DEFS = {
  // A steadied bow, held until the shot is taken. Nothing wears it down.
  aimed: {},
  // Last turn's guard, dropped at the start of this one.
  defending: { expiresAtTurnStart: true },
  // The alchemist's flask: bites at the victim's own turn start.
  poison: {
    agesAtTurnStart: 'bearer',
    tick: (unit, { poisonDamage = 0, damage }) => damage(unit, poisonDamage, 'poison'),
  },
  // Righteous Anger: Cassien's next hit on this unit deals ×3. It ages only on
  // HIS turns — the target running away does not wear it off — and expires
  // unused after two of them.
  marked: { agesAtTurnStart: 'source' },
  // Grief: the surviving half of the bonded pair hits harder from now on.
  // `data.multiplier` is what it was multiplied by, captured at that moment.
  berserk: { silent: true },
  // One reprisal per avenger per provocation (Jonah's rule). Set when a
  // reprisal is queued, cleared when the stone lands or aborts, and released
  // wholesale at the round boundary so an interrupted chain cannot disable
  // reprisals for the rest of the battle.
  reprisalPending: { silent: true },
};

function defOf(id) {
  const def = STATUS_DEFS[id];
  if (!def) throw new Error(`statuses: unknown status "${id}"`);
  return def;
}

/** A unit's starting collection: no statuses. */
export function createStatuses() { return []; }

export function statusOf(unit, id) {
  return unit.statuses.find(s => s.id === id) || null;
}
export function hasStatus(unit, id) {
  return !!statusOf(unit, id);
}
/** Turns left on a status, or 0 when it is absent or has no clock. */
export function statusTurns(unit, id) {
  const entry = statusOf(unit, id);
  return entry && entry.turns != null ? entry.turns : 0;
}
/** Is this unit carrying a status applied by that particular unit? */
export function hasStatusFrom(unit, id, sourceId) {
  const entry = statusOf(unit, id);
  return !!entry && entry.sourceId === sourceId;
}
/** The values captured when the status took hold, or null when it is absent. */
export function statusData(unit, id) {
  const entry = statusOf(unit, id);
  return entry ? entry.data : null;
}

// Events reference units by id only (the rule `battle-state.mjs` sets), and
// carry only the fields the status actually has: a clock reports its `turns`,
// an authored status reports its `casterId`, and neither appears on a status
// that has no such thing.
function addedEvent(unit, entry) {
  const event = { type: 'statusAdded', unitId: unit.id, status: entry.id };
  if (entry.sourceId != null) event.casterId = entry.sourceId;
  if (entry.turns != null) event.turns = entry.turns;
  return event;
}
function removedEvent(unit, entry) {
  const event = { type: 'statusRemoved', unitId: unit.id, status: entry.id };
  if (entry.sourceId != null) event.casterId = entry.sourceId;
  return event;
}

/**
 * Apply a status. Re-applying one the unit already carries REPLACES it — a
 * refreshed clock, a new caster — and announces the new instance, because none
 * of these six stacks.
 */
export function addStatus(unit, id, { sourceId = null, turns = null, data = null } = {}) {
  const def = defOf(id);
  const entry = { id, sourceId, turns, data };
  const at = unit.statuses.findIndex(s => s.id === id);
  if (at >= 0) unit.statuses[at] = entry;
  else unit.statuses.push(entry);
  return def.silent ? [] : [addedEvent(unit, entry)];
}

/** Remove a status the unit may or may not have, announcing it if it had one. */
export function removeStatus(unit, id) {
  const at = unit.statuses.findIndex(s => s.id === id);
  if (at < 0) return [];
  const [entry] = unit.statuses.splice(at, 1);
  return defOf(id).silent ? [] : [removedEvent(unit, entry)];
}

/**
 * Remove a status without announcing it. For the two places where the removal
 * is already covered by a louder moment: a unit's fall (whose own view code
 * hides the reticle, and whose `unitDowned`/`unitDefeated` event is the news),
 * and the round boundary's wholesale release of the reprisal latch.
 */
export function removeStatusQuietly(unit, id) {
  const at = unit.statuses.findIndex(s => s.id === id);
  if (at >= 0) unit.statuses.splice(at, 1);
  return [];
}

/**
 * The bearer's turn-start pass. THE TWO PHASES ARE THE RULE, not an accident of
 * iteration order: stances that last "until your next turn" drop first, then
 * lingering effects age and bite — which is the order the hand-written economy
 * emitted (guard dropped, then poison).
 *
 * Inside the second phase, poison's documented ordering survives intact: on the
 * tick that exhausts a status its removal is announced BEFORE its effect runs,
 * so the sting still lands on the turn the poison runs out.
 */
export function beginTurnStatuses(unit, context = {}) {
  const events = [];
  for (const entry of [...unit.statuses]) {
    if (defOf(entry.id).expiresAtTurnStart) events.push(...removeStatus(unit, entry.id));
  }
  for (const entry of [...unit.statuses]) {
    const def = defOf(entry.id);
    if (def.agesAtTurnStart !== 'bearer') continue;
    events.push(...ageOne(unit, entry, def, context));
  }
  return events;
}

/**
 * Statuses that spend their clock on their SOURCE's turns instead of their
 * bearer's — the mark, which is Cassien's to cash or lose. Called for the unit
 * whose turn is beginning; it searches every unit for statuses that unit owns.
 */
export function ageSourcedStatuses(units, sourceId, context = {}) {
  const events = [];
  for (const unit of units) {
    for (const entry of [...unit.statuses]) {
      const def = defOf(entry.id);
      if (def.agesAtTurnStart !== 'source' || entry.sourceId !== sourceId) continue;
      events.push(...ageOne(unit, entry, def, context));
    }
  }
  return events;
}

function ageOne(unit, entry, def, context) {
  const events = [];
  entry.turns--;
  if (entry.turns <= 0) events.push(...removeStatus(unit, entry.id));
  if (def.tick) events.push(...def.tick(unit, context));
  return events;
}

/** A deep-enough copy for serialization: entries and their captured data. */
export function serializeStatuses(unit) {
  return (unit.statuses || []).map(entry => ({
    ...entry, data: entry.data ? { ...entry.data } : entry.data,
  }));
}
