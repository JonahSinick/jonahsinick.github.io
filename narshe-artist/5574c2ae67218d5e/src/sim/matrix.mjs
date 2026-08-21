/**
 * The matrix: policy × config × seeds, reported as RATES rather than anecdotes.
 *
 * The reason this exists is epistemological, not ergonomic. At 40-75 seconds a
 * playthrough the project could only afford single runs, so the ledger is full
 * of "4/4" and of disputes that come down to *"outcomes flip on the seed rather
 * than on the strategy"*. At milliseconds a playthrough that dissolves into a
 * distribution — but only if the tool refuses to let a single run be reported
 * as a verdict, which is why the portfolio rule below is code and not a habit.
 *
 * THE PORTFOLIO RULE. A doctrine claim about an encounter is a claim about
 * SEVERAL policies at once: battle 1's is "rush loses AND kit wins", the
 * warning bell's is "indiscriminate play loses Seira AND powered play clears it
 * with her alive". Half of that pair is not weak evidence for the doctrine, it
 * is evidence for a different proposition. So `summarize` will not attach a
 * doctrine verdict to an encounter unless every GATE policy for that encounter
 * ran, over the same seeds, at the same config — and when it cannot, it says
 * which policy is missing rather than falling silent.
 *
 * AND IT DOES NOT INVENT A THRESHOLD. Where the gate policies disagree across
 * seeds, the verdict is `split` and carries the rates; it never converts a rate
 * into a pass/fail, because where the line sits is Jonah's ruling, not a
 * default in a reporting tool.
 */

import { GATE_POLICIES, POLICIES, policiesForBattle, policyById } from './policies/index.mjs';
import { replay } from './replay.mjs';

/** The encounter a policy is played on, as the battle descriptor's id. */
export const battleOf = policy => (policy.battle === 'warningbell' ? 'warning-bell' : 'narshe-gate');

/**
 * Wilson score interval — the honest way to put an interval on a proportion
 * when it sits near 0 or 1, which every one of these rates does. A normal
 * approximation would report 200/200 as [1.0, 1.0] and claim certainty the
 * sample cannot support.
 */
export function wilson(successes, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [
    Math.max(0, (centre - spread) / denominator),
    Math.min(1, (centre + spread) / denominator),
  ];
}

/** Run one policy over a seed range at one config. */
export function runCell(policy, seeds, knobs = {}) {
  const runs = [];
  const errors = [];
  /** the outcome rule these runs were measured under, for the report's stamp */
  let outcomeRule = null;
  for (const seed of seeds) {
    try {
      const { roster, state, sim } = replay(policy, { seed, knobs });
      if (!outcomeRule) outcomeRule = sim.outcomeRule();
      runs.push({
        seed,
        verdict: policy.verdict(roster, state, sim.outcome()),
        // The ENGINE's own ending, independent of what the bot concluded. A
        // policy that stops early (rush abandons the moment an imperial falls)
        // leaves this undecided, and saying so is more useful than pretending
        // the two always agree.
        outcome: sim.outcome(),
        round: state.round,
      });
    } catch (error) {
      errors.push({ seed, message: error.message });
    }
  }
  const n = runs.length;
  const passes = runs.filter(r => r.verdict.pass === true).length;
  const wins = runs.filter(r => r.outcome === 'victory').length;
  const losses = runs.filter(r => r.outcome === 'defeat').length;
  return {
    policy: policy.id,
    battle: battleOf(policy),
    outcomeRule,
    gate: policy.gate !== false,
    n,
    passes,
    // `pass` is a doctrine's own claim ("rush COLLAPSED"), which for a
    // must-lose policy is the opposite of a win. Both are reported because
    // conflating them is how a must-lose gate gets read as a win rate.
    passRate: n ? passes / n : null,
    passInterval: wilson(passes, n),
    wins,
    losses,
    undecided: n - wins - losses,
    winRate: n ? wins / n : null,
    winInterval: wilson(wins, n),
    meanRound: n ? runs.reduce((sum, r) => sum + r.round, 0) / n : null,
    results: runs.map(r => r.verdict.result).filter(Boolean),
    errors,
    runs,
  };
}

/**
 * The outcome rule each encounter in a finished matrix was measured under, as
 * `[battle, rule]` pairs. A report stamps this: the outcome rule decides when a
 * battle ENDS, so a matrix run under the wrong one is not slightly off, it
 * answers a different question at full confidence.
 */
