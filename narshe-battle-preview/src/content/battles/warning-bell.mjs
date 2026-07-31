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
   * FFT Ramza rule (Jonah, 2026-07-30): the fight is lost only when Seira
   * falls. Cassien and Brecht may be left on the floor.
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
};
