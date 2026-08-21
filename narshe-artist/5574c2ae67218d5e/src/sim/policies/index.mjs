/**
 * Every doctrine the sim can play, in one list.
 *
 * The registry exists so that a caller cannot quietly run one policy and call
 * the answer a verdict. `tools/sim_matrix.mjs` enforces that structurally
 * against this list; `tests/sim-parity.test.mjs` holds every entry to its
 * browser fixture. A new doctrine is an entry here plus its fixture — the same
 * shape as adding an ability to `content/abilities/registry.mjs`.
 *
 * REGISTERING A POLICY COMMITS YOU TO A FIXTURE, and that is the point: the
 * parity suite iterates this list, so an entry with no `tests/golden/<id>.json`
 * fails it. Membership here means "the project may quote this policy's
 * numbers", and that entitlement comes from having been checked against the
 * browser. An exploratory policy — a hand-tried variant, or one a policy search
 * produced — is simply not registered; `runMatrix` accepts any policy objects
 * it is handed, so exploration costs nothing and stays visibly outside the
 * validated set. See SIM_USAGE.md.
 *
 * Each policy declares:
 *   id         the fixture name in tests/golden/ and the matrix's column label
 *   battle     the `?battle=` value it is played on (null = the Narshe gate)
 *   maxRounds  its own round cap
 *   gate       whether it makes a pass/fail doctrine claim, or is an instrument
 *   turn       (bot, state) -> plays one turn
 *   stop       optional early-exit, when the gate's question is already answered
 *   setup      optional page reads the policy is allowed to make before playing
 *   verdict    (roster, state) -> what this doctrine concluded
 */

import { alchHuntPolicy, kitBatchPolicy, tandemPolicy } from './batch.mjs';
import { kitPolicy } from './kit.mjs';
import { rushPolicy, warbellRushPolicy } from './rush.mjs';
import { smartRushPolicy } from './smart-rush.mjs';
import { warbellKitPolicy } from './warbell-kit.mjs';

/**
 * Battle 1's must-WIN gate is `kit-v4`, and the swap happened on 2026-08-03
 * with `rules.smartMilitia`.
 *
 * `kit-v3` was written against militia that reflex-guard, plink from arm's
 * length and never throw a flask. Jonah ruled those behaviours out of the game,
 * and the policy that beat them stopped being competent play the same day: over
 * 1,000 seeds it falls from 79.0% to 38.5%, and at seed 1 — the seed every
 * browser gate runs — it now times out on two bodies. A gate that fails six
 * times in ten is not a gate, and tuning the battle until the obsolete bot
 * passes again would be balancing the game against a strawman.
 *
 * `kit-v4` is the replacement rather than a new thing to write, because it is
 * already the doctrine `tools/kit_bot.py` plays and already what
 * `tests/golden/kit.json` records: the browser's "kit balance gate" has been
 * running v4 since the batch merged, and only the SIM was still registering the
 * old port. It passes 999/1,000 under the ruling, and 3/3 standing at seed 1.
 * See EXPERIMENTS.md, "The smartMilitia flip".
 */
export const POLICIES = [
  kitBatchPolicy, rushPolicy, smartRushPolicy,
  warbellKitPolicy, warbellRushPolicy,
];

/**
 * EXPERIMENT BATCH 1's ability-free instruments, kept OUT of `POLICIES`.
 *
 * `POLICIES` is what the parity oracle holds to a browser fixture and what the
 * matrix's portfolio rule reads. These two are written for the batch's rules and
 * have no browser fixture at main's, so folding them in would make the parity
 * suite assert a pairing that does not exist. Ask for them by name
 * (`--policies tandem-plain,alch-hunt`), which is also how a reader of a matrix
 * report can tell which game was being measured. (`kit-v4` left this list when
 * it became the registered gate above; its fixture is main's own.)
 */
export const BATCH_POLICIES = [tandemPolicy, alchHuntPolicy];

/**
 * Superseded doctrines: still replayable, no longer claiming anything.
 *
 * `kit-v3` is kept because it is the port of PRE-BATCH main's `kit_bot.py`, and
 * `tests/golden/main/kit.json` is that bot's untouched browser recording. The
 * parity oracle replays the pair at `?rules=none` to prove today's rules modules
 * still produce the battle main played before the batch — a check that needs the
 * old policy to exist and would be lost if it were deleted. It is out of
 * `POLICIES` so that no report can present its rate as a claim about the game
 * as it is now, and `--policies kit-v3` still reaches it for a comparison.
 */
export const LEGACY_POLICIES = [kitPolicy];

/** The doctrines that make a pass/fail claim, as against the instruments. */
export const GATE_POLICIES = POLICIES.filter(policy => policy.gate !== false);

/** Which encounter each policy is played on, for grouping a matrix report. */
export const BATTLES = ['narshe-gate', 'warning-bell'];

const ALL = () => [...POLICIES, ...BATCH_POLICIES, ...LEGACY_POLICIES];

export function policyById(id) {
  const policy = ALL().find(p => p.id === id);
  if (!policy) throw new Error(`unknown policy "${id}" (have: ${ALL().map(p => p.id).join(', ')})`);
  return policy;
}

/** The policies played on one encounter, by its `?battle=` value. */
export function policiesForBattle(battle) {
  return POLICIES.filter(policy => (policy.battle || null) === (battle || null));
}
