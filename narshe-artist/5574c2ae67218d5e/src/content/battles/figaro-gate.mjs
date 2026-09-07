/**
 * Battle 3 — the defense of the Figaro Castle entryway courtyard (structure).
 *
 * The first two encounters are advances: the party crosses ground toward
 * something. This one is the inverse, and that is the whole point of adding it —
 * the party starts on the objective, holds the gate at the top of the ramp, and
 * the attackers cross the open desert past the wrecked automaton line, then
 * come up the walled ramp throat or the two wall ladders. Nothing here is new
 * mechanics: it is existing characters on a new map with the terrain flipped in
 * the defenders' favour.
 *
 * The courtyard's set dressing (towers, portcullis, banners, torches, the warm
 * dusk grade) is `src/render/figaro-scenery.mjs` and the `figaro` mood in
 * `src/render/scene-mood.mjs`. Neither may touch anything declared here.
 *
 * NOT in the campaign (`src/content/campaign.mjs` is unchanged): this enters
 * only at `?battle=figaro`, so the two shipped encounters are byte-identical at
 * their defaults.
 */
export const figaroGateBattle = {
  schemaVersion: 1,
  id: 'figaro-gate',
  query: 'figaro',
  /** Entry-card word. Doubles as the art-preload gate's label. */
  title: 'FIGARO CASTLE',
  /** Keep at z = 0, open desert to z = 22; see `maps/figaro-courtyard.mjs`. */
  grid: { width: 17, depth: 23 },
  /**
   * Its own grading rather than the town's: this is a warm desert dusk, not
   * Narshe's overcast snow. `scene-mood.mjs` owns the rig; the battle world it
   * lights is the same one both other encounters use.
   */
  scene: 'figaro',
  /** Null means the page's full sprite roster — the militia are fielded here. */
  artNames: null,
  /** "JPRG Castle Gate" (Suno, under review) — battle1 remains the fallback. */
  music: ['audio/castle-gate.mp3'],
  /** Nothing is held for: there is no entrance cinematic to land under. */
  holdMusic: false,
  /**
   * The attackers are storming a position, not holding one. Zoning would pin
   * them to the band they spawned in, which for this encounter means an assault
   * that never assaults.
   */
  zonedAi: false,
  /**
   * The warning bell's defaults, copied deliberately and in full. A third
   * encounter that quietly disagreed about what the game's RULES are would be
   * the worst possible place to discover a flag: every flag is stated, so the
   * answer is readable here rather than inferred from an absence.
   *
   * The two rulings (`smartMilitia`, `lastStanding`) and the three adopted
   * elements (`defendCostsTp`, `dangerTiles`, `bodiesBlock`) ship on; the
   * experiment flags stay off pending Jonah's per-element verdict, exactly as
   * they do in `warning-bell.mjs`. Battle 1's four genre rules (rearAttack,
   * archerMinRange, diamondRange, arrowLos) are NOT adopted here for the same
   * reason the bell does not adopt them: they were measured against battle 1's
   * deployment and this one has never been measured at all.
   */
  rules: {
    rearAttack: false,
    archerMinRange: false,
    defendCostsTp: true,
    dangerTiles: true,
    diamondRange: false,
    arrowLos: false,
    // THE ONE FLAG THIS BATTLE DOES NOT COPY FROM THE BELL, and it is not a
    // balance opinion — it is what makes the encounter exist. `enemy-ai.mjs`
    // plays the militia as DEFENDERS: they hold, steady the bow, and never
    // close on anything further away than `ENGAGE_RANGE` (6). Deployed at the
    // breach, ten tiles from the terrace, they would steady up on turn 1 and
    // then stand in the gateway for the rest of the battle, and the player
    // would have to abandon the position and walk down to them — which is the
    // exact opposite of the encounter. `aggressiveDefense` is element 5: a
    // prepared defender with nothing in its arc closes the distance instead of
    // holding ground that is doing no work. That is precisely the behaviour an
    // ATTACKING line needs, so this battle turns it on.
    //
    // It moves no shipped battle: both other descriptors still declare it off,
    // no fixture is recorded against this one, and `?rules=none` plays it off
    // here too. Jonah's verdict on the flag for battles 1 and 2 is untouched
    // and still pending. If he rules it out entirely, this encounter needs the
    // raiders redeployed inside engage range instead, not a silent stalemate.
    aggressiveDefense: true,
    smartMilitia: true,
    stickyFocus: false,
    lethalPoison: false,
    massedVolley: false,
    lastStanding: true,
    bodiesBlock: true,
  },
  /**
   * A defense: the battle is won when the last attacker falls (that check lives
   * in `battleOutcome` and needs nothing declared), and lost when nobody is left
   * standing. `essential` is deliberately null — no protect-this-one objective
   * yet, and `rules.lastStanding` would override one anyway. `victory: 'hold'`
   * selects the plain terminal overlay in `battleVictory()`: this encounter has
   * no closing cinematic and must not borrow battle 1's mine finale.
   */
  outcome: { requiredPlayers: 1, essential: null, victory: 'hold' },
  /** No reactive mechanics: the bonded pair's bond belongs to the bell. */
  reactions: [],
  /**
   * The imperial trio at the gate, five Narshe militia storming it across the
   * sand. Existing character records only, so every number here is one that
   * already shipped; the deployment is the only thing this battle states.
   *
   * WHERE THEY STAND IS THE ENCOUNTER. The trio holds the top of the ramp: the
   * two melee-capable imperials at the throat's mouth either side of the
   * runner, and Brecht behind them on the carpet under the gate arch, where his
   * bow covers the whole throat and nothing walls him in. That last part is a
   * real constraint and not a flourish — movement is four-neighbour, so a line
   * abreast on the high landing can pin its own archer against his own party.
   *
   * The attackers enter from the deep desert: two bows and an alchemist on the
   * axis, who must thread the wrecked automaton line for cover on the way in,
   * and one bow toward each flank, where the wall ladders offer a way onto the
   * terraces — the flanks exist so that holding the throat is not the whole
   * battle. The `tune` maps are the same knobs battle 1's militia read, so a
   * sweep can re-field this line without a rebuild.
   */
  roster: [
    { character: 'cassien', x: 7, z: 4 },
    { character: 'seira', x: 9, z: 4 },
    { character: 'brecht', x: 8, z: 3 },
    { character: 'miner-archer', name: 'Raider I', x: 7, z: 20, tune: { hp: 'ahp', atk: 'aatk' } },
    { character: 'miner-archer', name: 'Raider II', x: 9, z: 20, tune: { hp: 'ahp', atk: 'aatk' } },
    { character: 'alchemist', name: 'Raider Alchemist', x: 8, z: 21,
      tune: { hp: 'xhp', atk: 'xatk', move: 'xmv' } },
    { character: 'miner-archer', name: 'Ladder Raider I', x: 2, z: 18, tune: { hp: 'ahp', atk: 'aatk' } },
    { character: 'miner-archer', name: 'Ladder Raider II', x: 14, z: 18, tune: { hp: 'ahp', atk: 'aatk' } },
  ],
};
