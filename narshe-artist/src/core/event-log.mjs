/**
 * Deterministic event-log capture for golden regression tests.
 *
 * Every domain mutation already funnels through one seam — `present()` in
 * `flow/battle-events.mjs` — and `battle-state.mjs`'s header already commits to
 * events that reference units by id only, so a log built from that stream stays
 * replayable without live object references. This module turns the stream into
 * records a fixture can diff byte-for-byte across runs and machines:
 *
 *  - no wall-clock or animation-derived field ever enters a record — only the
 *    domain event plus where in the battle it happened (round, the acting
 *    unit's queue index, its id, and a monotonic sequence number so replay
 *    order is explicit rather than inferred from array position);
 *  - every record's keys are sorted alphabetically at every level, so a
 *    reordered object literal upstream can never produce a spurious diff;
 *  - every number is rounded to a fixed precision, so float noise (a live
 *    tunable read a instruction apart, `Math.round` vs an unrounded multiplier)
 *    can never produce one either.
 */

const PRECISION = 6;

function roundNumber(n) {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** PRECISION;
  return Math.round(n * f) / f;
}

function normalize(value) {
  if (typeof value === 'number') return roundNumber(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return normalizeRecord(value);
  return value;
}

/** Sort keys alphabetically, recursively, so insertion order never matters. */
export function normalizeRecord(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort()) out[key] = normalize(obj[key]);
  return out;
}

/**
 * A capture buffer for one battle. `record` is the only write; everything
 * else is a domain event plus the four context fields above.
 */
export function createEventLog() {
  let entries = [];
  let seq = 0;
  return {
    /** Record one domain event with where-in-the-battle context. */
    record(round, turn, actorId, event) {
      entries.push(normalizeRecord({ seq: seq++, round, turn, actorId, ...event }));
    },
    /** The captured log so far, as plain serializable records. */
    entries: () => entries.slice(),
    /** Drop everything captured — for a fresh battle reusing the same page. */
    clear() { entries = []; seq = 0; },
  };
}
