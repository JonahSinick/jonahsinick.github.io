/**
 * The three imperial soldiers, who are the party in every encounter so far.
 *
 * Their numbers are balance-locked for Battle 1 (DESIGN.md) and the warning-bell
 * prototype fields the same people with the same kit, which is why these blocks
 * are written once here rather than once per battle: a stat that appeared in two
 * rosters could be retuned in one of them by accident.
 */
import { spriteSetPoses } from './poses.mjs';

export const cassien = {
  schemaVersion: 1,
  id: 'cassien',
  name: 'Cassien',
  role: 'Type 1 · Knight',
  team: 'player',
  cls: 'knight',
  kind: 'knight',
  pal: 'cassien',
  art: { set: 'cassien', portrait: 'cassien' },
  stats: { hp: 52, atk: 15, move: 4, speed: 7, range: 1 },
  kit: ['anger', 'purify'],
  /**
   * Left as main has it. An imperial who falls is DOWNED, not dead, under
   * Jonah's 2026-08-02 ruling — but that arrives as `rules.lastStanding` and
   * is applied to the DEPLOYMENT (see `rosterUnitDefs`), not written into the
   * character, so that `?rules=none` still reproduces main's battle exactly.
   */
  downable: false,
  forms: {},
};

export const brecht = {
  schemaVersion: 1,
  id: 'brecht',
  name: 'Brecht',
  role: 'Type 6 · Archer',
  team: 'player',
  cls: 'archer',
  kind: 'archer',
  pal: 'brecht',
  art: { set: 'brecht', portrait: 'brecht' },
  stats: { hp: 44, atk: 14, move: 4, speed: 8, range: 4 },
  kit: ['aim'],
  /** See the note on Cassien: downability is a rule here, not a trait. */
  downable: false,
  forms: {},
};

export const seira = {
  schemaVersion: 1,
  id: 'seira',
  name: 'Seira',
  role: 'Type 4 · Mage',
  team: 'player',
  cls: 'mage',
  kind: 'mage',
  pal: 'seira',
  art: { set: 'seira', portrait: 'seira' },
  stats: { hp: 40, atk: 15, move: 4, speed: 9, range: 3 },
  kit: ['cry'],
  /** See the note on Cassien: downability is a rule here, not a trait. */
  downable: false,
  /**
   * Stress forms. A form changes what the character IS — role label, kit, and
   * the plates and dialogue face she wears — while her stats and position stay
   * hers. Only forms that have been designed AND drawn belong here; the
   * transition graph in DESIGN.md is not content until its art exists.
   *
   * Type 2 is the one that does: Jonah's warning-bell spec stresses her 4 → 2
   * mid-encounter, and the settled cool-hood set (2026-07-31) is a review
   * candidate consumed compact and in place, so her accepted Type-4 masters are
   * never touched or shadowed.
   */
  forms: {
    2: {
      role: 'Type 2 · Helper',
      kit: ['heal'],
      art: {
        set: 'seira_type2',
        portrait: 'seira_type2',
        // A costume change is a whole plate SET, not a frame: the unit is
        // repointed at this set and the view/gait machinery carries on
        // unchanged against it.
        sprites: {
          path: 'art/runtime/review/seira_type2_form/sprites/seira_type2_hood_cool_',
          poses: spriteSetPoses({ front: 8, back: 8, side: 2 }),
        },
        portraitPath: 'art/runtime/review/seira_type2_form/portraits/type2_hood_cool_poc.png',
      },
    },
  },
};
