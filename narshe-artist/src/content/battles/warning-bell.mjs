/**
 * The warning-bell gallery — the second encounter (prototype).
 *
 * A sentry rings the mine's warning bell and a Type-8 quarry champion walks
 * out of the haul tunnel with her bonded cragbeast. The encounter's rules are
 * recorded in DESIGN.md; this descriptor holds only the boot-time lookups that
 * used to be `if (WARBELL)` forks scattered through the page.
 */
export const warningBellBattle = {
  schemaVersion: 1,
  id: 'warning-bell',
  query: 'warningbell',
  title: 'NARSHE MINES',
  /** A broad flat working floor rather than a climbing route. */
  grid: { width: 13, depth: 11 },
  /** The gallery is dressed by the terrain kit, so boot goes straight in. */
  scene: 'town',
  /**
   * No militia are fielded, but the sentry who rings the bell is a cutscene
   * actor drawn from the miner set — he needs its walk cycles to cross the
   * gallery on his own feet, so the miner loads with the imperial trio.
   */
  artNames: ['cassien', 'brecht', 'seira', 'miner'],
  music: ['audio/warningbell.mp3', 'audio/warningbell.ogg'],
  /** Held until the bonded pair walks onto the field, so the bell lands alone. */
  holdMusic: true,
  /** One level: the AI may roam the whole floor. */
  zonedAi: false,
  /**
   * EXPERIMENT BATCH 1 (`exp/combat-batch-1`, merged 2026-08-03): the same
   * defaults Battle 1 carries, so the two encounters are always played under one
   * rule set rather than one each. Every experiment flag is OFF pending Jonah's
   * per-element verdict; `lastStanding` and `smartMilitia` are his rulings and
   * ship on.
   *
   * `smartMilitia` is INERT here today and is declared anyway, for that reason:
   * this encounter fields Ragna and his cragbeast, not militia, so the improved
   * archer, alchemist and guard-budgeting paths have nothing to act on — the
   * seed-1 event stream is byte-identical with it on and off. Declaring it OFF
   * to record that fact would make the two encounters disagree about what the
   * game's rules ARE, and the next unit added here would inherit the wrong
   * answer silently.
   *
   * What each flag would do HERE, when one is switched on for a playtest:
   * `archerMinRange` touches only Brecht (bows only, Jonah 2026-08-02 — while
   * the minimum applied to every ranged unit it also gated Seira's bolt, the
   * point-blank refusal he hit in this very battle), and `rearAttack` cuts both
   * ways, since a reprisal does not turn the avenger to face what struck it.
   */
  rules: {
    rearAttack: false,
    archerMinRange: false,
    // RULED (Jonah, 2026-08-04, campaign playtest via the lead): Defend is
    // PRICED. He played main, found the guard free, and reported it as a
    // regression against the batch build — and it closes the design hole he
    // named himself, that a free Defend dominates Wait and leaves one of the
    // two buttons dead.
    defendCostsTp: true,
    // RULED (Jonah, 2026-08-05, campaign playtest via the lead): the danger
    // shading is ADOPTED, in both encounters — see narshe-gate.mjs for the
    // provenance. Presentation only, so nothing recorded moves.
    dangerTiles: true,
    diamondRange: false,
    arrowLos: false,
    aggressiveDefense: false,
    // Jonah's ruling, not an experiment. Inert on this encounter — see above.
    smartMilitia: true,
    stickyFocus: false,
    lethalPoison: false,
    massedVolley: false,
    // Jonah's ruling, not an experiment: defeat only when nobody stands.
    lastStanding: true,
    // Jonah's ruling, not an experiment: the fallen hold their tile. Provenance
    // in narshe-gate.mjs. It is about what a body IS, not about this encounter's
    // balance, so it applies wherever bodies stay on the field — both of them.
    bodiesBlock: true,
  },
  /**
   * The PRE-RULING rule (Jonah's FFT-Ramza rule of 2026-07-30): lost only when
   * Seira falls. RETIRED 2026-08-02 by `rules.lastStanding`, which he extended
   * to this encounter too — overriding the lead-session assumption that the
   * bell would keep its Seira-only condition. A line that loses her and wins on
   * the survivors is legal now. Kept here because `?rules=none` still plays it.
   */
  outcome: { requiredPlayers: 1, essential: ['Seira'], victory: 'prototype-card' },
  /**
   * The bond, declared rather than branched on inside the event seam. Only
   * true attacks with a known attacker provoke a reprisal, which is what makes
   * a reprisal unable to chain into another one; a fall enrages whichever half
   * of the pair is left standing.
   */
  reactions: [
    {
      id: 'bond-retaliation',
      on: 'damageApplied',
      kinds: ['attack'],
      requiresSource: true,
      classes: ['champion', 'beast'],
    },
    {
      id: 'berserk-survivor',
      on: ['unitDowned', 'unitDefeated'],
      classes: ['champion', 'beast'],
    },
  ],
  /**
   * The trio carries its Battle 1 kit — the same character records, so the same
   * numbers — and Seira opens on the 3 TP her scripted first move spends. She is
   * the only unit here that may change what she is mid-fight, so this is where
   * her Type-2 form is fielded: it declares which costume the entry card waits
   * for. The bonded pair holds the shaft mouth, with their provisional hit
   * points and attack still owned by the URL knobs the tuning panel writes.
   */
  roster: [
    { character: 'cassien', x: 5, z: 9 },
    { character: 'brecht', x: 7, z: 9 },
    { character: 'seira', x: 6, z: 8, tp: 3, forms: [2] },
    { character: 'ragna', x: 6, z: 2, tune: { hp: 'chp', atk: 'catk' } },
    { character: 'skarn', x: 7, z: 2, tune: { hp: 'bhp', atk: 'batk' } },
  ],
};
