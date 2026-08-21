/**
 * The warning-bell prototype's defenders: a Type-8 quarry champion and the
 * cragbeast bonded to her.
 *
 * Neither is militia — a felled partner leaves the field (Jonah, 2026-07-31),
 * which is what makes the survivor's grief scaling land on an empty tile. Their
 * hit points and attack are provisional and stay live-tunable from the URL, so
 * the roster entry that fields them names the query key for each; the numbers
 * here are the defaults those knobs start from.
 */
export const ragna = {
  schemaVersion: 1,
  id: 'ragna',
  name: 'Ragna',
  role: 'Type 8 · Quarry Champion',
  team: 'enemy',
  cls: 'champion',
  kind: 'knight',
  pal: 'defender',
  /**
   * Her dialogue face is the accepted review candidate, consumed compact and in
   * place, until the art lane lands a canonical `portraits/ragna.png` — which
   * would then win by key.
   */
  art: {
    set: 'defender',
    portrait: 'ragna',
    portraitPath: 'art/runtime/review/bonded_defender_cragbeast/portraits/defender_type8_aggressive_candidate.png',
  },
  stats: { hp: 72, atk: 14, move: 4, speed: 6, range: 1 },
  kit: [],
  downable: false,
  forms: {},
};

export const skarn = {
  schemaVersion: 1,
  id: 'skarn',
  name: 'Skarn',
  role: 'Bonded Cragbeast',
  team: 'enemy',
  cls: 'beast',
  kind: 'knight',
  pal: 'cragbeast',
  art: { set: 'cragbeast', portrait: null },
  stats: { hp: 84, atk: 12, move: 3, speed: 4, range: 1 },
  kit: [],
  downable: false,
  /** His broad silhouette is clamped so he still reads as standing on ONE tile. */
  artMaxW: 1.22,
  forms: {},
};
