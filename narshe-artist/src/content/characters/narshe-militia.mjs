/**
 * The Narshe gate militia: not individuals but a pair of stock defenders the
 * roster fields several times under numbered names.
 *
 * 20 HP on the archer is the load-bearing number (DESIGN.md): two plain
 * imperial hits, but one Righteous Anger.
 *
 * These numbers are UNCHANGED by experiment batch 1, and that is worth a line
 * because they nearly were not. Three tuning passes converged on 24 hp / 5 atk
 * before a trace showed the real cause was a bug in the alchemist AI, which
 * had them contributing nothing to the fight at all. Fixing that carried the
 * balance doctrine at main's own numbers and the buff was reverted in full.
 * See BATCH1_NOTES.md, "The alchemist never threw".
 */
export const minerArcher = {
  schemaVersion: 1,
  id: 'miner-archer',
  name: 'Miner-Archer',
  role: 'Type 6 · Miner-Archer',
  team: 'enemy',
  cls: 'archer',
  kind: 'archer',
  pal: 'miner',
  /** Their dialogue faces come from the guard portrait ladder, not a key here. */
  art: { set: 'miner', portrait: null },
  stats: { hp: 20, atk: 4, move: 3, speed: 5, range: 4 },
  kit: ['aim'],
  /** Downed-not-dead: the militia collapse and stay on the field. */
  downable: true,
  forms: {},
};

export const alchemist = {
  schemaVersion: 1,
  id: 'alchemist',
  name: 'Alchemist',
  role: 'Type 5 · Alchemist',
  team: 'enemy',
  cls: 'alchemist',
  kind: 'alchemist',
  pal: 'alch',
  art: { set: 'alchemist', portrait: null },
  // BATCH 1: unchanged at 16. Tried at 20 and reverted — it was not what
  // flipped the rush line, and every point of militia survivability is also
  // paid for by the kit line, which has to keep winning.
  stats: { hp: 16, atk: 5, move: 3, speed: 6, range: 3 },
  kit: ['flask'],
  downable: true,
  forms: {},
};
