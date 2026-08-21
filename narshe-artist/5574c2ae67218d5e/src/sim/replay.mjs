/**
 * Run one policy through one battle: the single unit of work everything else
 * here is built out of — the parity oracle, the matrix runner, and anything
 * that later wants to search over policies rather than hand-write them.
 */

import { createSimBot, playSim } from './bot.mjs';
import { createSimBattle } from './run-battle.mjs';

/**
 * @param {object} policy from `sim/policies/index.mjs`
 * @param {object} [options]
 * @param {number} [options.seed] the combat PRNG seed (`BATTLE_SEED`)
 * @param {number} [options.maxRounds] override the policy's own round cap
 * @param {object} [options.knobs] URL-shaped tuning parameters for this run
 */
export function replay(policy, { seed = 1, maxRounds = policy.maxRounds, knobs = {} } = {}) {
  const sim = createSimBattle({ battle: policy.battle, seed, knobs });
  const bot = createSimBot(sim);
  // What a policy reads off the page before it starts playing — `smart_rush`
  // takes the terrace heights and the active rule set this way.
  if (policy.setup) policy.setup(bot, sim);
  const state = playSim(bot, policy.turn, { maxRounds, stop: policy.stop || null });
  return { sim, bot, state, roster: sim.api.roster(), log: sim.log() };
}
