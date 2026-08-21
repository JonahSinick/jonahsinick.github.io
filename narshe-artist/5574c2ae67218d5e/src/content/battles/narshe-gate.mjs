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
   * EXPERIMENT BATCH 1 (`exp/combat-batch-1`, merged 2026-08-03): the rules the
   * batch built ship OFF, awaiting Jonah's per-element verdict, so a playtest of
   * one is a single URL token (`?rules=rearAttack`) and `?rules=all` is all of
   * them.
   *
   * TWO ARE NOT EXPERIMENTS AND SHIP ON, both rulings rather than candidates:
   *
   *   `lastStanding`  Jonah 2026-08-02 (DESIGN.md) — defeat only when nobody
   *                   stands, the fallen downed rather than dead.
   *   `smartMilitia`  Jonah 2026-08-03, from playing the integrated campaign:
   *                   he hit the OLD reflex-guarding militia and called it a
   *                   regression. It is the AI-competence doctrine (DESIGN.md)
   *                   applied — the alchemist that flees and braces forever
   *                   without throwing a flask is not a skilled player, and
   *                   neither is an archer bracing at an empty horizon.
   *
   * So `?rules=none` plays the PRE-RULING game: no all-units-defeated, and the
   * militia as they were before either ruling. That is what the flags-off golden
   * gate and the sim's parity oracle check against main's own recordings, and it
   * is the only thing `none` is for — it is not a configuration anyone plays.
   * Stats below are unchanged: neither ruling tuned a number.
   */
  rules: {
    // RULED (Jonah, 2026-08-06): the four genre rules — rear-attack x1.5,
    // bows-only hard minimum range, diamond (Manhattan) reach, and arrows
    // blocked by bodies and buildings — are ADOPTED for battle 1. Measured
    // together at 1,000 seeds before landing: kit-v4 99.8%, intact rushes
    // 1.1%, mean round 8.3. The warning bell keeps its own rules: the same
    // combo collapses that encounter (26-44% kit) and it needs its own
    // rebalance before adoption there. Poison levers stay OFF for battle 1
    // (Jonah: too hard for a first battle; lead concurs — a Purify knowledge
    // check belongs later than the tutorial fight).
    rearAttack: true,
    archerMinRange: true,
    // RULED (Jonah, 2026-08-04, campaign playtest via the lead): Defend is
    // PRICED. He played main, found the guard free, and reported it as a
    // regression against the batch build — and it closes the design hole he
    // named himself, that a free Defend dominates Wait and leaves one of the
    // two buttons dead.
    defendCostsTp: true,
    // RULED (Jonah, 2026-08-05, campaign playtest via the lead): the danger
    // shading is ADOPTED — he asked what had happened to the translucent red
    // arcs, which is a player missing an element, not evaluating one. It is
    // presentation only (a geometric projection of enemy reach onto the Move
    // highlight, plus the hover arcs that answer "by whom"); no bot and no
    // rule reads it, so the recordings do not move.
    dangerTiles: true,
    diamondRange: true,
    arrowLos: true,
    aggressiveDefense: false,
    // Jonah's ruling, not an experiment: the militia play like a skilled player.
    smartMilitia: true,
    stickyFocus: false,
    lethalPoison: false,
    massedVolley: false,
    // Jonah's ruling, not an experiment: defeat only when nobody stands.
    lastStanding: true,
    // Jonah's ruling, not an experiment (2026-08-16, playing battle 1): the
    // fallen hold their tile. He watched Seira stand inside a downed militiaman
    // — the bodies stay on the field by design, so movement has to see them.
    bodiesBlock: true,
  },
  /**
   * The PRE-RULING rule, and it is still what `?rules=none` plays: any imperial
   * falling ends the battle. `rules.lastStanding` (on, above) overrides it with
   * Jonah's 2026-08-02 ruling — lost only when nobody stands, and the fallen
   * are downed rather than dead, so the story still has all three afterwards.
   */
  outcome: { requiredPlayers: 3, essential: null, victory: 'part-one' },
  /** No reactive mechanics: every hit here resolves inside the turn structure. */
  reactions: [],
  /**
   * Three imperials against six militia: the FF6-opening asymmetry, stated as a
   * deployment. Each entry references a record in `content/characters/` and adds
   * only what is true of THIS battle — the tile, and the name a repeated stock
   * defender is fielded under. The stats and kits live with the characters.
   *
   * Each militia pair stands close enough that one Mournful Cry can catch both:
   * the burst has to be worth more than Seira's free attack or nobody would ever
   * pay 3 TP for it. Deployment depth is the balance — two on terrace 1, a pair
   * on terrace 2, a pair in the yard.
   */
  roster: [
    { character: 'cassien', x: 5, z: 17 },
    { character: 'brecht', x: 4, z: 17 },
    { character: 'seira', x: 6, z: 17 },
    // The `tune` maps let the node sim sweep this deployment without a rebuild:
    // every archer reads one pair of knobs and every alchemist another, so
    // `--config name:ahp=16,aatk=5` re-fields the whole line. The fallbacks are
    // the character records, so an unswept run is the shipped battle. Battle 2
    // has had these since its tuning panel; battle 1 needed them the moment a
    // design search became affordable.
    { character: 'miner-archer', name: 'Miner-Archer I', x: 4, z: 12, tune: { hp: 'ahp', atk: 'aatk' } },
    { character: 'miner-archer', name: 'Miner-Archer II', x: 6, z: 11, tune: { hp: 'ahp', atk: 'aatk' } },
    { character: 'miner-archer', name: 'Miner-Archer III', x: 5, z: 8, tune: { hp: 'ahp', atk: 'aatk' } },
    { character: 'alchemist', name: 'Alchemist I', x: 7, z: 7, tune: { hp: 'xhp', atk: 'xatk', move: 'xmv' } },
    { character: 'miner-archer', name: 'Miner-Archer IV', x: 6, z: 4, tune: { hp: 'ahp', atk: 'aatk' },
      unlessRule: 'swapArcher' },
    { character: 'alchemist', name: 'Alchemist II', x: 4, z: 2, tune: { hp: 'xhp', atk: 'xatk', move: 'xmv' } },
    // Redundancy, not protection (rules.thirdAlchemist, off by default). Jonah
    // beat the poison check ability-free by killing both throwers, and no
    // deployment can stop that: an alchemist has to close to 3 to act, which is
    // inside Brecht's 4 and Seira's 3. So the answer under trial is another
    // carrier, standing deep on the far side of the yard from Alchemist II, so
    // that hunting the check costs the whole battle rather than three rounds.
    { character: 'alchemist', name: 'Alchemist III', x: 8, z: 3, whenRule: 'thirdAlchemist',
      tune: { hp: 'xhp', atk: 'xatk', move: 'xmv' } },
    // A denser line, for the search (rules.moreMilitia). Two more bows, one on
    // each flank of the middle terrace, where they widen the front the party
    // has to cross rather than deepening a column it can meet one at a time.
    { character: 'miner-archer', name: 'Miner-Archer V', x: 2, z: 10, whenRule: 'moreMilitia',
      tune: { hp: 'ahp', atk: 'aatk' } },
    { character: 'miner-archer', name: 'Miner-Archer VI', x: 9, z: 9, whenRule: 'moreMilitia',
      tune: { hp: 'ahp', atk: 'aatk' } },
  ],
};