export function outcomeRules(matrix) {
  const seen = new Map();
  for (const cell of matrix.cells) {
    if (cell.outcomeRule && !seen.has(cell.battle)) seen.set(cell.battle, cell.outcomeRule);
  }
  return [...seen];
}

/**
 * Run every requested policy over every config, and say — per encounter, per
 * config — whether the portfolio needed for a doctrine verdict actually ran.
 */
export function runMatrix({ policies = POLICIES, configs = [{ name: 'default', knobs: {} }], seeds }) {
  const startedAt = Date.now();
  const cells = [];
  for (const config of configs) {
    for (const policy of policies) {
      cells.push({ config: config.name, ...runCell(policy, seeds, config.knobs) });
    }
  }
  const elapsedMs = Date.now() - startedAt;
  const battles = cells.reduce((sum, cell) => sum + cell.n, 0);
  return {
    seeds: [...seeds],
    configs: configs.map(c => c.name),
    cells,
    verdicts: summarize(cells, policies, configs, seeds),
    performance: {
      battles,
      elapsedMs,
      msPerBattle: battles ? elapsedMs / battles : null,
      battlesPerSecond: elapsedMs ? Math.round((battles / elapsedMs) * 1000) : null,
    },
  };
}

/**
 * The portfolio rule, as code. One entry per (encounter, config) that was
 * touched at all, each either carrying a verdict or naming what is missing.
 */
export function summarize(cells, policies, configs, seeds) {
  const ran = new Set(policies.map(p => p.id));
  const encounters = [...new Set(cells.map(cell => cell.battle))];
  const out = [];
  for (const config of configs) {
    for (const encounter of encounters) {
      const required = GATE_POLICIES.filter(p => battleOf(p) === encounter);
      const missing = required.filter(p => !ran.has(p.id)).map(p => p.id);
      const mine = cells.filter(c => c.battle === encounter && c.config === config.name);
      const gateCells = mine.filter(c => c.gate);
      const base = {
        battle: encounter,
        config: config.name,
        seeds: seeds.length,
        policies: mine.map(c => c.policy),
      };
      if (missing.length) {
        out.push({
          ...base,
          verdict: null,
          // Stated as a refusal rather than an omission: a report that just
          // leaves the line out reads as "no verdict was reached", which is a
          // different and much weaker claim than "this run is not entitled to
          // one".
          refused: `no doctrine verdict for ${encounter}: the portfolio is incomplete ` +
            `(missing ${missing.join(', ')}). A doctrine claim about this encounter is a ` +
            `claim about ${required.map(p => p.id).join(' AND ')} together.`,
        });
        continue;
      }
      const unanimous = gateCells.every(c => c.n > 0 && c.passes === c.n);
      const none = gateCells.every(c => c.passes === 0);
      out.push({
        ...base,
        verdict: unanimous ? 'holds' : none ? 'fails' : 'split',
        // No threshold is applied. Where the gate policies disagree across
        // seeds, the rates are the finding and where the line sits is a ruling.
        rates: gateCells.map(c => ({
          policy: c.policy, passes: c.passes, n: c.n,
          rate: c.passRate, interval: c.passInterval,
        })),
        refused: null,
      });
    }
  }
  return out;
}

/** `--config name:key=value,key=value` -> `{ name, knobs }`. */
export function parseConfig(spec) {
  const at = spec.indexOf(':');
  if (at < 0) return { name: spec, knobs: {} };
  const name = spec.slice(0, at);
  const knobs = {};
  let last = null;
  for (const pair of spec.slice(at + 1).split(',').filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq < 0) {
      // A fragment with no `=` continues the previous knob's value. One knob
      // takes a comma-separated list of its own — `rules=stickyFocus,-lethalPoison`,
      // the ?rules= syntax — and splitting on every comma turned the second
      // half of it into a parse error, which made exactly the interesting
      // configurations (two flags at once) unaskable.
      if (last === null) throw new Error(`config "${name}": "${pair}" is not key=value`);
      knobs[last] += `,${pair.trim()}`;
      continue;
    }
    last = pair.slice(0, eq).trim();
    knobs[last] = pair.slice(eq + 1).trim();
  }
  return { name, knobs };
}

/** `--policies kit,rush` -> the policy objects, or all of them. */
export function selectPolicies(list) {
  if (!list) return POLICIES;
  return list.split(',').map(id => policyById(id.trim()));
}

export function seedRange(from, to) {
  const out = [];
  for (let seed = from; seed <= to; seed++) out.push(seed);
  return out;
}

export { policiesForBattle };
