/**
 * The parity oracle.
 *
 * The risk in a second implementation of a battle is silent divergence: a
 * context field the sim forgot to pass, an animation whose ordering the browser
 * depended on. `tests/golden/*.json` already records every domain event a
 * doctrine playthrough emits, round/turn/actor-tagged and normalized — so if
 * the node sim reproduces that file byte for byte, it IS the game. This is
 * wired as the FIRST gate on the headless path rather than the last
 * (tmp/approach-review.md, V1: "risk, and the mitigation is already
 * committed").
 *
 * Nothing here may ever regenerate a fixture. `tools/golden_log_check.py` owns
 * that, from a real browser, under the fixture discipline in its header. A
 * divergence reported here is a divergence in the SIM until proven otherwise.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { replay } from './replay.mjs';

export { replay };

/**
 * Which fixture set to diff against, matching `tools/golden_log_check.py`'s
 * `NARSHE_GOLDEN` exactly — same variable, same meaning, so the node oracle and
 * the browser recorder can never be pointed at different sets by accident.
 *
 * Unset (main) is `tests/golden/`. A branch whose combat rules are SWITCHES
 * keeps main's untouched recordings under a second set and proves the
 * equivalence by replaying with every flag off against them:
 *
 *     NARSHE_GOLDEN=rules-none node --test tests/sim-parity.test.mjs
 *
 * A divergence there means a flag leaked into a path that does not read it —
 * which is the failure such a branch would otherwise hide.
 */
const GOLDEN_SET = process.env.NARSHE_GOLDEN || '';
const GOLDEN_DIR = new URL(`../../tests/golden/${GOLDEN_SET ? `${GOLDEN_SET}/` : ''}`,
  import.meta.url);

export function readGolden(name) {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`${name}.json`, GOLDEN_DIR)), 'utf8'));
}

/** Which fixture set this process is checking against, for a report to name. */
export const goldenSet = () => GOLDEN_SET || 'golden';

/**
 * The first place two event streams differ, with the context the golden gate's
 * own reporter prints — round, turn, actor, and the last few matching events,
 * because an event stream diverging at index 141 is unreadable without them.
 * Returns null when they match.
 */
/**
 * The one difference a PRE-ATTRIBUTION recording is allowed to have.
 *
 * Until 2026-08-03 a reprisal's `damageApplied` carried `sourceId: null`: the
 * stream said revenge happened, how much, and to whom, but never who dealt it,
 * so a bond that answered with the wrong half of its pair replayed
 * byte-identical. Filling that in was approved deliberately (see the commit
 * that carries it), and it changes recorded bytes — including two fixture sets
 * that must NEVER be re-recorded, because their whole value is that their bytes
 * are old: `tests/golden/main/` (pre-batch main) and `tests/golden/rules-none/`
 * (main's own recordings, which prove the batch's rules are switches).
 *
 * So the diff tolerates exactly this: a fixture that recorded NO source for a
 * revenge event, against a replay that now names one. It is deliberately
 * one-directional and self-describing — a fixture that DOES name an avenger is
 * compared strictly, a replay that stops naming one still fails, and a replay
 * that names the WRONG one still fails. Nothing needs a list of which sets are
 * historical, and the tolerance stops applying to any set the moment it is
 * re-recorded.
 */
function preAttributionRevenge(goldenEvent, currentEvent) {
  return goldenEvent.type === 'damageApplied' && goldenEvent.kind === 'revenge' &&
         goldenEvent.sourceId === null && currentEvent.sourceId !== null &&
         JSON.stringify({ ...currentEvent, sourceId: null }) === JSON.stringify(goldenEvent);
}

export function diffLogs(golden, current, { contextLines = 3 } = {}) {
  const shared = Math.min(golden.length, current.length);
  for (let i = 0; i < shared; i++) {
    if (JSON.stringify(golden[i]) === JSON.stringify(current[i])) continue;
    if (preAttributionRevenge(golden[i], current[i])) continue;
    return {
      index: i,
      context: golden.slice(Math.max(0, i - contextLines), i),
      expected: golden[i],
      actual: current[i],
      message:
        `event stream diverges at index ${i} ` +
        `(round ${golden[i].round}, turn ${golden[i].turn}, actor ${golden[i].actorId})\n` +
        golden.slice(Math.max(0, i - contextLines), i)
          .map(e => `      last matching: ${JSON.stringify(e)}`).join('\n') +
        `\n      expected: ${JSON.stringify(golden[i])}` +
        `\n      got:      ${JSON.stringify(current[i])}`,
    };
  }
  if (golden.length !== current.length) {
    const short = golden.length > current.length;
    return {
      index: shared,
      context: golden.slice(Math.max(0, shared - contextLines), shared),
      expected: short ? golden[current.length] : null,
      actual: short ? null : current[golden.length],
      message: short
        ? `replay stopped ${golden.length - current.length} event(s) short of the fixture ` +
          `(fixture ${golden.length}, replay ${current.length})\n` +
          `      first missing event: ${JSON.stringify(golden[current.length])}`
        : `replay produced ${current.length - golden.length} event(s) beyond the fixture ` +
          `(fixture ${golden.length}, replay ${current.length})\n` +
          `      first extra event: ${JSON.stringify(current[golden.length])}`,
    };
  }
  return null;
}

/** Replay a policy and diff it against its committed browser fixture. */
export function checkParity(policy, fixtureName = policy.id, options = {}) {
  const result = replay(policy, options);
  return { ...result, divergence: diffLogs(readGolden(fixtureName), result.log) };
}
