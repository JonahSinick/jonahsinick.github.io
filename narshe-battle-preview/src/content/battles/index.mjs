/**
 * The battle registry and its boot-time resolver.
 *
 * Adding a third encounter used to mean repeating the same `if (BATTLE_X)`
 * skeleton at a dozen unrelated points in the page. A descriptor turns those
 * forks into lookups against one record, so a new battle is a new data module
 * plus whatever is genuinely new about it.
 */
import { narsheGateBattle } from './narshe-gate.mjs';
import { warningBellBattle } from './warning-bell.mjs';

export const BATTLES = [narsheGateBattle, warningBellBattle];

/** The battle a missing or unrecognised `?battle=` value falls back to. */
export const DEFAULT_BATTLE = narsheGateBattle;

/**
 * Resolve a `?battle=` query value to its descriptor. An unknown value returns
 * the default rather than throwing: a mistyped URL should still give the
 * player a game.
 */
export function resolveBattle(query) {
  if (!query) return DEFAULT_BATTLE;
  return BATTLES.find(b => b.query === query) || DEFAULT_BATTLE;
}

/**
 * Translate a descriptor's outcome rule into `battleOutcome` options against a
 * live roster.
 *
 * Essential units are named rather than pre-identified, because ids are
 * assigned as the roster is built. A name that does not resolve is reported
 * through `onMissing` and dropped instead of throwing — the previous by-name
 * lookup crashed the end-check outright on any roster that renamed its
 * protagonist, which turned a content typo into an unplayable battle.
 */
export function outcomeOptionsFor(battle, units, onMissing = null) {
  const rule = battle.outcome || {};
  const options = {};
  if (rule.requiredPlayers != null) options.requiredPlayers = rule.requiredPlayers;
  if (!rule.essential || !rule.essential.length) return options;
  const ids = [];
  for (const name of rule.essential) {
    const unit = units.find(u => u.name === name);
    if (unit) ids.push(unit.id);
    else if (onMissing) onMissing(name);
  }
  // An essential list that resolved to nothing would silently downgrade the
  // battle to its player-count rule, so keep it null and let the count decide
  // explicitly rather than pretending an empty list means "nobody matters".
  if (ids.length) options.essentialIds = ids;
  return options;
}
