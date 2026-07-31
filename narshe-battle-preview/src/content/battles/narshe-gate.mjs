/**
 * Battle 1 — the assault on the Narshe town gate.
 *
 * This is the default encounter: it is what the page boots into with no
 * `?battle=` parameter, and its numbers are balance-locked (see DESIGN.md).
 * The descriptor records only what the boot path has to LOOK UP; the scene
 * construction, roster, and AI still live in the page.
 */
export const narsheGateBattle = {
  schemaVersion: 1,
  id: 'narshe-gate',
  /** No query value: this is the fallback every unknown `?battle=` lands on. */
  query: null,
  /** Entry-card word. Doubles as the art-preload gate's label. */
  title: 'NARSHE',
  /** The narrow terraced ravine. */
  grid: { width: 12, depth: 18 },
  /** Boot opens on the overlook, not the battlefield. */
  scene: 'cliffs',
  /** Null means the page's full sprite roster, militia included. */
  artNames: null,
  /** Extra music candidates tried ahead of the shared default. */
  music: [],
  /** The score starts with the scene rather than being held for an entrance. */
  holdMusic: false,
  /** Terraces give the AI zones to hold; the gallery is one flat floor. */
  zonedAi: true,
  /**
   * Battle 1 doctrine: all three imperials survive the story, so losing any
   * one of them is defeat.
   */
  outcome: { requiredPlayers: 3, essential: null, victory: 'part-one' },
  /** No reactive mechanics: every hit here resolves inside the turn structure. */
  reactions: [],
};
