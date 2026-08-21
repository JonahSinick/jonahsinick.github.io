/**
 * One battle, from its first mesh to its last byte.
 *
 * This is the page's old composition root, and it does what it always did:
 * construct every module in dependency order and wire them together with
 * explicit context objects. The one thing that changed is that it is a
 * FUNCTION rather than a module body, which is what lets a session build a
 * battle, tear it down, and build the next one without a page load.
 * Everything a battle owns is now a local of this function and dies with it —
 * the scene graph, the camera rig, the composer, the units, the score, the
 * loading bar and its card, the story, the AI, the HUD.
 *
 * What it does NOT own is in `context`, and belongs to the session that spans
 * battles: the WebGL renderer and its canvas (one GL context per tab, so
 * `renderer.info` stays a meaningful baseline across a teardown), this
 * battle's URL parameters, and the AbortSignal every window-level listener is
 * hung on.
 *
 * `dispose()` is the point of the exercise. It walks the resource LEDGER, not
 * the scene graph — src/render/resource-ledger.mjs says why the graph walk is
 * the wrong implementation — and the proof that it worked is that
 * `renderer.info.memory` returns to the integers it held before the build.
 * tools/lifecycle_check.py makes exactly that assertion.
 */

import * as THREE_LIB from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  CARDINAL_DIRECTIONS as DIRS,
  chebyshevDistance as cheb,
  manhattanDistance as manh,
} from './core/grid.mjs';
import { createBattleGrid } from './core/battle-grid.mjs';
import { createScheduler } from './core/scheduler.mjs';
import { createRules } from './core/rules.mjs';
import { escalatedAbilityRange, threatenedTiles, threatsAt } from './core/threat.mjs';
import { laneBlocked } from './core/line-of-sight.mjs';
import { outcomeOptionsFor, resolveBattle } from './content/battles/index.mjs';
import { createForecastPanel } from './ui/forecast-panel.mjs';
import { createSpeechBubbles } from './ui/speech-bubbles.mjs';
import { createDialogue } from './ui/dialogue.mjs';
import { createCliffsTintPanel, createEncounterTuningPanel } from './ui/tuning-panels.mjs';
import {
  gallerySolidPropTiles,
  warningBellGalleryMap,
} from './content/maps/warning-bell-gallery.mjs';
import { createNarsheGateMap } from './content/maps/narshe-gate-ravine.mjs';
import {
  createFigaroCourtyardMap,
  figaroCourtyardMap,
  figaroSolidPropTiles,
} from './content/maps/figaro-courtyard.mjs';
import { narsheMineSkin } from './content/terrain-skins/narshe-mine.mjs';
import { buildTerrainKit } from './render/terrain-kit.mjs';
import { createWarningBellOpening } from './scenes/warning-bell-opening.mjs';
import { createMineFinale } from './scenes/mine-finale.mjs';
import { createCliffsOpening } from './scenes/cliffs-opening.mjs';
import { createBattle1Scenery } from './render/battle1-scenery.mjs';
import { createFigaroDioramaBattlefield } from './render/figaro-diorama-battlefield.mjs';
import { createProceduralTextures } from './render/procedural-textures.mjs';
import { createFigaroDioramaDressing } from './render/figaro-diorama-dressing.mjs';
import { FIGARO_PAINTED_ATLAS } from '../art/environments/figaro-gate/painted-atlas-data.mjs';
import { createPaintedArt } from './render/painted-art.mjs';
import {
  PALETTE,
  SPRITE_TOP,
  SPX,
  SPY,
  createSpritePainter,
  gridSolid,
} from './render/sprite-painter.mjs';
import { createMusicPlayer } from './audio/music.mjs';
import { createEnemyAI } from './core/enemy-ai.mjs';
import { createExplorationMode } from './modes/exploration.mjs';
import { parseScript, FALLBACK_SCENES } from './story/script-parser.mjs';
import {
  battleArtDeclarations,
  characterForm,
  getCharacter,
  rosterUnitDefs,
} from './content/characters/index.mjs';
import { createAbilityRegistry } from './content/abilities/registry.mjs';
import { createBattleAbilities } from './content/abilities/battle-kit.mjs';
import { createReactionRegistry } from './core/reactions.mjs';
import { isBerserk, markedUnit } from './core/battle-state.mjs';
import { hasStatus } from './core/statuses.mjs';
import { createTurnMachine } from './flow/turn-machine.mjs';
import { createUnitActions } from './flow/unit-actions.mjs';
import { createTurnState } from './flow/turn-state.mjs';
import { createBattleEvents } from './flow/battle-events.mjs';
import { createBattleHud } from './ui/battle-hud.mjs';
import { createBattleInput } from './ui/battle-input.mjs';
import { createAiTelegraph } from './ui/ai-telegraph.mjs';
import { createFacingPicker } from './ui/facing-picker.mjs';
import { createTileChrome } from './ui/tile-chrome.mjs';
import { createThreatArcs } from './ui/threat-arcs.mjs';
import { createTerrainMesh } from './render/terrain-mesh.mjs';
import { createAtmosphere } from './render/atmosphere.mjs';
import { createCameraRig } from './render/camera-rig.mjs';
import { createSceneMood } from './render/scene-mood.mjs';
import { createBattleApi } from './debug/battle-api.mjs';
import { createLoadProgress, createSplashCard } from './boot/loading.mjs';
import { createUnitFactory } from './flow/unit-factory.mjs';
import { createResourceLedger } from './render/resource-ledger.mjs';

export const BATTLE_SCENE_CONTEXT = [
  'renderer',   // the session's one WebGLRenderer; a battle never makes its own
  'params',     // URLSearchParams for THIS battle (the session rewrites `battle`)
  'signal',     // AbortSignal: every window/canvas listener this battle adds hangs on it
];

export function createBattleScene(context) {
  const missing = BATTLE_SCENE_CONTEXT.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('battle scene: missing context field(s) ' + missing.join(', '));
  }
  const { renderer, params: QUERY, signal } = context;

  // ---------------------------------------------------------------- the campaign seam
  // Null for every single-battle entry — `?battle=`, the review modes, every
  // gate — and then this battle begins and ends exactly as it always has. A
  // flow controller (src/boot/campaign.mjs) passes `{ beats, onEnd }`: the
  // beats REPLACE this battle's CLOSING SEQUENCE — the end card it would show
  // on its own, and any cinematic that runs on the way to it (an empty list
  // cuts straight on, under the next battle's entry card) — and `onEnd` fires
  // when they are done, in place of the terminal overlay.
  //
  // Where the replacement begins is the part worth stating: a battle's own
  // ending is everything AFTER its post-battle script. The script itself is how
  // the fight finishes and always plays; the mine finale is battle 1's closing
  // cinematic, and Jonah's 2026-08-03 ruling puts it at the end of the arc
  // rather than between the encounters, so a campaign replaces it along with
  // the card. See victorySequence() for the three endings side by side.
  const OUTRO = context.outro || null;

  // ---------------------------------------------------------------- resource ledger
  // Every GPU resource this scene allocates, recorded AT CREATION so a teardown
  // frees a list instead of guessing from the scene graph (which cannot see
  // scene.background, an envMap, or a material that has been swapped off its
  // mesh). The mechanism is one substitution: `THREE` below is not the three.js
  // namespace but a stand-in whose geometry/material/texture/render-target
  // classes register each instance as it is constructed. Every module in this
  // codebase takes THREE as injected context and none of them imports it, so
  // this single binding makes every construction site in the game trackable —
  // the ones written before the ledger existed included. See
  // src/render/resource-ledger.mjs for why track-at-creation is the only version
  // of this that works.
  const ledger = createResourceLedger(THREE_LIB);
  const THREE = ledger.three;

  // ---------------------------------------------------------------- constants
  // `QUERY` is destructured out of the context above rather than read from
  // `location.search` here. It is still the page's URL for the battle the page
  // was opened on — the session builds it from `location.search` — but a second
  // battle entered in the same session gets the same parameters with `battle`
  // rewritten, so every other knob (?fps, ?rules, ?tune, ?terrain, the sweeps)
  // carries across a transition exactly as it would across a reload.
  // A numeric URL knob with a fallback: what the warning bell's tuning panel has
  // always used, needed here too now that battle 1's numbers are being swept.
  const numKnob = (key, dflt) => {
    const v = parseFloat(QUERY.get(key));
    return Number.isFinite(v) ? v : dflt;
  };
  const REVIEW_MINE = QUERY.get('scene') === 'mine';
  const REVIEW_BATTLE = QUERY.get('scene') === 'battle';
  // Authored terrain is Battle 1's accepted production surface (Jonah,
  // 2026-07-30). ?terrain=procedural remains as the rollback/comparison view.
  const REVIEW_GATE_SKIN = QUERY.get('terrain') !== 'procedural';
  // Review-only second-encounter prototype (Jonah's 2026-07-30 spec in DESIGN.md):
  // the warning-bell gallery with the bonded pair. Opt-in URL, never the default —
  // Battle 1 and its locked balance are untouched without this parameter.
  // Which encounter is booting is a lookup against one content record now, not a
  // dozen scattered forks: src/content/battles/ owns the dimensions, entry
  // scene, card title, art set, music, AI zoning and outcome rule.
  const BATTLE_DEF = resolveBattle(QUERY.get('battle'));
  // Which DOMAIN RULES this battle plays under. Presentation knobs live beside
  // the thing they present; these are different in kind — the sim reads them, so
  // the balance bots and the golden logs can run any combination without a
  // rebuild. Declared per battle, overridden by `?rules=`, flipped live by
  // `__BATTLE.setRule()`, and read through `RULES.get()` at every use site rather
  // than captured into a const (AGENT_BRIEF trap 2).
  const RULES = createRules(BATTLE_DEF.rules, QUERY.get('rules'));
  const WARBELL = BATTLE_DEF.id === 'warning-bell';
  // Battle 3, the Figaro courtyard defense. Bolted on beside WARBELL rather
  // than refactored into a registry, for the same reason battle 2 was: a fork
  // per genuinely-different thing is legible, and a registry that abstracts
  // three one-off entry flows is not.
  const FIGARO = BATTLE_DEF.id === 'figaro-gate';
  const W = BATTLE_DEF.grid.width, D = BATTLE_DEF.grid.depth;   // gallery floor vs narrow ravine
  const TILE = 1;
  const HU = 0.3;               // one height unit

  const ROCK = 0, SNOW = 1, PATH = 2, ICE = 3, WOOD = 4, STAIR = 5;
  // Battle 3's ground, declared beside the rest of the enum and passed to the
  // terrain builder through its optional palette extension. Only ROCK and STAIR
  // mean anything to the RULES (nothing stands on rock; a stair bridges a
  // 2-unit rise), so a new type is a new material and nothing more.
  const SAND = 6, COBBLE = 7, CARPET = 8;

  // ---------------------------------------------------------------- render frame cap
  // Measured 2026-08-01 (tmp/fan-load-diagnosis.md): the loop rendered every rAF
  // frame whether or not anything moved, so a turn spent reading the screen cost
  // 97% of what a full combat animation cost — ~85% CPU and ~87% GPU on a retina
  // buffer. Only the RENDER is capped here. Every piece of game logic still ticks
  // at 60Hz, so tweens, timers, AI pacing and combat math are bit-identical to
  // before; the loop just draws fewer of the frames it computes.
  //
  // The cap is UNCONDITIONAL — same rate in cinematics, animations and idle turns
  // alike. An earlier version throttled only while the battle waited on the player
  // and ran everything else at 60; Jonah ruled that out by eye on 2026-08-02
  // (EXPERIMENTS.md): the split is what reads as stutter, because the eye catches
  // the change of rate rather than the rate itself, and a uniform 30 looks better
  // than a 60/15 split even though it costs more. Being unconditional also makes a
  // stalled screen impossible by construction — there is no wake trigger to miss.
  //
  // `RENDER_FPS` is a live knob (?fps=, __BATTLE.setFps) so 30 vs 60 can be
  // A/B'd by URL; anything >= 60 is effectively uncapped.
  let RENDER_FPS = Math.max(0, Number(QUERY.get('fps') ?? 30) || 0);
  let lastDrawAt = -Infinity;

  const runtimeTimers = createScheduler();
  const later = (callback, delay = 0) => runtimeTimers.schedule(callback, delay);
  const cancelLater = handle => runtimeTimers.cancel(handle);

  // ---------------------------------------------------------------- load progress
  // The counter behind the entry card's bar lives in src/boot/loading.mjs beside
  // the card it draws. It is constructed here, at the top, because every loader
  // below registers the items it is about to fetch with it.
  const loadProgress = createLoadProgress({ document });

  // ---------------------------------------------------------------- music
  // The chosen score first, older candidates only as a fallback. Everything here is
  // best-effort: a missing audio/ directory must leave the battle untouched.
  // AUDIO_VER is stamped on every request so a browser holding a cached copy of a
  // track that has since been replaced cannot keep serving it — bump it whenever
  // the audio in audio/ changes.
  const AUDIO_VER = 4;
  // The warning-bell battle prefers its own track the moment one lands in
  // audio/ (Jonah has one made for it); until then it falls back to battle1.
  const AUDIO_CANDIDATES = BATTLE_DEF.music
    .concat(['audio/battle1.mp3'])
    .concat(['A', 'B', 'C'].flatMap(k => ['ogg', 'mp3'].map(ext => `audio/battle1_candidate${k}.${ext}`)));
  const audioBtn = document.getElementById('audioBtn');
  // The warning-bell battle holds its track until the pair has entered: the
  // bell and the sentry play against silence, and Hoof and Horn lands with
  // Ragna's entrance (Jonah). The splash gesture still resumes the context, so
  // the deferred start needs no further user action. This setup runs early
  // (well before the warning-bell opening is constructed below) because
  // `chimeBell`/`cueBattleMusic` are handed to it as plain consts now, not
  // hoisted function declarations.
  const music = createMusicPlayer({
    loadProgress, audioBtn, candidates: AUDIO_CANDIDATES, version: AUDIO_VER,
    held: BATTLE_DEF.holdMusic,
  });
  const { musicReady, startMusic, cueBattleMusic, chimeBell, toggleMute } = music;
  // The score is the single largest resident object in the game (55-61 MB of
  // decoded PCM behind a 3.4 MB file) and audio is 55% of everything a chained
  // session would accumulate, so it is registered with the ledger at the moment
  // it is created rather than remembered at teardown.
  ledger.adopt('music', () => music.release());

  // ---------------------------------------------------------------- map data
  // The ravine builder still owns what every battle shares — the occupancy grid
  // and the two noise helpers — and fills the terrain for the first two. Battle
  // 3 authors its own H/T/S in its own map module and writes it over the flat
  // base; see `FLAT` in narshe-gate-ravine.mjs for why the base is needed at
  // all. The grids are the same arrays either way, so everything downstream
  // (terrain, pathing, the debug map) reads one board.
  const { H, T, S, BLOCKED, blockTiles, hash, mulberry } =
    createNarsheGateMap({ W, D, WARBELL, FLAT: FIGARO, ROCK, SNOW, PATH, ICE, STAIR });
  if (FIGARO) {
    const courtyard = createFigaroCourtyardMap({ W, D, ROCK, STAIR, SAND, COBBLE, CARPET });
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      H[z][x] = courtyard.H[z][x];
      T[z][x] = courtyard.T[z][x];
      S[z][x] = courtyard.S[z][x];
    }
    // The courtyard's freestanding cover claims its squares. Same contract as
    // the gallery's haulers: the tiles come from a PURE derivation over map
    // data, and the write is the page's, here, where every other rules input is
    // assembled — never the scenery module's (AGENT_BRIEF trap 6).
    for (const prop of figaroSolidPropTiles(figaroCourtyardMap))
      blockTiles(prop.x, prop.z, prop.x, prop.z);
  }

  // ---------------------------------------------------------------- procedural textures
  const { makeTex, texSnow, texRock, texCobble, plankTex, texPlank, texPlankDk } =
    createProceduralTextures({ THREE, mulberry });

  // ---------------------------------------------------------------- renderer / scene
  // The renderer, its canvas and its whole grade (pixel ratio, shadow map,
  // colour space, tone mapping and exposure) are the SESSION's — configured
  // once in src/boot/session.mjs and unchanged by any battle. A battle that
  // made its own would spend a WebGL context per encounter, and would reset
  // `renderer.info` on every transition, which is the counter the disposal
  // assertion reads. `uiRGB` below still inverts the grade against
  // `renderer.toneMappingExposure`, so the two stay one number.

  // Optional Battle 1 material study. The accepted geometry, map, lighting, units,
  // and rules remain exactly the same; only the material maps change. Keeping it
  // behind a query flag makes the comparison cheap and prevents an unreviewed art
  // experiment from silently replacing the normal game.
  let terrainSkinReady = Promise.resolve();
  let authoredTerrain = null;
  // Battle 1's authored sheets skin the cliffs/gate/battlefield materials below;
  // the warning-bell gallery dresses itself entirely through its own terrain
  // kit and narsheMineSkin, so REVIEW_GATE_SKIN's sheets are never sampled
  // there — don't fetch what that mode can never show.
  // (and the Figaro courtyard is a desert castle, so Narshe's snow/road/rock
  // sheets would be wrong on every surface it has — it stays procedural too)
  if (REVIEW_GATE_SKIN && !WARBELL && !FIGARO) {
    const loader = new THREE.TextureLoader();
    const pending = [];
    const loadAuthoredTexture = (file, repeat = 1) => {
      let settle;
      const ready = new Promise(resolve => { settle = resolve; });
      pending.push(ready);
      loadProgress.expect('terrain');
      const done = () => { loadProgress.tick('terrain'); settle(); };
      const texture = loader.load(
        `art/environments/narshe-gate/${file}`,
        () => done(),
        undefined,
        error => {
          console.error(`Battle 1 authored terrain texture failed: ${file}`, error);
          done();
        },
      );
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeat, repeat);
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return texture;
    };
    authoredTerrain = {
      snow: loadAuthoredTexture('snow-field-v2.png', 1.35),
      road: loadAuthoredTexture('winter-road-v1.jpg', 1.15),
      rock: loadAuthoredTexture('ravine-rock-v1.jpg', 1.2),
      timber: loadAuthoredTexture('hewn-timber-v1.jpg', 1.0),
    };
    terrainSkinReady = Promise.all(pending);
  }

  // ---------------------------------------------------------------- UI colour
  // The diorama is graded: the composer's OutputPass runs ACES over the whole frame,
  // which is right for the world and wrong for the UI painted into it — it lifts and
  // desaturates, and that is what was greying the HP bars (measured: an authored
  // #5fd08a fill reaching the screen as #92d4a8). Per-material `toneMapped:false`
  // cannot help, because in a composer the grade happens after everything is
  // composited, not per material.
  //
  // So pre-compensate instead: uiCol(hex) answers "what must I paint for ACES to
  // deliver the colour I asked for", by inverting the grade numerically. Nothing
  // about the world's look changes; only UI chrome is authored through it.
  const ACES_IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
  const ACES_OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
  const mul3 = (m, v) => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  function acesFit(v) {                                  // three.js RRTAndODTFit
    return v.map(x => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081));
  }
  function acesToneMap(lin) {
    const k = renderer.toneMappingExposure / 0.6;
    return mul3(ACES_OUT, acesFit(mul3(ACES_IN, lin.map(c => c * k))))
      .map(c => Math.min(1, Math.max(0, c)));
  }
  // sRGB transfer done by hand: three's Color helpers change meaning depending on
  // whether colour management is on, and this maths must not be ambiguous
  const toLin = s => s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  const toSRGB = l => l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  const _uiColCache = new Map();
  function uiRGB(hex) {                                  // -> [r,g,b] 0-255 to actually paint
    if (_uiColCache.has(hex)) return _uiColCache.get(hex);
    const target = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => toLin(v / 255));
    const lin = target.slice();
    for (let i = 0; i < 40; i++) {                       // multiplicative fixed point
      const got = acesToneMap(lin);
      let done = true;
      for (let c = 0; c < 3; c++) {
        if (target[c] < 1e-5) { lin[c] = 0; continue; }
        const ratio = target[c] / Math.max(got[c], 1e-5);
        if (Math.abs(ratio - 1) > 2e-4) done = false;
        lin[c] = Math.min(16, lin[c] * ratio);
      }
      if (done) break;
    }
    let out = lin.map(l => Math.round(Math.min(255, Math.max(0, toSRGB(l) * 255))));
    // THE SOLVE DOES NOT ALWAYS CONVERGE, and when it fails it fails LOUDLY in
    // the wrong direction — so check the answer instead of trusting it.
    //
    // The loop above is a per-channel multiplicative fixed point against a
    // transform that MIXES channels (the ACES matrices), so for a dark,
    // saturated colour a channel can chase a target it cannot reach, multiply
    // itself to the clamp, and come back as a completely different hue. Two
    // authored colours do exactly that: the danger keyline #3a0a72 was solved
    // to #4fff6d and reached the screen as PALE GREEN — a purple square with a
    // bright green outline, which is what the ruling that turned the danger
    // shading on made visible (Jonah, 2026-08-05) — and the float-text outline
    // #060810 solved to a navy #032261 where near-black was asked for.
    //
    // Verifying costs one forward evaluation. When the round trip lands on a
    // DIFFERENT COLOUR, the raw hex is painted instead: ACES then lifts and
    // desaturates it (that is the whole thing this function exists to undo),
    // but it keeps the right HUE, which is the property a keyline cannot do
    // without.
    //
    // THE THRESHOLD SEPARATES TWO FAILURES THAT ARE NOT ALIKE. A pale colour
    // that the graded display simply cannot reach (#fff6d6, #a8d8ff and eight
    // others) lands 20-45 short and its solve is still the best answer
    // available — those must keep it, and at 48 they do, so no colour in the
    // game moves except the two that were broken. A runaway lands 80 and 220
    // away, on a hue nobody asked for.
    const round = acesToneMap(out.map(v => toLin(v / 255)))
      .map(l => Math.round(toSRGB(l) * 255));
    const want = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    if (round.some((v, i) => Math.abs(v - want[i]) > 48)) out = want;
    _uiColCache.set(hex, out);
    return out;
  }
  const uiCol = hex => { const [r, g, b] = uiRGB(hex); return (r << 16) | (g << 8) | b; };
  // same, as a canvas fill string; alpha is untouched (it is not graded)
  const uiCss = (hex, alpha = 1) => { const [r, g, b] = uiRGB(hex); return `rgba(${r},${g},${b},${alpha})`; };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9db0cd);
  scene.fog = new THREE.Fog(0xa4b4cf, 58, 150);

  // The lens, the look-at point, and every way the game moves them (drag, wheel,
  // Q/E, the eased glide/zoom/orbit tweens) live in src/render/camera-rig.mjs.
  // The page keeps the DOM handles and the two tap destinations, which resolve at
  // call time because the input layer is built far below the camera.
  const rig = createCameraRig({
    THREE,
    canvas: renderer.domElement,
    bounds: { width: W, depth: D },
    rotateCwButton: document.getElementById('rotCW'),
    rotateCcwButton: document.getElementById('rotCCW'),
    viewport: () => ({ width: innerWidth, height: innerHeight }),
    onTap: ev => handleTap(ev),
    onDialogueTap: () => advanceDialogue(),
    signal,
  });
  const {
    camera, center: CENTER, ELEV, DIST, START_AZIMUTH: BATTLE_START_AZIMUTH,
    azimuth: azimuthNow, azimuthTarget, layout: layoutCamera, place: placeCamera, clampCenter,
    centerOn, zoomTo, cancelMoves: cancelCameraMoves, cancelGlide, isMoving: cameraMoving,
    setAzimuth, rotate, rotateTo, step: stepCamera, easeInOut, beginDialogueDrag, dragging: panning,
  } = rig;

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xdde6f5, 0x9aa0b4, 1.15);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xf5f8ff, 2.6);   // pale winter sun through overcast
  moon.position.set(CENTER.x - 16, 30, CENTER.z - 10);
  moon.target.position.copy(CENTER);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -13; moon.shadow.camera.right = 13;
  moon.shadow.camera.top = 15; moon.shadow.camera.bottom = -15;
  moon.shadow.camera.near = 4; moon.shadow.camera.far = 90;
  moon.shadow.bias = -0.0006;
  scene.add(moon, moon.target);

  // The two scenes share one coordinate space and one light rig, so a scene's own
  // lamps are tagged and switched off with it — otherwise the town's windows would
  // go on lighting the cliffs from inside a hidden building.
  const townLights = [], cliffLights = [], figaroLights = [];
  function warmLight(x, y, z, intensity = 1.8, dist = 5.5, bucket = townLights) {
    const l = new THREE.PointLight(0xffa050, intensity, dist, 2);
    l.position.set(x, y, z); scene.add(l); bucket.push(l); return l;
  }

  // ---------------------------------------------------------------- materials
  const mat = {
    rock:   new THREE.MeshStandardMaterial({ map: authoredTerrain?.rock || texRock, color: authoredTerrain ? 0xcbd2e5 : 0xffffff, roughness: 1 }),
    snow:   new THREE.MeshStandardMaterial({ map: authoredTerrain?.snow || texSnow, color: authoredTerrain ? 0xf6f9ff : 0xffffff, roughness: 0.95 }),
    path:   new THREE.MeshStandardMaterial({ map: authoredTerrain?.road || texCobble, color: authoredTerrain ? 0xc2ccdc : 0xffffff, roughness: 0.9 }),
    ice:    new THREE.MeshStandardMaterial({ color: 0x9fd2e8, roughness: 0.25, metalness: 0.1 }),
    plank:  new THREE.MeshStandardMaterial({ map: authoredTerrain?.timber || texPlank, color: authoredTerrain ? 0xd7c1ac : 0xffffff, roughness: 0.9 }),
    plankDk:new THREE.MeshStandardMaterial({ map: authoredTerrain?.timber || texPlankDk, color: authoredTerrain ? 0x887361 : 0xffffff, roughness: 0.92 }),
    wood:   new THREE.MeshStandardMaterial({ map: authoredTerrain?.timber || null, color: authoredTerrain ? 0xb89b7f : 0x8a6a48, roughness: 0.85 }),
    woodDk: new THREE.MeshStandardMaterial({ map: authoredTerrain?.timber || null, color: authoredTerrain ? 0x77604c : 0x53402c, roughness: 0.9 }),
    beam:   new THREE.MeshStandardMaterial({ map: authoredTerrain?.timber || null, color: authoredTerrain ? 0x66513f : 0x3d2f22, roughness: 0.9 }),
    stone:  new THREE.MeshStandardMaterial({ map: authoredTerrain?.rock || texRock, color: authoredTerrain ? 0xaeb7ca : 0xffffff, roughness: 0.95 }),
    window: new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xffa040, emissiveIntensity: 0.9 }),
    lampGlass: new THREE.MeshStandardMaterial({ color: 0xffd090, emissive: 0xffb050, emissiveIntensity: 2.2 }),
    iron:   new THREE.MeshStandardMaterial({ color: 0x2b2f3d, roughness: 0.7, metalness: 0.5 }),
    ore:    new THREE.MeshStandardMaterial({ color: 0x3a3f52, roughness: 0.85, metalness: 0.25, flatShading: true }),
    pineA:  new THREE.MeshStandardMaterial({ color: 0x2d6a4a, roughness: 1, flatShading: true }),
    pineB:  new THREE.MeshStandardMaterial({ color: 0x3b7d5c, roughness: 1, flatShading: true }),
    pineSnow: new THREE.MeshStandardMaterial({ color: 0xe2e9f6, roughness: 1, flatShading: true }),
    trunk:  new THREE.MeshStandardMaterial({ color: 0x3f3226, roughness: 1 }),
    dark:   new THREE.MeshStandardMaterial({ color: 0x0c0e18, roughness: 1 }),
    plinth: new THREE.MeshStandardMaterial({ color: 0x4d5872, roughness: 1, flatShading: true }),
    smoke:  new THREE.MeshBasicMaterial({ color: 0xc9d2e4, transparent: true, opacity: 0.35 }),
  };
  // Battle 3's ground, stone and dressing, built only when battle 3 is the one
  // booting so the two shipped encounters allocate exactly the materials they
  // always have. The palette itself (coursed slate brick, ochre cobble, dune
  // sand, crimson runner, the house banner) and the dusk backdrop are
  // src/render/figaro-textures.mjs.
  const figaroDressing = FIGARO
    ? createFigaroDioramaDressing({ THREE, makeTex, atlasUrl: FIGARO_PAINTED_ATLAS })
    : null;
  if (figaroDressing) Object.assign(mat, figaroDressing.materials);

  const world = new THREE.Group();
  scene.add(world);
  function box(w, h, d, m, x, y, z, { shadow = true, group = world } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    group.add(mesh); return mesh;
  }

  // ---------------------------------------------------------------- terrain
  // Battle 1's walkable terrain build (the H/T/S grid loop, the display
  // plinth, and the tactical grid line overlay) is src/render/terrain-mesh.mjs
  // now. `box` is the page's shared primitive, passed in the same way the
  // scenery/scene modules already take it. The warning-bell gallery keeps
  // using the separate content-driven src/render/terrain-kit.mjs boundary.
  // `topThick` stays a page-level constant — the mine finale, the terrain-kit
  // boundary, and `layoutOverhead` all read it too.
  const topThick = 0.09;
  const { tileTop, tileMeshes } = createTerrainMesh({
    THREE, world, box, mat, HU, TILE, W, D, T, S, H,
    ROCK, SNOW, PATH, ICE, WOOD, STAIR, hash, topThick,
    // The palette extension, and only battle 3 passes one: its three new tile
    // types, the stone its columns and wall caps are cut from instead of
    // Narshe's snow-dusted crag. Null for the other two, which is main exactly.
    extraTops: FIGARO ? { [SAND]: mat.sand, [COBBLE]: mat.cobble, [CARPET]: mat.carpet,
      [STAIR]: mat.cobble } : null,
    columnMat: FIGARO ? mat.figaroStone : null,
    // A wall's top is a course of dressed capstones, not brick seen end-on, and
    // it is LEVEL: the per-tile height jitter is what makes a Narshe crag ragged
    // and what made the castle's battlements look hand-piled.
    rockCapMat: FIGARO ? mat.figaroCap : null,
    rockJitter: FIGARO ? 0 : 0.22,
  });

  // ---------------------------------------------------------------- warning-bell gallery dressing
  // The engine's flat PATH tiles stay the walkable/pickable surface; the terrain
  // kit supplies the cavern, shaft, rails, and props around them. The kit centres
  // its coordinates on the room origin, so the whole group translates to the grid
  // centre and rises until its slab tops meet the engine floor.
  let warbellAnchors = null;
  let wbSouthWall = null;
  let gallerySkinReady = Promise.resolve();
  // Cinematic plates for the bell entrance preload with everything else — the
  // no-cap entry card waits for these too. Failures settle rather than hang.
  let wbPlatesReady = Promise.resolve();
  const wbPlateTex = {};
  if (WARBELL) {
    const plateLoads = [];
    for (const [key, path] of [
      // The bell is the one plate left here: the sentry became a gait-driven
      // actor and now draws from the miner set the art pass already loads.
      ['bell', 'art/runtime/review/bonded_defender_cragbeast/warning_bell.png'],
    ]) {
      loadProgress.expect('plates');
      plateLoads.push(new Promise(resolve => new THREE.TextureLoader().load(path, tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        wbPlateTex[key] = tex;
        loadProgress.tick('plates');
        resolve();
      }, undefined, () => {
        // Settling silently is what let partial art ship unnoticed once already;
        // the cinematic plates report through the same structured channel as
        // every other asset (__BATTLE.artErrors()).
        artLoadErrors.push({ name: 'warbell-plate', pose: key, path, error: 'texture load failed' });
        loadProgress.tick('plates');
        resolve();
      })));
    }
    wbPlatesReady = Promise.all(plateLoads);
  }
  if (WARBELL) {
    // The sheets that actually fetch are the skin's; procedural definitions cost
    // nothing to wait for and are not counted. close('gallery') reconciles if the
    // kit's own rule for what fetches ever diverges from this one.
    loadProgress.expect('gallery',
      Object.values(narsheMineSkin.textures).filter(texture => texture.url).length);
    const kit = buildTerrainKit({
      THREE, renderer, scene: world,
      map: warningBellGalleryMap, skin: narsheMineSkin,
      onTextureSettled: () => loadProgress.tick('gallery'),
    });
    const slabTop = warningBellGalleryMap.grid.surfaceY + warningBellGalleryMap.grid.slabHeight / 2;
    kit.group.position.set(W / 2, (1 * HU + topThick) - slabTop, D / 2);
    // The carts and crates OCCUPY their squares (Jonah, 2026-08-03: he walked a
    // unit straight through a hauler). The tiles come from the map rather than
    // from the kit that just drew them — see gallerySolidPropTiles for why a
    // view module must not be the thing that writes BLOCKED — and the write is
    // the page's, here, where every other rules input is assembled. Movement,
    // pathing, reachability, the AI, the danger shading and arrow lanes all ask
    // the same grid, so they follow from this one line.
    for (const prop of gallerySolidPropTiles(warningBellGalleryMap))
      blockTiles(prop.x, prop.z, prop.x, prop.z);
    warbellAnchors = kit.anchors || null;
    wbSouthWall = (kit.namedGroups && kit.namedGroups.south) || null;
    if (wbSouthWall) wbSouthWall.visible = false;   // hidden until the camera faces it
    // the entry card holds until the floor is dressed, and any sheet that failed
    // to fetch is reported rather than quietly falling back to a bare material
    gallerySkinReady = kit.ready.then(() => {
      for (const failure of kit.errors) {
        artLoadErrors.push({
          name: 'terrain-kit', pose: failure.texture, path: failure.url,
          error: 'texture load failed',
        });
      }
    });
  }

  // ---------------------------------------------------------------- rugged buildings
  const smokeStacks = [];
  const buildingOccluders = [];
  const occlusionRay = new THREE.Raycaster();
  const occlusionTarget = new THREE.Vector3();
  const occlusionDirection = new THREE.Vector3();
  const occlusionRight = new THREE.Vector3();
  const BUILDING_GHOST_OPACITY = 0.16;
  function registerBuildingOccluder(group, name) {
    const materials = new Set();
    group.traverse(object => {
      if (!object.isMesh || !object.material) return;
      const sources = Array.isArray(object.material) ? object.material : [object.material];
      const clones = sources.map(source => {
        const material = source.clone();
        material.userData.occlusionBase = {
          opacity: source.opacity,
          transparent: source.transparent,
          depthWrite: source.depthWrite,
        };
        materials.add(material);
        return material;
      });
      object.material = Array.isArray(object.material) ? clones : clones[0];
    });
    buildingOccluders.push({ name, group, materials: [...materials], opacity: 1, blocked: false });
  }
  function buildingBlocksUnit(building, unit) {
    // A roof can hide a figure's feet without crossing the torso ray (especially
    // on stepped terrain). Sample the readable body column rather than one point:
    // if scenery masks any substantial band, cut the whole building away.
    camera.updateMatrixWorld();
    occlusionRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const width = unit.sprite && unit.sprite.geometry.parameters.width || 1;
    for (const ratio of [0.18, 0.46, 0.74]) {
      for (const spread of [-0.38, 0, 0.38]) {
        occlusionTarget.set(
          unit.group.position.x,
          unit.group.position.y + unit.topY * ratio,
          unit.group.position.z,
        ).addScaledVector(occlusionRight, width * spread);
        occlusionDirection.copy(occlusionTarget).sub(camera.position);
        const distance = occlusionDirection.length();
        if (distance <= 0.1) continue;
        occlusionRay.set(camera.position, occlusionDirection.multiplyScalar(1 / distance));
        occlusionRay.far = distance - 0.12;
        if (occlusionRay.intersectObject(building.group, true).length) return true;
      }
    }
    return false;
  }
  function setBuildingOpacity(building, opacity) {
    for (const material of building.materials) {
      const base = material.userData.occlusionBase;
      material.opacity = base.opacity * opacity;
      const ghosted = opacity < 0.995;
      if (material.transparent !== (base.transparent || ghosted) ||
          material.depthWrite !== (ghosted ? false : base.depthWrite)) {
        material.transparent = base.transparent || ghosted;
        material.depthWrite = ghosted ? false : base.depthWrite;
        material.needsUpdate = true;
      }
    }
  }
  function updateBuildingOcclusion(dt) {
    if (!world.visible) return;
    const visibleUnits = units.filter(unit => unit.alive && unit.group.parent);
    const blend = 1 - Math.exp(-dt * 11);
    for (const building of buildingOccluders) {
      building.blocked = visibleUnits.some(unit => buildingBlocksUnit(building, unit));
      const target = building.blocked ? BUILDING_GHOST_OPACITY : 1;
      building.opacity += (target - building.opacity) * blend;
      if (Math.abs(building.opacity - target) < 0.002) building.opacity = target;
      setBuildingOpacity(building, building.opacity);
    }
  }
  // ---------------------------------------------------------------- figaro courtyard dressing
  // Battle 3's set pieces: battlements, the portcullis and its banners, the
  // gatehouse towers, the wall ladders, the wreckage in the breach and the
  // torches. It takes no `blockTiles`: which tiles the courtyard's props occupy
  // was written above, from the map, and a scenery module that also wrote it
  // would be trap 6 all over again. It DOES take the building-occlusion gate,
  // because the towers are tall, near the camera, and would otherwise hide a
  // unit — the same problem battle 1's bunkhouse has and the same answer, which
  // is also why this is built HERE and not up beside the terrain: the gate's
  // `buildingOccluders` list is a `const` just above, and calling into it from
  // the terrain block would read it in its temporal dead zone (trap 1).
  const figaroScenery = FIGARO ? createFigaroDioramaBattlefield({
    THREE, world, box, mat, HU, topThick, tileTop, warmLight,
    lights: figaroLights, map: figaroCourtyardMap, W, D,
    registerBuildingOccluder,
  }) : null;

  // The rugged buildings, mine entrance, headframe, timber/ore piles, watch
  // post, lamps, pines, boulders, and crates/barrels/fences that dress the
  // terraced invasion ravine live in src/render/battle1-scenery.mjs — pure
  // one-way mesh construction, so it needs almost nothing back except the
  // headframe's hoist wheel (spun every frame below) and the shared
  // smokeStacks/buildingOccluders lists it populates by reference. Building
  // occlusion itself (the visibility-gate mechanic just above) stays here:
  // it is a generic per-frame system keyed on camera/units, not a scenery
  // concern, even though it reads the buildings this module registers.
  // `warbell` is the field's name for "none of this dresses THIS battle", and
  // battle 3 answers it the same way battle 2 does: the courtyard has its own
  // scenery module and none of Narshe's cabins, pines or headframe belong in it.
  const battle1Scenery = createBattle1Scenery({
    THREE, world, box, mat, HU, topThick, blockTiles, warmLight,
    warbell: WARBELL || FIGARO, mulberry, hash, H, T, W, D, rockTile: ROCK,
    registerBuildingOccluder, smokeStacks,
  });
  const { hoistWheel } = battle1Scenery;

  // ---------------------------------------------------------------- atmosphere
  // The falling-snow particle system (built but disabled — see the module) and
  // the bloom/tilt-shift postprocessing composer are src/render/atmosphere.mjs
  // now. The per-frame snow drift and composer.render() call stay in the
  // render loop below (per-frame territory), so this only builds the pieces.
  const { snowPts, composer, bloom, bokeh } = createAtmosphere({
    THREE, renderer, scene, camera, center: CENTER, dist: DIST,
    EffectComposer, RenderPass, UnrealBloomPass, BokehPass, OutputPass,
  });
  // The post chain is the one part of the scene the ledger's THREE substitution
  // cannot see: the addons import three directly, so their render targets and
  // shader materials are built with the real classes. `EffectComposer.dispose()`
  // frees its two full-resolution ping-pong targets and its copy pass but NOT
  // the passes it holds, and the bloom pass alone owns eleven render targets and
  // six materials — so both halves are freed here, explicitly.
  ledger.adopt('composer', () => {
    for (const pass of composer.passes) if (typeof pass.dispose === 'function') pass.dispose();
    composer.dispose();
  });
  // WARNING (2026-08-01): these two sizes are NOT independent, and the composer
  // does not take its resolution from the renderer. `composer.setSize()` applies
  // the pixel ratio it cached when it was constructed, so calling
  // `renderer.setPixelRatio(n)` without telling the composer leaves the whole
  // post chain rendering at the OLD ratio — a silent 2x cost on retina, or a
  // silent half-resolution image, with nothing throwing either way. If a
  // devicePixelRatio clamp is ever added here, it must set BOTH.
  //
  // The window's resize event is the SESSION's — one listener for the tab,
  // outliving any battle — so this is the handler rather than the
  // registration. Same three calls, same order, in the same relationship.
  function layout() {
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    layoutCamera();
  }


  // ================================================================================
  // GAME — tactics battle layer (units, turn state machine, input, AI, UI)
  // Everything above builds the diorama; nothing below changes its look.
  // ================================================================================

  // ---------------------------------------------------------------- game constants
  // Triangle-Strategy TP: +1 at each unit's turn start, cap 5. Move and one action
  // are free every turn; abilities spend the saved points.
  const TP_GAIN = 1, TP_CAP = 5;
  let combatRand = Math.random;   // __BATTLE.seed(n) swaps in a deterministic PRNG for sims
  let FAST_SIM = false;          // headless sims: render 1 frame in 10 (logic still ticks every frame)
  let STEP_TIME = 0.15;         // seconds per tile of walk animation
  // REVERT SWITCH for painted walk cycles in BATTLE movement. true: a battle step
  // plays the character's walk frames and drops the hop, the same as a cutscene
  // walk. false: battle movement is exactly what it was before walk cycles existed —
  // static frame, hop-glide — with no other behaviour touched. Cutscene walking
  // (the cliffs march) ignores this switch and always animates. Declared `let` only
  // so __BATTLE.setBattleWalk() can flip it for tests; edit the value here to revert.
  let BATTLE_WALK_ANIM = true;
  // The exploratory coda remains available as a prototype, but the story now
  // continues into the mine by default. Append ?explore=1 to branch into the
  // free-roaming experiment after the gate battle instead.
  const POST_BATTLE_EXPLORE =
    QUERY.get('explore') === '1';
  // Companion switch for the three-way view pick (front/back/SIDE). true: any figure
  // with a _side plate uses it wherever its facing is square to the lens, battle
  // included. false: battle units keep the original front/back split and only the
  // cutscene actors get the profile. This is frame SELECTION for a standing figure,
  // independent of whether anything is animating.
  const SIDE_VIEW_IN_BATTLE = true;
  const ESCALATE_START = 6;     // pacing knob: alchemist flask range grows +1 per 2 rounds after this
  // How close the assault must be before an idle archer steadies up. Retired by
  // the archer-priority change and RESTORED here as the smartMilitia=off path:
  // with the improvements switched off the militia must play exactly as they do
  // on main, and this gate is part of that.
  const AIM_ALERT_RANGE = 6;
  // When the flask's range creep begins, or Infinity for never.
  //
  // `?escalate=never` is a MEASUREMENT instrument, not a game rule: element 5's
  // study has to separate "turn the escalation off" from "turn the advance on",
  // and the shipped flag does both at once. It stays a plain pacing knob like
  // the constant it overrides, because the sim's rules do not read it — the
  // number it produces is just a range.
  const ESCALATE_OFF = QUERY.get('escalate') === 'never';
  const escalationStart = () =>
    (ESCALATE_OFF || RULES.get('aggressiveDefense')) ? Infinity : ESCALATE_START;
  let AI_BEAT = 400;            // ms of pacing between AI decisions (fast() shrinks both for headless sims)
  const ADJ_PENALTY = 0.4;      // bows are useless in someone's face
  // Hard minimum shot (rules.archerMinRange). Jonah ruled 2026-07-31 that the 40%
  // adjacent shot — an original-prototype AI choice, never his spec — is arbitrary
  // and illegible, and that a hard minimum is the direction. 2 is the whole rule:
  // a bow cannot fire at the tile beside it, so a melee-less archer with someone
  // in its face repositions or spends the turn on something else. It REPLACES the
  // penalty rather than stacking with it.
  //
  // SCOPE, RE-RULED (Jonah, 2026-08-02, via the lead session): BOWS ONLY. Seira's
  // bolt and the alchemists' flasks are exempt, per the FFT convention that a mage
  // can hit the tile beside her. The first cut covered every ranged unit, and that
  // scope is what Jonah hit in play as a bug: standing next to Ragna, Seira simply
  // could not bolt him, and in her Type-2 form the only button she had left was
  // Heal. It read as broken because it WAS the wrong rule — the rationale ("a
  // weapon you have to wind up cannot be used point blank") is archery's, not
  // magic's. `cls === 'archer'` is the bow test, the same one `shotBlocked` uses.
  // Non-bows keep full-damage adjacent shots under the flag; with the flag off,
  // main's 40% penalty still applies to all of them, which is what keeps
  // `?rules=none` equal to main. Abilities keep their own reach; this is the
  // plain shot only, which is also all the 40% ever touched.
  const MIN_SHOT_RANGE = 2;
  // How far apart two tiles count for RANGE purposes (rules.diamondRange).
  //
  // The engine has always measured reach with Chebyshev distance, which makes a
  // range-6 bow cover a 13x13 SQUARE — and a diagonal shot reach 1.41x further
  // than a straight one. The genre does not do this: FFT and Triangle Strategy
  // use Manhattan distance, so range 1 is a plus-sign and range 2 and up are
  // diamonds (see BATCH1_NOTES for the sourcing). This swaps the metric for
  // every TARGETED reach — weapon range, ability range, the minimum shot, the
  // AI's reasoning about all of them, and the danger shading that draws them.
  //
  // One predicate, read live, used by every consumer. That is the whole point:
  // a forecast, a highlight, an AI plan and the legality check must never
  // measure the board differently from each other.
  //
  // Movement is NOT affected and needs no flag: `findReachable` walks
  // CARDINAL_DIRECTIONS one step at a time, so a move budget has always been
  // Manhattan by construction. Mournful Cry's 5x5 burst is NOT affected either
  // (see `burstDistance` below) — a burst is an area, not a reach.
  const rangeDist = (a, b) => (RULES.get('diamondRange') ? manh(a, b) : cheb(a, b));
  // What the guard costs under rules.defendCostsTp. 1 TP is the whole rule: a
  // free Defend dominated Wait (there was never a reason to end a turn unspent
  // rather than end it guarding, so one of the two buttons was dead), and at 1 TP
  // the guard is a purchased hedge competing with Righteous Anger, Sentinel's Eye
  // and Purify for the same currency. It also gives Wait its job back — banking
  // the point is now the reason to press it.
  const DEFEND_TP = 1;
  // Rear attacks (rules.rearAttack). ×1.5 is the genre's back-attack figure, and
  // it sits at the top of the band because the quadrant rule in core/combat.mjs
  // makes a rear hit something the player has to walk around for: a flank from
  // behind-and-to-the-side gets nothing, and melee only reaches the tile directly
  // behind. A bonus small enough to ignore would leave the facing picker exactly
  // as decorative as it is on main, which is the thing this element is here to fix.
  const REAR_MULT = 1.5;
  const AIM_MULT = 2, AIM_BONUS_RANGE = 2;   // Take Aim: ×2 damage, +2 bow range, held until used
  const HI_MOD = 1.25, LO_MOD = 0.8;    // shooting downhill / uphill
  const ENGAGE_RANGE = 6;       // defenders hold their terrace until the player closes

  // The abilities themselves are declared in `src/content/abilities/battle-kit.mjs`
  // and reached through the registry built in the abilities section below: one
  // definition owns a name, a cost, what it may be pointed at, what casting it
  // does, and what the forecast promises. These are the numbers it is handed.
  // BATCH 1: poison stays at 6. Raising it to 9 was tried first, on the theory
  // that DESIGN.md's named anti-rush tax ("rushers never cleanse it, kit play
  // Purifies it away") should absorb the rebalance. MEASURED, and wrong: it
  // barely moved the rush line (which was winning on clear RATE, not on
  // survival) and it killed Cassien in the kit line at round 14. Poison is far
  // less differential than the doctrine sentence implies, because a unit only
  // gets Purified when someone is both in range and holding the TP. Reverted.
  const CRY_DMG = 16, CRY_SELF = 5, CRY_RADIUS = 2;
  // Poison, and what it costs to ignore it.
  //
  // BASE is main's: 6 a turn for 3 turns, 18 total — unpleasant, survivable, and
  // therefore something a plain-attack party simply eats. rules.lethalPoison
  // raises it to 10 for 4 turns, 40 total, which is a whole imperial's health
  // bar: uncleansed it kills, so Purify stops being a convenience and becomes
  // the only answer. That is the shape the doctrine needs — a capability plain
  // attacks cannot substitute for at any damage number.
  // rules.scaledPoison then measures the bite against the VICTIM instead of in
  // flat points, because flat lethal poison lands unevenly in the worst possible
  // way: 40 is exactly Seira's maximum, so one unanswered flask is not a wound to
  // the mage, it is her death, while the knight walks out of the same flask on 12.
  // A party that cannot cleanse therefore has one dominant reply — kill the two
  // units that can throw — and Jonah played it. A fraction of maximum health is
  // the same threat to everybody, so the flask stops being an execution aimed at
  // one member of the party. 20% for four turns is 80% of anyone's bar: survivable
  // alone, lethal in combination with anything else, and still answered by Purify.
  const POISON_TURNS_BASE = 3, POISON_DMG_BASE = 6;
  const POISON_TURNS_LETHAL = 4, POISON_DMG_LETHAL = 10;
  // Sweepable, because the design search needs to ask how hard poison should
  // bite without a rebuild: `?pfrac=0.12` / `--config x:pfrac=0.12`. The default
  // is the shipped number, so an unswept run is the shipped game.
  const POISON_FRACTION = numKnob('pfrac', 0.2);
  const poisonTurns = () => RULES.get('lethalPoison') ? POISON_TURNS_LETHAL : POISON_TURNS_BASE;
  const poisonDamage = (victim = null) => {
    const flat = RULES.get('lethalPoison') ? POISON_DMG_LETHAL : POISON_DMG_BASE;
    if (!RULES.get('scaledPoison') || !victim) return flat;
    return Math.max(1, Math.round(POISON_FRACTION * victim.maxHp));
  };
  // A militiaman firing from a formed rank hits harder (rules.massedVolley):
  // +25% per adjacent ally, capped, so a clustered line is genuinely dangerous
  // and breaking the cluster in ONE action — which only Mournful Cry does — is
  // the answer. Reads in fiction as a volley rather than as a stat.
  // Swept by the design search: 25% an ally was always a guess, and the notes
  // have called it "the wrong size" since it was built.
  const VOLLEY_PER_ALLY = numKnob('volley', 0.25), VOLLEY_CAP = numKnob('volleycap', 1.5);

  // ---------------------------------------------------------------- tiny tween runner
  const tweens = [];
  function tween(dur, onUpdate, onDone) { tweens.push({ t: 0, dur, onUpdate, onDone }); }
  // Scripted cinematics run on fixed durations, so __BATTLE.fast() used to speed
  // up the simulation and leave the ten-second bell entrance at full length —
  // every automated run of the warning-bell gates paid it in wall time and in
  // flake margin. These two wrappers are the cinematic's clock; gameplay pacing
  // is untouched, so nothing a player sees changes.
  let CINE_SCALE = 1;
  const cineTween = (dur, onUpdate, onDone) => tween(dur * CINE_SCALE, onUpdate, onDone);
  const cineLater = (fn, ms) => later(fn, ms * CINE_SCALE);
  function stepTweens(dt) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt;
      const p = Math.min(1, tw.t / tw.dur);
      tw.onUpdate(p);
      if (p >= 1) { tweens.splice(i, 1); if (tw.onDone) tw.onDone(); }
    }
  }

  // ---------------------------------------------------------------- grid helpers
  // The battlefield predicates themselves (walkable/stepOK/reachable/pathTo/
  // attackTargets/heightMod and friends) are src/core/battle-grid.mjs now, and
  // are constructed below, beside the roster they read. `tileCenter` stays here:
  // it is a world-space position, not a rule, and the unit factory takes it.
  function tileCenter(x, z) { return new THREE.Vector3(x + 0.5, tileTop[z][x], z + 0.5); }
  // ranged reach is Chebyshev — a square envelope reads cleanly against the 3×3 burst

  // ---------------------------------------------------------------- pixel-art units
  // The painter itself is src/render/sprite-painter.mjs. What stays here is the
  // pose dispatch, because choosing between a painted plate and the procedural
  // sprite underneath it is knowledge about a unit, not about painting one.
  const { unitSprite, spriteFigure, spriteBust } = createSpritePainter({ THREE });
  function setSpritePose(u, pose) {
    if (u.art) {                                  // painted art has its own frames
      setArtFrame(u, pose === 'down' ? (u.art.down || u.art.front) : (u.art[u.artFace] || u.art.front));
      u.artKey = pose === 'down' ? 'down' : u.artFace;
      if (pose === 'down') layDownArt(u);
      return;
    }
    const s = unitSprite(u.kind, u.pal, pose);
    u.sprite.material.map = s.tex;
    u.sprite.material.needsUpdate = true;
    u.sprite.userData.grid = s.grid;
    u.sprite.userData.solid = gridSolid(s.grid);
  }

  // ---------------------------------------------------------------- painted character art
  // The plate sets, the view selection, the walk cycles and the art pass itself
  // are src/render/painted-art.mjs. Everything the page still calls is
  // destructured once here, so the per-frame billboard() calls below stay direct
  // closure calls rather than property lookups on a namespace object.
  const paintedArt = createPaintedArt({
    THREE, renderer, camera, loadProgress, setSpritePose,
    sideViewInBattle: SIDE_VIEW_IN_BATTLE,
    // read live, never captured: setBattleWalk() must take effect on the next
    // frame rather than at the next move
    battleWalkAnim: () => BATTLE_WALK_ANIM,
    reviewMine: REVIEW_MINE, warbell: WARBELL, battleDef: BATTLE_DEF,
    // the portrait maps are declared far below this point, so a form's face is
    // read and written through accessors rather than captured objects
    loadedPortrait: key => dialogue.loadedPortrait(key),
    overridePortrait: (key, img) => dialogue.overridePortrait(key, img),
  });
  const {
    ART_H, ART_VIEWS, ART_WALK_MAX, WALK_CYCLES_PER_TILE, WALK_CONTACT_HOLD,
    artLoadErrors,
    setArtFrame, layDownArt, layoutOverhead, useArt, applyFormArt, artSetKey,
    actorSetFrame, useActorArt,
    trackWalkDistance, pickView, frameKeyFor, setWalking, gaitOn, billboard,
    walkFrames, walkFrameCount, walkCycle, walkWeights, walkPhase, walkFraction,
    artBust, artPortrait,
  } = paintedArt;
  // Loading is the module's; what happens once it settles is the scene's. Applying
  // the decoded sets to the units and cutscene actors THIS page built, and
  // revealing every figure whether the pass succeeded or threw, stay here.
  const artReady = (async () => {
    const platesLoaded = paintedArt.loadPlates();   // reserves its estimate synchronously
    try {
      await platesLoaded;
      let any = false;
      for (const u of units) any = useArt(u) || any;
      for (const a of cliffActors) useActorArt(a);
      for (const a of minePartyActors) useActorArt(a);
      if (any) { renderStrip(); if (dialogueUp()) drawBeat(); }
    } finally {
      for (const u of units) u.group.visible = true;
      for (const a of cliffActors) a.group.visible = true;
      for (const a of minePartyActors) a.group.visible = true;
    }
  })();


  // ---------------------------------------------------------------- unit factory
  // HP bars, floating combat text, addUnit (a roster definition -> a fielded
  // unit, battle-state record plus every visual indicator), and the
  // warning-bell tuning knobs (REVENGE_DMG/HEAL_AMT/BERSERK_MULT/SOLO_REVENGE)
  // all live in src/flow/unit-factory.mjs now. `spriteFigure`/`setArtFrame`/
  // `layoutOverhead` are the page's shared paintedArt/sprite-painter instances,
  // handed in the same way cliffs-opening.mjs and mine-finale.mjs already take
  // them.
  const unitFactory = createUnitFactory({
    THREE, world, scene, tileCenter, spriteFigure, setArtFrame, layoutOverhead,
    uiCol, uiCss, makeTex, tween, query: QUERY,
  });
  const {
    units, addUnit, uiChrome, floatText, wbNum,
    revengeDamage, setRevengeDamage, healAmount, setHealAmount, healRange,
    berserkMultiplier, setBerserkMultiplier, berserkHot, soloRevenge, setSoloRevenge,
  } = unitFactory;

  // ---------------------------------------------------------------- battlefield rules
  // What is walkable, who stands where, how far a unit gets, what it can hit and
  // what the ground is worth: src/core/battle-grid.mjs, bound to THIS battle's
  // terrain arrays, roster and combat constants. Constructed here rather than up
  // with the map because it closes over the live `units` array — the same array
  // `addUnit` fills in below, so the predicates see this turn's board.
  const battleGrid = createBattleGrid({
    width: W, depth: D, heights: H, tiles: T, blocked: BLOCKED,
    rockTile: ROCK, stairTile: STAIR,
    units,
    aimBonusRange: AIM_BONUS_RANGE,
    highGroundMultiplier: HI_MOD, lowGroundMultiplier: LO_MOD,
    zonedAi: BATTLE_DEF.zonedAi,
    // Experiment batch 1's reach rules. Each reads its flag LIVE at the moment
    // the grid asks, so `__BATTLE.setRule()` mid-battle reaches the targeting
    // list on the very next question rather than on the next page load.
    rangeDistance: (a, b) => rangeDist(a, b),
    minShotRange: u => minShotRange(u),
    shotBlocked: (att, tgt) => shotBlocked(att, tgt),
    bodiesBlock: () => RULES.get('bodiesBlock'),
  });
  const {
    inBounds, walkable, stepOK, terraceOf,
    unitAt, unitById, living,
    reachable, pathTo,
    shotRange, attackTargets, attackFootprint, heightMod,
  } = battleGrid;

  // The whole field, built from content: each roster entry in the battle record
  // references a character record (src/content/characters/), which owns that
  // character's identity, stats, kit and forms wherever it is fielded. The trio's
  // numbers therefore exist ONCE for both encounters, and the roster says only
  // what is true of this deployment — the tile, a stock defender's numbered name,
  // starting TP, fielded forms, and which stats a live knob above owns.
  const rosterDefs = rosterUnitDefs(BATTLE_DEF, { number: wbNum, ruleOn: name => RULES.get(name) });
  for (const def of rosterDefs) addUnit(def);
  const rosterDefOf = charId => rosterDefs.find(def => def.charId === charId);

  if (WARBELL) {
    // Jonah's live tuning panel — dev chrome, gated behind &tune=1 so
    // playtesters never see it (Jonah, 2026-07-31). The knobs themselves stay
    // URL-seeded either way. The panel owns its own dials; the page only says
    // which values they reach and where a restart goes.
    if (QUERY.get('tune') === '1') {
      document.body.appendChild(createEncounterTuningPanel({
        document,
        battleId: 'warningbell',
        knobs: {
          revengeDamage: { get: revengeDamage, set: setRevengeDamage },
          healAmount: { get: healAmount, set: setHealAmount },
          berserkMultiplier: { get: berserkMultiplier, set: setBerserkMultiplier },
          soloRevenge: { get: soloRevenge, set: setSoloRevenge },
        },
        // The panel seeds its dials from what this deployment actually fielded,
        // so a restart carries the tuned numbers rather than the record's.
        enemies: {
          captain: { hp: rosterDefOf('ragna').hp, atk: rosterDefOf('ragna').atk },
          beast: { hp: rosterDefOf('skarn').hp, atk: rosterDefOf('skarn').atk },
        },
        reload: params => { location.href = location.pathname + '?' + new URLSearchParams(params); },
      }).element);
    }
  }

  // The script gives the gate two speakers, so they get two bodies: the pair of
  // militia holding the front of the line. Bound once, by identity — the Second
  // Guard who accuses Seira after the battle has to be the same man who spoke about
  // his daughter before it, kneeling on the tile where he fell.
  const GATE_SPEAKERS = {};
  {
    const front = units.filter(u => u.team === 'enemy' && u.cls === 'archer').sort((a, b) => b.z - a.z);
    GATE_SPEAKERS['Town Guard'] = front[0] || null;
    GATE_SPEAKERS['Second Guard'] = front[1] || front[0] || null;
  }

  // Candidate hour for the intro (Jonah's continuity note: the overlook-to-gate
  // walk is continuous, so the intro should share the battle's overcast-daylight
  // doctrine). ?intro=morning grades the cliffs as cold overcast morning with
  // the town lamps still burning; the default remains the reference dusk until
  // Jonah rules. Designed for the authored sheets, not the painted dusk set.
  const INTRO_MORNING = QUERY.get('intro') === 'morning';
  // Dawn keeps dusk's VALUE structure — dark valley, brightest crest — which is
  // both the composition doctrine and what conceals the diorama's theater-flat
  // construction (Jonah: morning light exposed the basin/cliff material reuse
  // and the basin plane running behind the crest). Only the hue and level move:
  // evening purple becomes cold first light, and continuity reads as dawn on
  // the overlook becoming full day at the gate. Read here (rather than inside
  // cliffs-opening.mjs) because the shared mood table and the cliffs key light
  // need them too; both now live in src/render/scene-mood.mjs, which takes this
  // as its `intro` field.
  const INTRO_DAWN = QUERY.get('intro') === 'dawn';
  // `setAzimuth` — settling the orbit without a glide, the idiom every scene-entry
  // function uses (enterCliffs, enterMine, enterTown) — is the rig's now, along
  // with rotate/rotateTo. cliffs-opening.mjs still takes it as one primitive
  // rather than the four orbit variables it used to be spelled out of.
  // The cliffs overlook — its dusk geometry/materials, its three display
  // actors, and the cliff-exit machinery that walks them off the bottom of
  // frame — lives in `src/scenes/cliffs-opening.mjs`. The mood/visibility switch
  // every scene shares is src/render/scene-mood.mjs. What stays here:
  // sceneFade/enterTown/transitionToMine (generic fade-transition glue),
  // frameConfrontation (the town battle's own push-in), and openingBeats()
  // (interleaves cliffs staging with the gate battle's dialogue, so it belongs
  // to neither scene alone).
  const cliffsOpening = createCliffsOpening({
    THREE, scene, box, mulberry, makeTex, texSnow, spriteFigure, actorSetFrame,
    warmLight, cliffLights, HU, topThick, authoredTerrain,
    cliffsProcedural: QUERY.get('cliffs') === 'procedural',
    tuneEnabled: QUERY.get('tune') === '1',
    warbell: WARBELL, reviewMine: REVIEW_MINE, reviewBattle: REVIEW_BATTLE,
    introMorning: INTRO_MORNING, introDawn: INTRO_DAWN,
    createCliffsTintPanel, sceneName: () => sceneNow(), setWalking,
    center: CENTER, clampCenter, camera, placeCamera, setAzimuth,
    artHeight: ART_H, showScene: k => showScene(k), sceneFade,
  });
  const {
    world: cliffsWorld, grid: cliffsGrid,
    actors: cliffActors, overlookCenter, pushTime: CLIFF_PUSH, closeZoom: CLIFF_CLOSE,
    enterCliffs, departCliffs, stopCliffExit, stepCliffExit,
  } = cliffsOpening;
  const CW = cliffsGrid.width, CD = cliffsGrid.depth;

  // The mine finale is Part I's own story tail; its chamber geometry, seven
  // staged actors, resonance-aura pulse, and arrow/whiteout beat drivers live
  // in one module: `src/scenes/mine-finale.mjs`, mirroring how
  // warning-bell-opening.mjs owns that encounter's cinematics. Entering and
  // settling the climax camera frame stays page state (turn phase/mode, the
  // camera rig, the orbit/glide vars) because it is one exact, unrepeated
  // sequence against primitives the module has no other reason to touch, so
  // the page bundles it behind frameMineClimax and hands over the function.
  function frameMineClimax() {
    flow.phase = 'over'; flow.mode = null;
    cancelCameraMoves();
    marker.visible = false;
    document.body.classList.remove('exploring');
    document.getElementById('exploreHint').classList.remove('show');
    setAzimuth(Math.PI);
    CENTER.set(6, 1.55, 9.8);
    clampCenter();
    camera.zoom = 1.22; camera.updateProjectionMatrix();
    placeCamera();
  }
  const mineFinale = createMineFinale({
    THREE, scene, box, hash, makeTex, spriteFigure, actorSetFrame, setWalking,
    renderer, loadProgress, later, cancelLater, camera, showScene: k => showScene(k),
    frameMineClimax, easeInOut, fastSim: () => FAST_SIM,
    sceneName: () => sceneNow(),
    warbell: WARBELL, reviewMine: REVIEW_MINE,
  });
  const {
    world: mineWorld, lights: mineLights, grid: mineGrid,
    actors: mineActors, partyActors: minePartyActors, spriteActors: mineSpriteActors,
    portraits: minePortraits, artReady: mineArtReady,
    enterMine, startMineEntrance, configureMineBeats, stepMineStory,
  } = mineFinale;
  const MW = mineGrid.width, MD = mineGrid.depth;

  // ---- scene moods. Three worlds share one renderer, one fog and one sun, so a
  // scene change is a grading change rather than a teardown. The gradings, the
  // cliffs' dedicated key light and the visibility/chrome switching are
  // src/render/scene-mood.mjs; the page keeps the worlds and lamp buckets each
  // scene module built, and hands them over named.
  const sceneMood = createSceneMood({
    THREE, scene, renderer, center: CENTER,
    hemi, moon,
    townLights, cliffLights, mineLights, figaroLights,
    figaroSky: figaroDressing ? figaroDressing.sky : null,
    townWorld: world, cliffsWorld, mineWorld,
    bounds: {
      town: { width: W, depth: D },
      cliffs: { width: CW, depth: CD },
      mine: { width: MW, depth: MD },
      // Battle 3 is fought on the battle world, so it pans the same board the
      // town does — a grading of its own, not a world of its own.
      figaro: { width: W, depth: D },
    },
    setBounds: rig.setBounds,
    cancelTimers: () => runtimeTimers.cancelAll(),
    // the tactical chrome belongs to the battle, not to a cutscene
    battleChrome: ['turnstrip', 'actionbar', 'unitpanel'].map(id => document.getElementById(id)),
    intro: INTRO_MORNING ? 'morning' : INTRO_DAWN ? 'dawn' : null,
  });
  const { show: showScene, name: sceneNow } = sceneMood;
  // The cliffs beat is a cutscene, so it borrows the battle's camera machinery and
  // nothing else: the same glide/zoom tweens, the same bubbles, no grid, no turns.
  // overlookCenter/enterCliffs live in cliffs-opening.mjs; see the destructure
  // near CLIFFS SCENE above.
  // The story opens on the crest, so the very first rendered frame is already the
  // cliffs — the entry card lifts onto it rather than cutting to it.
  // The first visible world matches the entry mode: parameterized entries must
  // never flash the cliffs intro behind the title card before their own scene
  // arrives (Jonah's note) — the splash is translucent for a beat as it lifts.
  // A battle whose descriptor names its own grading opens on it directly. That
  // is also the guard that keeps battle 3 out of the cliffs: falling through to
  // enterCliffs() would stage Narshe's overlook cinematic in front of a castle
  // in a desert, which is the one thing this entry must never do.
  if (BATTLE_DEF.scene === 'figaro') showScene('figaro');
  else if (BATTLE_DEF.scene === 'town' || REVIEW_BATTLE) showScene('town');
  else if (REVIEW_MINE) showScene('mine');
  else enterCliffs();
  // The card names the place being entered: the gallery battle is in the mines.
  // The battle names its own card, and a flow controller may override it: an
  // act break between two chained battles may want to name the ACT rather than
  // the encounter. `context.card` is the whole of that interface (see the entry
  // card section near the bottom of this file).
  document.querySelector('#splash span').textContent =
    (context.card && context.card.title) || BATTLE_DEF.title;


  // Exploration's own reachability (every other figure is scenery to walk
  // around, no turn budget) lives in src/modes/exploration.mjs alongside the
  // rest of that mode's movement rules.
  // The ranged rules this batch adds are HANDED TO `core/battle-grid.mjs` rather
  // than kept here as a second `attackTargets`: main extracted the battlefield
  // predicates into that module while this branch was open, and two definitions
  // of "what can this unit hit" is how a rule ends up enforced in the UI and not
  // in the AI. The module's defaults are main's behaviour exactly (square metric,
  // no minimum, nothing blocks), so injecting these three is the whole of the
  // batch's reach story.
  // The near edge of a ranged unit's envelope. 1 means "no minimum" — an adjacent
  // shot is legal and `ADJ_PENALTY` is what makes it a bad idea. Melee is never
  // subject to it: its range IS 1. Bows only, per the ruling above; keying this
  // on `u.range > 1` instead is what refused Seira her point-blank bolt.
  function minShotRange(u) {
    return u.cls === 'archer' && u.range > 1 && RULES.get('archerMinRange')
      ? MIN_SHOT_RANGE : 1;
  }
  // What stops an arrow: a solid prop or a body.
  //
  // Scenery was missing from this predicate until the pre-merge review found it
  // (B1), and the omission was visible in play: an archer could shoot straight
  // through the bunkhouse, arrows came back through the same wall, and the danger
  // shading marked tiles behind solid cover as threatened. Cover read as useless
  // in both directions, in the shipped default configuration. Everything the map
  // refuses to let a unit WALK through — the ravine's rock walls (`ROCK`) and
  // every registered building footprint (`BLOCKED`) — now also refuses to let an
  // arrow through, which is the rule a player already expects from looking at it.
  // Off-board counts as solid so a lane can never leave the map and come back.
  //
  // `mover` is the unit whose body should NOT count, and it exists for the
  // hypothetical questions (B3): when the AI or the danger shading asks "could
  // this archer shoot from over there", the archer is still standing on its
  // current tile, and testing the lane with its own body in it reported every
  // stance straight back along the line as blocked. Moving there vacates the
  // tile, so excluding it is strictly correct; every OTHER unit stays worst-cased
  // as static, which keeps the shading's promise to over-warn rather than under.
  function laneSolid(x, z, mover) {
    if (!inBounds(x, z)) return true;
    if (T[z][x] === ROCK || BLOCKED[z][x]) return true;
    const body = unitAt(x, z);
    return !!body && body !== mover;
  }
  // Does anything stand in this arrow's way (rules.arrowLos)?
  //
  // BOWS ONLY in v1: the alchemist's flask is lobbed and Seira's bolt is magic,
  // so neither is screened. `cls === 'archer'` is the bow test, which covers
  // Brecht and the militia archers alike — the rule cuts both ways, and a
  // front-liner standing in front of a friendly mage screens her from arrows
  // exactly as an enemy body screens its own line.
  //
  // Height is ignored, deliberately (see core/line-of-sight.mjs): shooting down
  // a terrace over a friend's head is the case a height-aware lane would allow,
  // and modelling it properly is a bigger design than this rule.
  function shotBlocked(att, tgt) {
    return shotBlockedFrom(att, tgt, null);
  }
  // The same question asked about a tile the shooter has not moved to yet.
  function shotBlockedFrom(att, tgt, mover) {
    if (!RULES.get('arrowLos') || att.cls !== 'archer') return false;
    return laneBlocked(att, tgt, (x, z) => laneSolid(x, z, mover));
  }
  // Could this unit shoot ANYTHING from a hypothetical tile? The AI asks so it
  // can reposition for a clear lane rather than stand and waste the turn.
  function couldShootFrom(u, tile, foes) {
    if (u.range <= 1) return false;
    const from = { x: tile.x, z: tile.z, cls: u.cls, range: u.range, team: u.team };
    const near = minShotRange(u), far = shotRange(u);
    return foes.some(f => {
      const d = rangeDist(from, f);
      // `u` itself is excluded from the lane: it is asking where to GO, and it
      // cannot be standing in its own way once it gets there
      return d >= near && d <= far && !shotBlockedFrom(from, f, u);
    });
  }
  // The battlefield an ability's targeting rules are asked about. The registry
  // owns the rules; this names the map they run on.
  const abilityField = {
    units, distance: rangeDist, width: W, depth: D,
    // a burst keeps its square footprint whatever the weapon-range metric is
    burstDistance: cheb,
    castable: (x, z) => T[z][x] !== ROCK,
    // where a body could be, which is what a POINTED ability's range envelope
    // is drawn over: a burst may cover a tile nobody could stand on, but there
    // is no point telling the player they may aim a heal at a wall
    standable: (x, z) => walkable(x, z),
  };
  // tiles/units an ability may be pointed at
  function abilTargets(u, key) { return abilities.targets(u, key, abilityField); }
  // the same reach as TILES, for the highlight only — see registry.footprint
  function abilFootprint(u, key) { return abilities.footprint(u, key, abilityField); }
  function canCast(u, key) { return abilities.canCast(u, key, abilityField); }

  // ---------------------------------------------------------------- tile highlights
  // The bordered move/attack/cast/heal tint quads and the two keyboard cursors
  // (move destination, attack target) are src/ui/tile-chrome.mjs. `hideForecast`
  // and `resetHover` are forward references: the forecast panel and the raw
  // `lastHover` tracker are both declared further down the page, same shape as
  // `ability: key => abilities.get(key)` elsewhere here — neither is called
  // until well after both exist.
  // The hover arcs are built ABOVE the tile chrome that puts them away, rather
  // than below it beside the rest of the targeting UI. `clearHighlights` is the
  // one call that has to retire them, and reaching a `const` declared further
  // down would be a TDZ waiting for the first caller that runs during init
  // (AGENT_BRIEF trap 1). Constructing it first costs nothing: it needs only
  // tileCenter and the chrome helpers, all of which exist by here.
  const threatArcs = createThreatArcs({
    THREE, world, uiChrome, uiCol,
    tileAnchor: (x, z) => tileCenter(x, z),
  });
  const tileChrome = createTileChrome({
    THREE, world, tileTop, uiCss, uiCol, makeTex, uiChrome,
    hideForecast: () => forecast.hide(),
    resetHover: () => { lastHover = null; threatArcs.clear(); },
  });
  const {
    showHighlights, clearHighlights: clearTileHighlights, setMoveCursor, clearMoveCursor,
    setAttackCursor, clearAttackCursor, showIdleReach, clearIdleReach,
    hlActive, moveTarget, attackCursorUnit, hlMat, hlGeo, hlMaterial,
  } = tileChrome;
  // The pin contract (the Move-branch comment below) promises that
  // clearHighlights retires pinned threat arcs on mode change, commit and
  // undo. tile-chrome cannot know about the arcs, so the page-level binding
  // keeps that promise — without this, a pinned arc survived into attack
  // mode and hung over the target (found by the art-hooks z-order probe,
  // 2026-08-06, as a stray arc across the staged figure).
  const clearHighlights = () => { clearTileHighlights(); threatArcs.clear(); };

  // ---------------------------------------------------------------- tactical view toggle
  // Shows every square a unit could ever occupy (checkerboard cyan); everything
  // unmarked is scenery. Makes long-range routing readable.
  const tacGroup = new THREE.Group();
  {
    const tacA = hlMaterial(uiCss(0x78c8ff, 0.14), uiCss(0xaae1ff, 0.55));
    const tacB = hlMaterial(uiCss(0x78c8ff, 0.26), uiCss(0xaae1ff, 0.55));
    tacA.opacity = tacB.opacity = 0.85;
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      if (!walkable(x, z)) continue;
      const m = new THREE.Mesh(hlGeo, (x + z) % 2 ? tacA : tacB);
      m.position.set(x + 0.5, tileTop[z][x] + 0.008, z + 0.5);
      m.renderOrder = 4;
      m.raycast = () => {};                       // display only, never intercepts picking
      tacGroup.add(m);
    }
    tacGroup.visible = false;
    world.add(tacGroup);
  }
  const tacBtn = document.getElementById('tacBtn');
  function toggleTac() {
    tacGroup.visible = !tacGroup.visible;
    tacBtn.style.background = tacGroup.visible ? 'rgba(64,110,170,0.9)' : '';
  }
  tacBtn.addEventListener('click', toggleTac);

  // ACTIVE UNIT: the caret alone, over the head.
  //
  // It used to be a pulsing ring at the feet plus this caret. The ring was the
  // last thing any UNIT put on the floor, and leaving it there after the team
  // markers went would have made "a mark under a figure" mean one rare thing
  // instead of nothing — the FFT scheme's whole point is that the ground
  // belongs to the tile layers (Jonah, 2026-08-05; this piece is his to confirm
  // by eye, and the report has the screenshot). The caret was always the part
  // that survived a building in the way: it draws through geometry, which the
  // ring never did.
  const marker = new THREE.Group();
  const markerCaret = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.26, 4),
    new THREE.MeshBasicMaterial({ color: uiCol(0xeaf6ff), transparent: true, opacity: 0.92, depthTest: false, depthWrite: false }));
  markerCaret.rotation.x = Math.PI; markerCaret.position.y = 2.1; markerCaret.renderOrder = 940;
  marker.add(markerCaret);
  marker.visible = false;
  uiChrome(marker);
  world.add(marker);

  // Righteous Anger: a hanging blade-chevron over the marked enemy
  const markMesh = new THREE.Group();
  {
    const m = new THREE.MeshStandardMaterial({ color: 0xffd0a0, emissive: 0xff5a24, emissiveIntensity: 2.0 });
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 4), m);
    spike.rotation.x = Math.PI;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.02, 5, 14), m);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.22;
    markMesh.add(spike, ring);
    markMesh.traverse(o => { if (o.isMesh) { o.renderOrder = 930; o.raycast = () => {}; } });
    uiChrome(markMesh);
    markMesh.visible = false;
    world.add(markMesh);
  }

  // One raycaster for every hit test the page makes: the facing chevrons (now
  // src/ui/facing-picker.mjs) and the tile/unit picking src/ui/battle-input.mjs
  // does with it — both take this shared pair as injected context.
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // ---------------------------------------------------------------- UI wiring
  // The presenter's mutable spine — queue/qi/round, phase, mode/curAbil, uiTurn —
  // lives in src/flow/turn-state.mjs, because the turn machine, the event seam,
  // the HUD and the input layer all read and write it and none of them owns it.
  // It is constructed here, above the first consumer, rather than beside the turn
  // machine that used to declare it.
  const flow = createTurnState();
  // The page keeps the element handles, as it does for the dialogue engine; the
  // turn strip, unit panel, action bar and keyboard action cursor are one HUD in
  // src/ui/battle-hud.mjs, a pure projection of `flow` onto them.
  const elChips = document.getElementById('chips');
  const elBar = document.getElementById('actionbar');
  const elPips = document.querySelector('#tp .pips');
  const elAbils = document.getElementById('abils');
  const elPanelUp = document.getElementById('unitpanel');
  const btnUndo = document.getElementById('btnUndo');
  const elAbilTip = document.getElementById('abilTip');
  const elCostSep = document.getElementById('costSep');
  const btn = {
    move: document.getElementById('btnMove'), attack: document.getElementById('btnAttack'),
    defend: document.getElementById('btnDefend'), wait: document.getElementById('btnWait'),
  };
  const hud = createBattleHud({
    document, flow, tpCap: TP_CAP,
    elChips, elBar, elPips, elAbils, elPanelUp, btnUndo, btn, elAbilTip, elCostSep,
    faceOf, attackTargets, canCast,
    defendCost: () => RULES.get('defendCostsTp') ? DEFEND_TP : 0,
    canDefend: u => canDefend(u),
    chooseAbil: key => chooseAbil(key),   // the input layer is built below the HUD
    // the ability registry and the dialogue engine are both built further down
    // the page, so the HUD reaches them by call rather than by capture
    ability: key => abilities.get(key),
    dialogueUp: () => dialogueUp(),
  });
  const {
    renderStrip: renderTurnPanel, banner, updateUnitPanel, refreshButtons,
    commandKey, availableCommands,
    syncActionCursor, moveActionCursor, executeActionCursor,
  } = hud;
  /**
   * THE NUMERAL BESIDE A UNIT'S BAR: its place in the turn order.
   *
   * `flow.queue` is the round's acting order and the TURN ORDER panel is that
   * same list drawn top to bottom, so this is literally the unit's row in the
   * panel — the two readings agree because they are one reading, and a player
   * can check either against the other by eye. A unit not in the queue (fielded
   * mid-round, or already gone from it) carries no numeral.
   *
   * THE BOUND VALUE IS THIS ONE FUNCTION. Jonah has not ruled between
   * turn-order position, hit points and a stable unit index; the drawing code
   * knows nothing about which it is, so switching is a one-line rebind here and
   * nothing in the sprite, the layout or the palette moves.
   */
  function turnNumeralOf(u) {
    // A NUMERAL IS A CLAIM ABOUT A QUEUE THAT IS RUNNING, so it waits for the
    // real battle even where the BARS do not (the bell's scripted opening deals
    // real damage before round 1 — see `scriptedCombat` below). Numbering the
    // field during a cinematic would assert a turn order nobody is taking.
    if (!flow.started) return null;
    const i = flow.queue.indexOf(u);
    return i < 0 ? null : i + 1;
  }
  /**
   * The bell's scripted opening is a FIGHT before it is a turn (Jonah,
   * 2026-08-05): Seira steps out, Cries, is answered by both bonded enemies and
   * left near death, and the Heal answers a number the player must have watched
   * fall. So the bars come up at that beat — `warning-bell-opening.mjs` calls
   * this from `warbellScriptedCry`, the moment she begins her advance — while
   * the numerals wait for round 1 with everything else.
   *
   * Battle 1 never calls it: its opening has no scripted combat, so its bars
   * arrive with the first turn exactly as the ruling says.
   */
  let scriptedCombat = false;
  function beginScriptedCombat() {
    if (scriptedCombat) return;
    scriptedCombat = true;
    renderStrip();
  }
  /** Is there combat on the field for a bar to describe? */
  function combatOnField() { return flow.started || scriptedCombat; }
  // The panel, the numerals and the bars they sit beside are ONE projection of
  // the turn state, refreshed in one call, so they cannot drift apart: every
  // module that had `renderStrip` injected gets this, not the HUD's own.
  //
  // A BAR EXISTS ONLY WHILE THERE IS A FIGHT TO DESCRIBE (Jonah, 2026-08-05).
  // `flow.started` is the shared latch (turn-state) that the action bar reads
  // too, so the opening dialogue, the cliffs, the gallery's entrance and the act
  // card between the encounters all play over a field with no combat chrome on
  // it — and `scriptedCombat` is the bell's one refinement, where damage is
  // dealt before any turn exists. `alive` covers the other end: the dead and the
  // downed dropped their bars when they fell, and re-showing one here would
  // raise it again.
  function renderStrip() {
    renderTurnPanel();
    for (const u of units) {
      u.bar.visible = combatOnField() && u.alive;
      u.bar.userData.setOrder(turnNumeralOf(u));
    }
  }

  // The end-of-turn facing beat is src/ui/facing-picker.mjs: four gold chevrons,
  // one click or arrow key to choose which way a unit ends up looking. It needs
  // `refreshButtons` (from the HUD just above) and `flow`, so it is constructed
  // here rather than beside the tile-highlight chrome above it.
  const facingPicker = createFacingPicker({
    THREE, world, tileTop, W, D, camera, canvas: renderer.domElement, flow,
    raycaster, ndc,
    viewport: () => ({ width: innerWidth, height: innerHeight }),
    makeTex, uiCss,
    azimuth: azimuthNow, battleStartAzimuth: BATTLE_START_AZIMUTH,
    refreshButtons,
  });
  const {
    showFacingPicker: showFacingPickerRaw, hideFacingArrows: hideFacingArrowsRaw,
    closeFacingPicker, pickFacingArrow, facingKeyDir,
  } = facingPicker;
  // Jonah reversed the picker-hides-the-bar call (2026-08-06): the bar stays
  // up during the post-act pick with Undo as its one live button — see
  // battle-hud.mjs. The bar's own refresh runs on the picker transitions, so
  // the raw picker functions are used directly.
  const showFacingPicker = (u, done) => {
    const r = showFacingPickerRaw(u, (...a) => { refreshButtons(); return done(...a); });
    refreshButtons();     // the picker just set phase='facing'; show the bar's Undo state for it
    return r;
  };
  const hideFacingArrows = hideFacingArrowsRaw;

  // ---------------------------------------------------------------- actions
  // The turn sequencer itself is src/flow/turn-machine.mjs, constructed below the
  // event seam it drives; `flow` (the mutable spine) is above, with the HUD that
  // projects it.
  function faceToward(u, x, z) {
    const dx = (x + 0.5) - u.group.position.x, dz = (z + 0.5) - u.group.position.z;
    if (dx || dz) u.group.rotation.y = Math.atan2(dx, dz);
  }
  /**
   * Turn the acting unit to face its nearest enemy — the same rotation the
   * end-of-turn facing picker produces, reachable by an instrument.
   *
   * This exists because of a measurement blind spot, not a game need. A human
   * gets the facing beat at the end of EVERY turn; anything driven through
   * `__BATTLE` skips it by design, so the bots have always ended their turns
   * pointing wherever their last move happened to leave them. With
   * rules.rearAttack pricing a rear hit at ×1.5, that is a systematic one-sided
   * handicap on every measurement taken so far, and there was no way to test it
   * without a legal way for a bot to do what a player does. It performs no
   * action, spends nothing, and cannot be reached during an enemy turn.
   */
  function faceAtNearestFoe(u) {
    if (!u || !u.alive) return null;
    const foes = living(u.team === 'player' ? 'enemy' : 'player');
    if (!foes.length) return null;
    let best = null, bd = Infinity;
    for (const f of foes) {
      const d = rangeDist(u, f);
      if (d < bd) { bd = d; best = f; }
    }
    if (!best) return null;
    faceToward(u, best.x, best.z);
    return { x: best.x, z: best.z, name: best.name };
  }

  // Reactive mechanics are declared by the battle (src/content/battles/), not
  // branched on inside the seam. The registry answers "what does this event
  // provoke, and is it currently held"; the animated, battle-specific runners it
  // deliberately knows nothing about live with the seam in flow/battle-events.mjs.
  const reactions = createReactionRegistry(BATTLE_DEF.reactions || []);
  // The one parchment bubble form — story dialogue's placement and the inert
  // battle barks that share it — belongs to `ui/speech-bubbles.mjs`. The page
  // keeps only what is genuinely its own: which camera the placement projects
  // against, and which element the barks live in.
  const bubbles = createSpeechBubbles({
    THREE, camera, document,
    layer: document.getElementById('bark'),
    viewport: () => ({ width: innerWidth, height: innerHeight }),
    now: () => performance.now(),
  });
  const { place: placeBubblePanel, bark, update: updateBarks } = bubbles;
  // The one seam where presentation reacts to the domain — every damage, heal,
  // status, form switch and defeat funnels through `present()` — plus the views
  // and reaction runners downstream of it, in src/flow/battle-events.mjs. Nothing
  // is passed implicitly: the seam gets the view primitives it is allowed to use,
  // named, and the turn machine it is mutually recursive with arrives as two calls.
  const battleEvents = createBattleEvents({
    THREE, scene, world,
    units, flow, reactions,
    floatText, tileCenter, tween, later, uiCol, hash, cheb, faceToward,
    setWalking, setSpritePose, applyFormArt, markMesh, bark,
    banner, renderStrip, refreshButtons, unitById,
    checkEnd: () => checkEnd(), endTurn: () => endTurn(),
    revengeDamage,
    berserkMultiplier,
    soloRevenge,
  });
  const {
    present: presentBattleEvents, applyDamage, setMark, clearMark, fireReaction, eventLog,
  } = battleEvents;
  // The turn sequencer: rounds, the acting order, both ways a turn ends, and the
  // end-of-battle check. It owns no state — the queue and the phase live on the
  // spine above — but it is the only module that drives them forward. Which
  // rosters win or lose belongs to the descriptor; which end card plays belongs
  // to this page, so both endings arrive as callbacks.
  const turnMachine = createTurnMachine({
    flow, units, reactions,
    tpGain: TP_GAIN, tpCap: TP_CAP, poisonDamage: u => poisonDamage(u),
    aiBeat: () => AI_BEAT,                   // fast() shrinks it for headless sims
    marker, tileTop, centerOn, clearHighlights, later,
    hideFacingArrows, showFacingPicker,
    cheb, faceToward, living,
    banner, renderStrip, refreshButtons,
    present: presentBattleEvents, clearMark,
    outcomeOptions,
    onVictory: () => battleVictory(),
    onDefeat: () => finish('DEFEAT', true),
    music, cueBattleMusic,
    cancelTimers: () => runtimeTimers.cancelAll(),
    aiTurn: u => aiTurn(u),                  // built below; it is handed endTurn
  });
  const {
    newRound, nextTurn, beginTurn, endTurn, finishTurn,
    spend, completeAction, beginActionAnimation,
    checkEnd, haltBattlePresentation,
  } = turnMachine;

  // ------------------------------------------------- unit actions & forecast
  // What a unit does on its turn, and what the forecast says it will do, are one
  // module: `attack` and `attackRange` build the same combat profile, and
  // `revengeRange` mirrors the reprisal rules in the seam above. Live knobs
  // arrive as accessors so the tooltip, the forecast and the cast can never
  // disagree about a number the tuning panel just moved.
  const unitActions = createUnitActions({
    THREE, scene, units, flow,
    tileCenter, tileTop, tween, later, floatText, faceToward, distance: rangeDist, marker,
    setWalking, walkFrames, clearHighlights, refreshButtons,
    heightMod, aimMultiplier: AIM_MULT,
    // Live rule flags decide both, so they arrive as accessors for the same
    // reason stepTime and randomSource do: a flag flipped mid-battle has to reach
    // the next attack, not the next reload. With the hard minimum in force there
    // is no adjacent shot left to penalise, so the 40% becomes a no-op rather
    // than a second rule stacked on top of the first.
    adjacencyPenalty: () => RULES.get('archerMinRange') ? 1 : ADJ_PENALTY,
    rearMultiplier: () => RULES.get('rearAttack') ? REAR_MULT : 1,
    // A militiaman FIRING from a formed rank hits harder. Militia only, and
    // shooters only: this is a volley, so a melee swing gets nothing from the
    // bodies beside it. Gating on team alone handed Ragna and Skarn a ×1.25
    // "volley" bonus for standing next to each other in a battle with no bows in
    // it — reachable today only through `?rules=all`, since the flag ships off in
    // both descriptors, but a fiction-breaking bonus behind a flag is still one
    // rule flip from being real. The answer to a rank is to break it in one
    // action, which is what Mournful Cry is for.
    supportMultiplier: att => {
      if (!RULES.get('massedVolley') || att.team !== 'enemy' || att.range <= 1) return 1;
      const rank = units.filter(v => v.alive && v.team === att.team && v.id !== att.id
        && Math.max(Math.abs(v.x - att.x), Math.abs(v.z - att.z)) === 1).length;
      return Math.min(VOLLEY_CAP, 1 + VOLLEY_PER_ALLY * rank);
    },
    stepTime: () => STEP_TIME,               // pace() retimes the walk mid-run
    walkAnim: () => BATTLE_WALK_ANIM,        // setBattleWalk() reverts to the hop
    randomSource: () => combatRand,          // seed() swaps the generator
    defendCost: () => RULES.get('defendCostsTp') ? DEFEND_TP : 0,
    beginActionAnimation, completeAction,
    present: presentBattleEvents, applyDamage, clearMark,
    hideFacingArrows,
    characterForm,
    ability: key => abilities.get(key),      // the registry is built from these
    warbell: WARBELL,
    revengeDamage,
    berserkMultiplier,
    soloRevenge,
  });
  const {
    moveUnit, undoMove, attack, projectile, defendAction, canDefend,
    setPoison, setAimed, castAbility, switchUnitForm,
    attackRange: fcRange, revengeRange: forecastRevenge,
  } = unitActions;
  btnUndo.addEventListener('click', undoMove);
  // The kit, and the one door every consumer reaches it through. The definitions
  // live in content; this names the page primitives a cast is allowed to use, the
  // same explicit context the warning-bell staging module takes. Live knobs come
  // in as accessors so the tooltip, the forecast and the cast can never disagree
  // about a number the tuning panel just moved.
  const abilities = createAbilityRegistry(createBattleAbilities({
    THREE, world, units, distance: rangeDist, burstDistance: cheb, tileCenter,
    floatText, faceToward, projectile, tween, later,
    beginAnimation: beginActionAnimation,
    present: presentBattleEvents,
    spend, completeAction, applyDamage,
    setMark, setPoison, setAimed, heightMod,
    attackForecast: fcRange,                 // the mark previews a marked follow-up
    randomSource: () => combatRand,          // seed() swaps the generator
    healAmount,              // live-tunable
    cry: { damage: CRY_DMG, selfCost: CRY_SELF, radius: CRY_RADIUS },
    poisonTurns: () => poisonTurns(),
    flaskRange: numKnob('flask', 4),
  }));
  // Kept under its old name for `window.__BATTLE`: the same metadata, now owned
  // by the definitions rather than copied beside them.
  const ABIL = abilities.byId;
  // The scripted opening stages the real Mournful Cry, and the archer AI the real
  // Take Aim; both are the definition's cast, reached by name.
  const castCry = (u, done) => castAbility(u, 'cry', null, done);
  const takeAim = u => castAbility(u, 'aim');

  // ---------------------------------------------------------------- danger zones
  // Move mode shades reachable tiles by whether the enemy could hit them, and
  // hovering a shaded one draws an arc from each enemy that could. The model is
  // core/threat.mjs; what lives here is the page's own knowledge — who is alive,
  // where they can walk, how far their weapon and their kit reach on this map.
  //
  // GEOMETRIC threat, per Jonah's ruling: worst case, not what the AI will
  // actually choose. Two consequences worth stating out loud, because both look
  // like bugs until you know the rule:
  //
  //  - the militia's hold-your-terrace discipline is NOT modelled, so tiles well
  //    down the ravine shade purple even though no archer will ever walk there.
  //    That is the ruling working: the shading promises "they could", which is
  //    the only promise it can keep, and it can only ever over-warn.
  //  - warning-bell reprisals are deliberately absent. They are range-free by
  //    design — striking a bonded enemy is answered wherever you stand — so
  //    there is no geometry to shade, and stating them is the forecast panel's
  //    job (`revengeRange`), which already does it per strike.
  let dangerNow = null;             // tile key -> ids that can reach it, per Move entry

  function threatPlanFor(u) {
    const ranged = u.range > 1;
    // Every tile it could act from: its reachable set, plus where it already
    // stands — the stance of a unit that chooses not to move at all, which the
    // BFS result deliberately omits.
    const stances = [{ x: u.x, z: u.z }, ...reachable(u).tiles];
    let maxRange = ranged ? shotRange(u) : 0;
    // Abilities reach too, and the flask is what actually catches a careless
    // player. Any enemy-pointed ability counts, whether or not the unit can pay
    // for it right now: TP is worst-cased along with everything else, so a
    // penniless alchemist still projects its throw. Over-warning costs a cautious
    // move; under-warning costs a unit.
    for (const key of u.abil) {
      const def = abilities.get(key);
      if (!def || def.aim !== 'enemy') continue;
      // The reach it will have on its NEXT turn, escalation included — the same
      // number aiAlchemist plans with, from the same function.
      maxRange = Math.max(maxRange, escalatedAbilityRange(def, {
        round: flow.round + 1, escalateStart: escalationStart(),
      }));
    }
    return {
      id: u.id,
      bow: u.cls === 'archer',
      stances,
      // Melee swings along the four cardinals; the climb limit is checked per
      // swing by `stepAllowed` below, exactly as `attackTargets` checks it.
      melee: ranged ? null : DIRS,
      // A bow's envelope may have a hole in the middle (rules.archerMinRange).
      // An ability that reaches further keeps the same near edge here: the only
      // enemy ability in play is the flask, whose own declared ai.minDistance is
      // 2 — the same number — so nothing is lost by not modelling them apart.
      minRange: ranged ? minShotRange(u) : 1,
      maxRange,
    };
  }
  function refreshDanger() {
    dangerNow = threatenedTiles(living('enemy').map(threatPlanFor), {
      width: W, depth: D,
      // A tile the player cannot stand on is not a tile to warn them about.
      tileAllowed: walkable,
      stepAllowed: (x, z, nx, nz) => inBounds(nx, nz) && Math.abs(H[nz][nx] - H[z][x]) <= 2,
      metric: (ax, az, bx, bz) => rangeDist({ x: ax, z: az }, { x: bx, z: bz }),
      // A lane a body or a building already blocks is not a threat, and the
      // shading has to agree with the legality check or it goes back to lying.
      // The stance being projected is one the shooter would MOVE to, so its own
      // body is excluded (B3): with it left in, every stance straight back along
      // the line reported blocked, and the retreat-then-shoot play the notes warn
      // about ("adjacency is NOT safe") was shaded safe on eleven real
      // configurations of this map.
      laneClear: (plan, sx, sz, tx, tz) => !plan.bow
        || !shotBlockedFrom({ x: sx, z: sz, cls: 'archer' }, { x: tx, z: tz },
          unitById(plan.id)),
    });
  }
  function threatUnitsAt(x, z) {
    if (!dangerNow) return [];
    return threatsAt(dangerNow, x, z, W).map(unitById).filter(v => v && v.alive);
  }
  /**
   * The tiles a Move highlight should light, each tagged with whether an enemy
   * could reach it. One tagged set rather than two overlapping ones: two would
   * z-fight on every threatened square.
   */
  function moveTiles(u) {
    // The square the unit is STANDING on is part of the answer (Jonah,
    // 2026-08-06): staying put is a move-mode option like any other, and its
    // shading tells the player whether where they already are is safe.
    // Clicking it is harmless — the commit path refuses a zero-length move.
    const tiles = [{ x: u.x, z: u.z, d: 0 }, ...reachable(u).tiles];
    if (!RULES.get('dangerTiles')) { dangerNow = null; return tiles; }
    refreshDanger();
    return tiles.map(t => threatsAt(dangerNow, t.x, t.z, W).length ? { ...t, kind: 'danger' } : t);
  }
  // The shading as TILES rather than as pixels, so a gate can assert what the
  // model decided without reading a colour off a screenshot. `dangerNow` is a
  // page `let` the next Move entry replaces, so this is a function, not a value.
  function dangerReport() {
    const on = RULES.get('dangerTiles');
    if (!dangerNow) return { on, computed: false, tiles: [] };
    const tiles = [];
    for (const [key, ids] of dangerNow) {
      const x = key % W;
      tiles.push({
        x, z: (key - x) / W,
        by: ids.map(id => (unitById(id) || { name: id }).name),
      });
    }
    return { on, computed: true, tiles };
  }


  // ---------------------------------------------------------------- placeholder portraits
  // kept for callers that only know a class + accent colour (dialogue fallback)
  function placeholderFace(cls, accentHex, team) {
    const palKey = Object.keys(PALETTE).find(k => PALETTE[k].accent === accentHex)
      || (team === 'player' ? 'cassien' : 'miner');
    return spriteBust(cls, palKey, team);
  }
  function faceOf(u) {
    return portraitOf(u.name) || (u.art && artBust(artSetKey(u), u.team))
      || spriteBust(u.kind, u.pal, u.team);
  }

  // ---------------------------------------------------------------- combat forecast
  // FFT-style: attacker card, damage plate, target card(s). The two rules it
  // previews are `unitActions`' own, beside the execution they mirror; the panel
  // is handed those, the element, the portraits and the ability registry, and
  // owns every pixel of the result.
  const forecast = createForecastPanel({
    element: document.getElementById('forecast'),
    abilities,
    faceOf,
    attackRange: fcRange,
    revengeRange: forecastRevenge,
  });

  // hover: forecast follows the cursor through attack/ability targeting
  let lastHover = null;
  renderer.domElement.addEventListener('pointermove', ev => {
    if (facingPicker.isActive()) {          // the facing beat lights its own chevron instead
      facingPicker.hoverAt(ev);
      return;
    }
    if (panning()) return;
    // a burst previews its own footprint from the moment it is chosen, so there
    // is nothing for the cursor to point at
    const hovered = flow.mode === 'abil' ? abilities.get(flow.curAbil) : null;
    if (flow.phase !== 'player' || !flow.mode || (hovered && hovered.aim === 'burst')) return;
    const u = flow.current();
    if (!u) return;
    // Move mode gives the legal-square plane first refusal, the same as a click
    // does: a tall foreground sprite must not swallow the square being hovered.
    const t = pick(ev, flow.mode === 'move');
    const key = t ? t.x + ',' + t.z + flow.mode + (flow.curAbil || '') : null;
    if (key === lastHover) return;
    lastHover = key;
    const tgt = t && unitAt(t.x, t.z);
    // THE ORANGE SQUARE IS THE TENTATIVE SELECTION, and it follows the pointer
    // (Jonah, 2026-08-05: in attack mode one enemy took the mark arbitrarily and
    // kept it while the mouse moved over the others). It marks what the next
    // confirm would strike — the hovered target for the mouse, the cursor's
    // target for the keyboard, which are the SAME cursor and so can never
    // disagree. The forecast is shown from the same target for the same reason:
    // the panel and the square are two readings of one choice.
    if (flow.mode === 'attack' && tgt && attackTargets(u).includes(tgt)) {
      setAttackCursor(tgt);
      forecast.show('attack', u, tgt);
    }
    else if (flow.mode === 'abil' && tgt && abilTargets(u, flow.curAbil).some(q => q.x === t.x && q.z === t.z)) {
      setAttackCursor(tgt);
      forecast.show(flow.curAbil, u, tgt);
    }
    else if (flow.mode === 'move') {
      // Move mode shows no forecast — there is no strike to preview — but a
      // shaded square answers "by whom" with an arc from each enemy that could
      // reach it. Only the SHADED squares do: the threat map covers the whole
      // board, and drawing arcs off a tile this unit cannot move to would answer
      // a question the player is not asking. `dangerNow` is null when the rule is
      // off, so this costs one property read and nothing else.
      //
      // HOVERING NOTHING IS NOT A SELECTION (Jonah, 2026-08-05): a destination
      // the player just SELECTED — by keyboard cursor (battle-input.mjs's
      // `pinThreatArcs`) or by resting the pointer on it right here — has to
      // survive the mouse drifting off the board or over an illegal square
      // while the player deliberates, not vanish the instant the cursor
      // leaves the lit tile. Only landing on ANOTHER legal square counts as
      // changing the selection; nothing under the pointer leaves whatever is
      // pinned alone, for `clearHighlights` (mode change, commit, undo) to
      // retire on its own.
      if (!t) return;
      // The arcs belong to rules.dangerTiles — with the rule off they must
      // never draw, or ?rules=none leaks the feature (caught by the art-hooks
      // z-order probe staging with the rule disabled).
      const lit = hlActive().some(m => m.userData.tile.x === t.x && m.userData.tile.z === t.z);
      if (!lit) return;
      // ONE cursor for both hands (Jonah, 2026-08-06): the mouse hovering a
      // legal destination drives the same move cursor the arrow keys drive —
      // before this, only the keyboard moved it, so the yellow boundary could
      // sit on a stale square while the mouse picked another.
      setMoveCursor(t.x, t.z);
      if (!RULES.get('dangerTiles')) return;
      threatArcs.show(threatUnitsAt(t.x, t.z), t);
      return;
    }
    else {
      // Hovering nothing aimable. ATTACK KEEPS ITS CURSOR: Enter still commits
      // that target, so taking the mark away would leave the keyboard about to
      // strike an enemy nothing on screen names — and the forecast is re-shown
      // FROM THE CURSOR rather than hidden, so the panel and the orange square
      // still agree. An ability has no keyboard flow to preserve, so its mark
      // simply goes with the hover that made it.
      const held = flow.mode === 'attack' ? attackCursorUnit() : null;
      if (flow.mode === 'abil') clearAttackCursor();
      if (held && held.alive) forecast.show('attack', u, held);
      else forecast.hide();
    }
  }, { signal });
  // The cursor leaving the canvas is not a pointermove. It USED TO clear the
  // arcs here so the last hovered square did not keep them while the mouse
  // sat on the action bar — but a destination the player has SELECTED (by
  // keyboard, or by resting the pointer on it) has to survive the mouse
  // leaving the canvas the same way it survives the mouse crossing empty
  // ground (the pointermove handler above, Move branch): reading the
  // forecast, reaching for the action bar or just resting the hand is not
  // "the selection changed" (Jonah, 2026-08-05). `lastHover` alone still
  // resets, so the next real hover is not mistaken for a repeat of the last
  // one seen before the mouse left.
  renderer.domElement.addEventListener('pointerleave', () => {
    lastHover = null;
  }, { signal });

  // ---------------------------------------------------------------- the script
  // story/opening-scene.md is authoritative: the game parses it at runtime, so a
  // rewrite of the script is a rewrite of the game with no code change. The
  // parser and its FALLBACK_SCENES stand-in live in src/story/script-parser.mjs
  // as a pure text -> beats transform; this is the page's loader glue around
  // it — fetching the file, deciding whether a parse failure falls back, and
  // threading loadProgress. If the file is missing or yields no gate dialogue,
  // the fallback stands in and the game plays exactly as it did before the
  // script was wired up.
  const SCRIPT_URL = 'story/opening-scene.md';
  let SCENES = FALLBACK_SCENES;
  const storyStatus = { source: 'fallback', directives: [], errors: [] };
  // One fetch, so one progress item; close('script') ticks it when this settles.
  loadProgress.expect('script');
  const scriptReady = (async () => {
    try {
      const res = await fetch(SCRIPT_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${SCRIPT_URL}`);
      const parsed = parseScript(await res.text());
      if (!parsed.gate.length) parsed.errors.push('script contains no gate dialogue');
      if (parsed.errors.length) throw new Error(parsed.errors.join('; '));
      SCENES = parsed;
      storyStatus.source = SCRIPT_URL;
      storyStatus.directives = parsed.directives.slice();
    } catch (err) {
      // The fallback remains playable, while QA can distinguish an intentional
      // fallback from a successfully validated canonical script.
      storyStatus.errors.push(err && err.message ? err.message : String(err));
    }
  })();

  // ---------------------------------------------------------------- dialogue
  const elDlg = document.getElementById('dlg');
  const elDlgPanel = elDlg.querySelector('.dpanel');
  const elDlgFace = elDlg.querySelector('.dport img');
  // The engine — portrait ladder, beat runner, portrait loader — is
  // src/ui/dialogue.mjs. The three element handles above and the pointerdown
  // handler below stay here: the first are the page's DOM, and the second hands
  // the camera back rather than advancing anything.
  const dialogue = createDialogue({
    THREE, elDlg, elDlgPanel, elDlgFace, loadProgress,
    battleDef: BATTLE_DEF,
    // a getter, because an fx beat changes the scene under a running dialogue
    sceneName: () => sceneNow(),
    units, cliffActors, mineActors, gateSpeakers: GATE_SPEAKERS, minePortraits,
    placeBubblePanel, faceOf, placeholderFace, artPortrait, startMusic,
  });
  const {
    portraitsReady,
    start: startDialogue, advance: advanceDialogue, redraw: drawBeat,
    reposition: placeDlgBubble, clear: clearDialogue, abandon: abandonDialogue,
    active: dialogueUp, speakerUnit, portraitOf,
  } = dialogue;
  // Portraits and mine sprites arrive as blob URLs, which outlive the scene, the
  // <img> and the module that made them unless they are revoked by hand. The
  // dialogue engine's two maps are module-private so it revokes its own; the
  // mine's map is handed out, so the page revokes that one.
  ledger.adopt('portraits', () => dialogue.release());
  ledger.adopt('mine-portraits', () => {
    for (const key of Object.keys(minePortraits)) {
      const url = minePortraits[key];
      if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
      delete minePortraits[key];
    }
  });
  // The card covers the screen, so it has to hand the camera back: a drag pans the
  // diorama (and rotation/zoom were never blocked), and only a click that never
  // moved counts as "next".
  elDlg.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    beginDialogueDrag(ev);
  });

  // ---------------------------------------------------------------- win / lose
  // The check itself is the turn machine's (it runs at every turn boundary and
  // after an out-of-band reprisal); what stays here is the descriptor lookup that
  // answers WHICH rosters count, and the two end cards it calls back into.
  // Battle 1: losing any imperial is defeat (all three survive the story).
  // Warning-bell (Jonah, 2026-07-30): FFT-style — only Seira is essential, the
  // battle is lost when SHE falls, however many others do.
  // The rule lives in the battle descriptor, and essential units are named there
  // rather than looked up by hand: the old `units.find(...).id` threw outright on
  // any roster that renamed its protagonist, turning a content typo into an
  // unplayable battle. An unresolvable name is recorded and dropped instead.
  const outcomeErrors = [];
  function outcomeOptions() {
    return outcomeOptionsFor(BATTLE_DEF, units, name => {
      const note = `${BATTLE_DEF.id}: essential unit "${name}" is not on the roster`;
      if (!outcomeErrors.includes(note)) outcomeErrors.push(note);
      // read live: the end check asks on every fall, so a rule flipped mid-battle
      // decides the very next one
    }, { lastStanding: RULES.get('lastStanding') });
  }
  // The warning-bell encounter's cinematics live in one module the page does not
  // otherwise touch: `src/scenes/warning-bell-opening.mjs` owns the approved beat
  // list, the bell entrance and its cutscene actors and plates, the held-reprisal
  // and form-switch beats, and the prototype's end card. This block is the whole
  // interface — the primitives a beat is allowed to use, named — so staging
  // revisions land in that module instead of in this file. Nothing is passed
  // implicitly: a beat that needs something new from the page gets another field
  // here, and a missing one fails loudly at construction.
  const warbellScene = WARBELL ? createWarningBellOpening({
    THREE, world, grid: { width: W, depth: D }, units, tileTop, tileCenter,
    anchors: () => warbellAnchors,           // resolved when the terrain kit builds
    plateTextures: wbPlateTex, artLoadErrors,
    spriteFigure, useActorArt, actorSetFrame, artHeight: ART_H,
    setWalking, faceToward, moveUnit, centerOn,
    bark, portraitOf, beginScriptedCombat, castCry, switchForm: switchUnitForm,
    reactions, fireReaction, unitById,
    revengeDamage,        // live-tunable, so read per reprisal
    chimeBell, cueBattleMusic,
    later, cineLater, cineTween,
    haltBattle: haltBattlePresentation, startDialogue,
  }) : null;
  // The cinematic's own figures and plates, billboarded every frame by the unit
  // rules. The renderer and the debug API walk these lists; both are empty when
  // the gallery is not the battle being staged.
  const wbCineActors = warbellScene ? warbellScene.actors : [];
  const wbCineBillboards = warbellScene ? warbellScene.billboards : [];
  // WHICH ending this encounter plays is the descriptor's call, and both
  // endings take the campaign's outro the same way. It is a named function
  // rather than a branch inside the turn machine's callback so that there is
  // exactly one victory path: the debug surface drives THIS, not a copy of it,
  // and a gate that reaches the end card has reached the one the game reaches.
  function battleVictory() {
    if (BATTLE_DEF.outcome.victory === 'prototype-card') {
      warbellScene.victory(OUTRO ? (OUTRO.beats || []) : null, OUTRO ? OUTRO.onEnd : null);
      return;
    }
    // A defense that held. There is no closing cinematic for this encounter and
    // it must not borrow battle 1's — victorySequence() would play the mine
    // finale and end Part I in a Figaro courtyard — so it goes straight to the
    // terminal overlay, or hands a campaign its outro the way the others do.
    if (BATTLE_DEF.outcome.victory === 'hold') {
      haltBattlePresentation();
      if (OUTRO) { OUTRO.onEnd(); return; }
      finish('VICTORY', false);
      return;
    }
    victorySequence();
  }
  // beat on the kneeling bodies, then Cassien calls it off
  //
  // Three endings hang off the same script, and the seam between them is the
  // post-battle beats: THOSE always play, because they are how the battle
  // finishes. What follows differs.
  //
  //   the exploration prototype  its own card, then free roam (opt-in only)
  //   this battle played ALONE   the mine finale, then "End of Part I"
  //   a campaign                 hands straight back after the script
  //
  // RULED (Jonah, 2026-08-03): the mine finale is NOT between the two battles.
  // It belongs at the END of the arc and is not fully developed yet, so the
  // campaign does not run it — the act card covers the transition instead, and
  // no new content was written to replace it. The finale is untouched and stays
  // fully reachable: `?scene=mine`, `__BATTLE.beginMine()`, and battle 1 played
  // as a single encounter all stage it exactly as before, which is what
  // tools/mine_scene_check.py goes on asserting unmodified.
  function victorySequence() {
    haltBattlePresentation();
    const closing = OUTRO
      ? (OUTRO.beats || [])
      : [
          { kind: 'fx', skippable: false, run: transitionToMine },
          ...configureMineBeats(SCENES.mine),
          { kind: 'tbc', text: 'End of Part I' },
        ];
    const beats = POST_BATTLE_EXPLORE
      ? SCENES.post.concat([{ kind: 'tbc' }])
      : SCENES.post.concat(closing);
    later(() => startDialogue(beats,
      () => {
        if (POST_BATTLE_EXPLORE) { beginExploration(); return; }
        if (OUTRO) { OUTRO.onEnd(); return; }
        finish('PART I COMPLETE', false);
      }), 1100);
  }
  // Post-battle free-roam's movement engine lives in src/modes/exploration.mjs;
  // this is the whole interface it gets, named, matching enemy-ai.mjs's style.
  const exploration = createExplorationMode({
    THREE, grid: { width: W, depth: D }, walkable, stepOK, inBounds, tileTop,
    stairAt: (x, z) => S[z][x], heightUnit: HU, topThick, units,
    azimuth: azimuthNow, faceKeys: facingPicker.FACE_KEYS, phase: () => flow.phase,
    setWalking, center: CENTER, clampCenter, placeCamera, marker,
  });
  // A click-to-path destination cancels any camera glide in flight, same as
  // the original inline exploreTo() did — a page-level camera concern the
  // movement module itself has no business owning.
  function exploreTo(tx, tz, px = tx + 0.5, pz = tz + 0.5) {
    const ok = exploration.moveTo(tx, tz, px, pz);
    if (ok) cancelGlide();
    return ok;
  }
  function beginExploration() {
    runtimeTimers.cancelAll();
    const seira = units.find(u => u.name === 'Seira' && u.alive);
    if (!seira) { finish('VICTORY', false); return false; }
    enterTown();
    hideFacingArrows();
    clearHighlights();
    clearMark();
    flow.clearMode(); flow.uiTurn = false;
    exploration.begin(seira);
    flow.phase = 'explore';
    if (pulsed) { pulsed.group.scale.setScalar(1); pulsed = null; }
    marker.visible = true;
    marker.position.set(seira.x + 0.5, tileTop[seira.z][seira.x] + 0.02, seira.z + 0.5);
    document.body.classList.add('exploring');
    document.getElementById('exploreHint').classList.add('show');
    centerOn(seira.x, seira.z);
    renderStrip();
    refreshButtons();
    return true;
  }
  function finish(word, lose) {
    runtimeTimers.cancelAll();
    flow.phase = 'over'; flow.mode = null; clearHighlights(); marker.visible = false;
    exploration.end();
    document.body.classList.remove('exploring');
    document.getElementById('exploreHint').classList.remove('show');
    banner('', ''); refreshButtons();
    const ov = document.getElementById('overlay');
    ov.querySelector('.word').textContent = word;
    ov.classList.toggle('lose', lose);
    ov.classList.add('show');
  }
  document.querySelector('#overlay .rst').addEventListener('click', () => location.reload());

  // ---------------------------------------------------------------- player input
  // What a tap or a key MEANS is src/ui/battle-input.mjs: the two paths (pointer
  // picks and commits; keyboard drives a cursor and confirms) funnel into the
  // same commands, so a rule enforced for one is enforced for the other. The page
  // keeps what the module points AT — the raycaster, the highlight and cursor
  // meshes, the facing chevrons — and hands them over named.
  const input = createBattleInput({
    flow, units, camera, canvas: renderer.domElement, raycaster, ndc,
    viewport: () => ({ width: innerWidth, height: innerHeight }),
    highlights: hlActive,                    // clearHighlights REPLACES the array
    tileMeshes,
    unitAt, walkable, inBounds, reachable, moveTiles, pathTo, attackTargets, abilTargets, canCast,
    attackFootprint, abilFootprint,
    showHighlights, clearHighlights, setMoveCursor, setAttackCursor, clearAttackCursor,
    moveTarget, attackCursorUnit,
    showThreatArcs: (threats, tile) => { if (RULES.get('dangerTiles')) threatArcs.show(threats, tile); }, threatUnitsAt,
    refreshButtons, moveActionCursor, executeActionCursor,
    moveUnit, attack, castAbility, defendAction, undoMove, completeAction, endTurn,
    ability: key => abilities.get(key),
    forecast, centerOn,
    facing: {
      active: () => facingPicker.isActive(),
      close: closeFacingPicker,
      pickArrow: pickFacingArrow,
      keyDir: facingKeyDir,
    },
    dialogueUp: () => dialogueUp(), advanceDialogue: () => advanceDialogue(),
    exploration, exploreTo,
    toggleTac, toggleMute,
    btn,
    signal,
  });
  const { handleTap, pick, chooseAbil, afterPlayerMove } = input;

  // ---------------------------------------------------------------- enemy AI
  // How an enemy turn READS is src/ui/ai-telegraph.mjs: the three view
  // primitives below are handed to the AI through it, so a militia move or
  // strike shows its range, marks its choice, and only then happens — in the
  // same chrome and the same order the player's own commands use. It wraps
  // presentation around the actions and changes no decision; under FAST_SIM it
  // calls straight through, so bots and goldens see the unwrapped game.
  const aiTelegraph = createAiTelegraph({
    moveUnit, attack, castAbility,
    reachable, attackFootprint, abilFootprint,
    abilityHl: key => { const def = abilities.get(key); return def && def.hl; },
    showHighlights, clearHighlights, setMoveCursor, setAttackCursor,
    later, aiBeat: () => AI_BEAT, phase: () => flow.phase, inert: () => FAST_SIM,
  });
  // The militia are defenders: they hold their terrace, shoot what comes into
  // range, and never charge downhill into the imperials. Decision logic lives
  // in src/core/enemy-ai.mjs; this is the whole interface it gets, named.
  const enemyAI = createEnemyAI({
    THREE, living, terraceOf, reachable, pathTo,
    moveUnit: aiTelegraph.moveUnit, later, distance: rangeDist,
    aiBeat: () => AI_BEAT, endTurn, phase: () => flow.phase,
    attackTargets, defendAction, attack: aiTelegraph.attack, abilities, takeAim,
    castAbility: aiTelegraph.castAbility,
    defendCost: () => RULES.get('defendCostsTp') ? DEFEND_TP : 0,
    couldShootFrom, approachCost: battleGrid.approachCost,
    round: () => flow.round, engageRange: ENGAGE_RANGE,
    // Element 5 replaces the invisible flask-range creep with a legible push:
    // with the flag on, escalation never starts and prepared defenders advance
    // instead. Jonah's objection to the escalation was that it is illegible —
    // the player cannot see a number growing — so the two are one switch.
    escalateStart: () => escalationStart(),
    advanceWhenPrepared: () => RULES.get('aggressiveDefense'),
    smartMilitia: () => RULES.get('smartMilitia'),
    stickyFocus: () => RULES.get('stickyFocus'),
    aimAlertRange: AIM_ALERT_RANGE,
    shotRange, floatText, tileCenter,
  });
  const aiTurn = enemyAI.aiTurn;

  // ---------------------------------------------------------------- per-frame game update
  let pulsed = null;
  let lastIdleSig = 0;   // idle reach preview: last drawn board signature
  let idleSnap = null;   // idle reach preview: pre-walk grid, replayed through undo
  // Test-only staging switch (__BATTLE.idleGrid): the art-hooks z-order probe
  // derives a figure's silhouette by diffing figure-present against
  // figure-moved-away — and vacating a tile ADDS it to the idle grid (the
  // body stopped blocking it), which corrupts that mask. The probe turns the
  // layer off for its shots and restores it, the same staging contract it
  // already uses for rules.dangerTiles. Never read by the game.
  let idleGridOn = true;
  function updateGame(dt, t) {
    stepTweens(dt);
    stepCliffExit(dt);
    stepMineStory(dt, t);
    exploration.step(dt);
    updateBuildingOcclusion(dt);
    if (marker.visible) {
      // the caret keeps the breath the ring used to share: it bobs, and now
      // also pulses, so "whose turn" still reads as motion rather than a static
      // arrow after the ring at the feet was retired
      const cu = flow.phase === 'explore' ? exploration.unit() : flow.current();
      markerCaret.material.opacity = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(t * 4.5));
      markerCaret.position.y = (cu ? cu.topY : SPRITE_TOP) + 0.512 + Math.sin(t * 3) * 0.07;
    }
    // billboards: every sprite yaws (Y only, so it stays upright) toward the camera,
    // and mirrors horizontally when the unit's logical facing points camera-left.
    // Tracks the rotation tweens because it runs off the live camera position.
    for (const v of units) {
      if (!v.sprite || !v.group.parent) continue;
      billboard(v, dt, v.alive);
    }
    // gallery cutscene actors billboard by the unit rules, gait and all
    for (const a of wbCineActors) billboard(a, dt, true);
    // the cliffs figures billboard by the same rules, minus everything unit-shaped
    if (cliffsWorld.visible) for (const a of cliffActors) billboard(a, dt, true);
    if (mineWorld.visible) {
      for (const a of minePartyActors) billboard(a, dt, true);
      for (const a of mineSpriteActors) {
        const yaw = Math.atan2(
          camera.position.x - a.group.position.x,
          camera.position.z - a.group.position.z
        );
        a.fig.rotation.y = yaw - a.group.rotation.y;
      }
    }
    // poison pulses so it can't be missed
    for (const v of units) {
      if (v.alive && hasStatus(v, 'poison')) {
        // The droplet is poison's motion cue now that the ring at the feet is
        // gone (the bar's keyline is its steady one).
        const k = 1 + Math.sin(t * 5) * 0.12;
        v.poisonIcon.scale.set(0.5 * k, 0.5 * k, 1);
      }
    }
    // gentle breathing pulse on the unit awaiting player orders
    const u = flow.phase === 'player' ? flow.current() : null;
    if (pulsed && pulsed !== u) { pulsed.group.scale.setScalar(1); pulsed = null; }
    if (u) { u.group.scale.setScalar(1 + 0.035 * (0.5 + 0.5 * Math.sin(t * 4.5))); pulsed = u; }
    // The idle reach preview (Jonah, 2026-08-17): while a unit awaits orders
    // with NO command picked, its reachable squares show the full move grid —
    // fill, danger purple and all, Triangle Strategy style — so "whose turn"
    // and "how far" read from the board before Move is ever pressed. Driven
    // HERE, beside the pulse that answers the same
    // question, rather than from the mode machine's many entry points: a
    // per-frame signature over (acting unit, its flags, every unit's tile and
    // life state) means an undo, an act-then-move, or a reprisal rearranging
    // the board redraws or retires the preview without any of those paths
    // knowing it exists. Presentation only — the outline colours squares the
    // same `moveTiles` Move will offer; legality still lives at the commit
    // sites.
    //
    // AND THROUGH THE UNDO WINDOW (Jonah, same day): a committed move is not
    // a confirmed one until an action spends it, so while `u.undo` can still
    // take the walk back the grid STAYS — the SNAPSHOT drawn before the walk,
    // not a recompute, because reachability from the origin must keep saying
    // what it said when the player chose (a recompute would also drop the
    // tile the unit now stands on, its own body excluding it). The origin
    // square wears the gold ring: where Undo returns you.
    //
    // AND THROUGH THE WALK ITSELF (Jonah, same day again — he watched the
    // grid vanish at commit and reappear on arrival and asked why): `gu`
    // looks through the anim phase at the same current unit, so the walk is
    // one continuous picture — grid up, ring on the origin from the first
    // step — instead of a blink bracketing the tween. `u.moved`/`u.undo` are
    // set at commit, before the walk, so the undo-window state is already
    // true mid-walk; the phase gate was the only thing hiding it. Player
    // units only: an enemy's walk shares the anim phase and must stay bare.
    const gu = (flow.phase === 'player' || flow.phase === 'anim') ? flow.current() : null;
    const gp = gu && gu.team === 'player' ? gu : null;
    // `flow.mode` stays stale ('move') through the walk — beginActionAnimation
    // clears the mode HIGHLIGHTS but only afterPlayerMove clears the mode — so
    // during anim the board is mode-free in fact even when the flag says
    // otherwise.
    const modeFree = !flow.mode || flow.phase === 'anim';
    const undoWindow = gp && modeFree && gp.moved && gp.undo && !gp.acted;
    const idleSig = (idleGridOn && gp && modeFree && (!gp.moved || undoWindow))
      ? (units.reduce((a, v) => (a * 33 + v.x * 7 + v.z * 13
          + (v.alive ? 1 : 0) + (v.downed ? 3 : 0)) | 0,
        gp.id * 5 + (gp.acted ? 2 : 3) + (gp.moved ? 7 : 0)) || 1)
      : 0;
    if (idleSig !== lastIdleSig) {
      lastIdleSig = idleSig;
      if (!idleSig) clearIdleReach();
      else if (!undoWindow) {
        const tiles = moveTiles(gp);
        idleSnap = { unitId: gp.id, tiles };
        showIdleReach(tiles);
      } else {
        // the pre-walk snapshot; recompute only if it somehow isn't ours
        const tiles = (idleSnap && idleSnap.unitId === gp.id)
          ? idleSnap.tiles : moveTiles(gp);
        showIdleReach(tiles, { x: gp.undo.x, z: gp.undo.z });
      }
    }
    const wob = 0.5 + 0.5 * Math.sin(t * 3.2);
    for (const k in hlMat) hlMat[k].opacity = 0.78 + 0.22 * wob;
    // facing chevrons: a slow gold breath, and the hovered one steps forward
    facingPicker.pulse(t);
    const markTarget = markMesh.visible ? markedUnit(units) : null;
    if (markTarget) {
      const p = markTarget.group.position;
      markMesh.position.set(p.x, p.y + markTarget.topY - 0.428 + Math.sin(t * 3.4) * 0.06, p.z);
      markMesh.rotation.y = t * 1.6;
    }
    updateBarks();
    // The near wall exists only when the camera swings to face it: shown once
    // the lens is clearly north of the gallery centre (looking back south at
    // it), hidden through the boundary band so orbiting never flickers it.
    if (wbSouthWall) {
      if (camera.position.z < D / 2 - 1.5) wbSouthWall.visible = true;
      else if (camera.position.z > D / 2 + 0.5) wbSouthWall.visible = false;
    }
    // cinematic plates read flat unless they face the lens like every unit does
    for (const b of wbCineBillboards) {
      if (!b.group.parent) continue;
      b.group.rotation.y = Math.atan2(camera.position.x - b.group.position.x,
                                      camera.position.z - b.group.position.z);
    }
    // Berserk rage pulse (Jonah, after the arcade Rocksteady/Bebop language):
    // the accepted sprite itself throbs red in-engine — no transformed art, no
    // new files. A hit flash briefly wins the same material color and the pulse
    // retakes it on the next frame, which reads as red-on-red and is fine.
    if (WARBELL) {
      for (const u of units) {
        if (!isBerserk(u) || !u.alive) continue;
        const k = (Math.sin(t * 4.6) + 1) / 2 * 0.55;
        u.mats.forEach(m => {
          if (m.userData.baseColor === undefined) m.userData.baseColor = m.color.getHex();
          m.color.setHex(m.userData.baseColor).lerp(berserkHot, k);
        });
      }
    }
  }

  // debug/test handle: lets tooling project tiles to screen space, inspect turn
  // state, and drive every action headlessly
  // debug/test handle: lets tooling project tiles to screen space, inspect turn
  // state, and drive every action headlessly. The surface itself is
  // src/debug/battle-api.mjs — a projection over this scope, extracted last so
  // its export list only had to be written once. The context is enormous because
  // the context IS the surface.
  window.__BATTLE = createBattleApi({
    ABIL, ART_VIEWS, ART_WALK_MAX, BATTLE_DEF, POST_BATTLE_EXPLORE,
    SIDE_VIEW_IN_BATTLE, THREE, TP_CAP, WALK_CONTACT_HOLD, WALK_CYCLES_PER_TILE, WARBELL,
    abilTargets,
    abilities, advanceDialogue, afterPlayerMove, applyDamage, artLoadErrors, artReady,
    artSetKey, attack, attackCursorUnit, attackTargets, availableCommands, azimuthNow,
    battleVictory,
    azimuthTarget, beginExploration, berserkMultiplier, billboard, bloom,
    bokeh, bubbles, buildingOccluders, camera, cameraMoving, canCast,
    castAbility, cliffActors, cliffsOpening, commandKey, completeAction, composer,
    couldShootFrom, cursorMeshes: tileChrome.cursorMeshes, idleActive: tileChrome.idleActive,
    idleOrigin: tileChrome.idleOrigin, living,
    setIdleGrid: on => { idleGridOn = !!on; },
    canDefend, configureMineBeats, dangerReport, defendAction, dialogue, endTurn, enterMine, eventLog, exploration,
    faceAtNearestFoe,
    exploreTo, faceOf, facingPicker, floatText, flow, gaitOn,
    healAmount, hlActive, hlMat, hud, loadProgress, markMesh,
    marker, mineActors, mineFinale, moveTarget, moveUnit, mulberry,
    music, outcomeErrors, paintedArt, pathTo, reachable, reactions,
    refreshButtons, renderStrip, revengeDamage, rotate, rotateTo, runtimeTimers,
    rules: RULES,
    scene, sceneNow, setAimed, setPoison, shotRange, minShotRange, soloRevenge, spriteBust,
    startDialogue, stepCliffExit, stepMineStory, stepTweens, stopCliffExit, storyStatus,
    threatArcs, tileCenter, tileTop, tweens, unitAt, unitById, unitSprite,
    units, updateBuildingOcclusion, victorySequence, walkCycle, walkFraction, walkFrameCount,
    walkFrames, walkPhase, walkWeights, walkable, wbCineActors,
    // replaced when the story file finishes parsing, so never captured
    scenes: () => SCENES,
    // The four hooks that RETUNE the game rewrite page-level `let`s, and a module
    // cannot assign to an injected binding. They arrive as operations instead,
    // defined beside the variables they move.
    knobs: {
      fast: () => { AI_BEAT = 30; STEP_TIME = 0.02; FAST_SIM = true; CINE_SCALE = 0.12; },
      setStepTime: v => { STEP_TIME = Math.max(0.01, v); return STEP_TIME; },
      setBattleWalk: on => { BATTLE_WALK_ANIM = !!on; return BATTLE_WALK_ANIM; },
      seed: n => { combatRand = mulberry(n | 0); },
      battleWalk: () => BATTLE_WALK_ANIM,
    },
  });

  // The scene opens wide on the whole diorama, then eases in on the confrontation —
  // the midpoint between the party and the gate guard who speaks first — over about
  // three seconds, landing just after his first line lands. Computed from live
  // positions, so moving a deployment moves the opening shot with it. The wheel
  // cancels the zoom leg mid-flight and a drag cancels the pan leg; advancing the
  // dialogue does neither, so clicking through lines never jump-cuts the camera.
  const OPEN_ZOOM = 1.9, OPEN_TIME = 2.9;
  // Battle 3 opens wider than either: the whole courtyard from the keep door to
  // the breach is the composition, and it is a deeper board than the gallery.
  // The look-at point sits low — near the courtyard floor rather than at eye
  // height — because the board is what the shot is about and a higher pivot
  // pushes it under the action bar while leaving a third of the frame sky.
  // Keep the enlarged 17×19 courtyard and its flanking towers in frame.
  const FIGARO_ZOOM = 0.78, FIGARO_CENTER_Y = 0.55;
  function frameConfrontation(instant = false) {
    const party = living('player'), guard = GATE_SPEAKERS['Town Guard'] || speakerUnit('Guard');
    if (!party.length || !guard) return;
    const px = party.reduce((s, u) => s + u.x, 0) / party.length;
    const pz = party.reduce((s, u) => s + u.z, 0) / party.length;
    if (instant) {
      cancelCameraMoves();
      CENTER.x = (px + guard.x) / 2 + 0.5;
      CENTER.z = (pz + guard.z) / 2 + 0.5;
      clampCenter();
      camera.zoom = OPEN_ZOOM;
      camera.updateProjectionMatrix();
      placeCamera();
      return;
    }
    centerOn((px + guard.x) / 2, (pz + guard.z) / 2, OPEN_TIME);
    zoomTo(OPEN_ZOOM, OPEN_TIME);
  }

  // ---------------------------------------------------------------- opening scene
  // The reference composition is a held overlook: the trio talk in place, then move
  // toward the foreground/down-screen only after Cassien settles the argument.
  // The path's x-meander still guides their one-way departure.
  // startCliffExit/stopCliffExit/stepCliffExit/departCliffs — the walk-off-frame
  // machinery that shares cliffActors with the construction above — live in
  // cliffs-opening.mjs too; see the destructure near CLIFFS SCENE for
  // stopCliffExit/stepCliffExit/departCliffs, called below and from the
  // per-frame loop and the debug API exactly as the inline versions were.
  // cliffs -> town: a straight fade through black. The switch happens at full black,
  // so the lighting regrade and the camera jump are never seen; a click during the
  // fade cuts it short instead of stacking behind it.
  let townEntered = false;
  function enterTown() {
    if (townEntered) return;
    townEntered = true;
    stopCliffExit();
    // One entry function, one latch, whichever battle is on the board: what
    // differs is the grading it lands under.
    showScene(FIGARO ? 'figaro' : 'town');
    setAzimuth(BATTLE_START_AZIMUTH);
    CENTER.set(W / 2, 1.8, D / 2); clampCenter();
    camera.zoom = 1.0; camera.updateProjectionMatrix();
    placeCamera();
    frameConfrontation();                     // the classic slow push-in on the gate
  }
  function transitionToMine(done) {
    const el = document.getElementById('fadeout');
    const T = FAST_SIM ? 30 : 720, HOLD = FAST_SIM ? 10 : 180;
    el.style.transition = `opacity ${T}ms ease-in-out`;
    el.style.opacity = '1';
    later(() => {
      enterMine();
      later(() => {
        el.style.opacity = '0';
        startMineEntrance(done);
      }, HOLD);
    }, T);
    return {};
  }
  function sceneFade(done) {
    const el = document.getElementById('fadeout');
    const T = FAST_SIM ? 30 : 780, HOLD = FAST_SIM ? 10 : 220;
    const CAMERA_SETTLE = FAST_SIM ? HOLD + T : Math.max(HOLD + T, OPEN_TIME * 1000);
    const timers = [];
    el.style.transition = `opacity ${T}ms ease-in-out`;
    el.style.opacity = '1';
    timers.push(later(() => {
      enterTown();
      timers.push(later(() => {
        el.style.opacity = '0';
      }, HOLD));
      // Do not reveal the first guard line until the confrontation framing is
      // complete. Otherwise its speaker-anchored bubble visibly slides while the
      // camera is still pushing in.
      timers.push(later(() => {
        if (FAST_SIM) frameConfrontation(true);
        done();
      }, CAMERA_SETTLE));
    }, T));
    return { skip: () => {
      timers.forEach(cancelLater);
      enterTown();
      frameConfrontation(true);
      el.style.transition = 'opacity 220ms ease-out';
      el.style.opacity = '0';
    } };
  }
  // the whole pre-battle run is ONE dialogue: cliffs beats, the transition, then the
  // gate. advance() therefore walks the player (or a bot) from the first stage
  // direction all the way to round 1 without ever handing control back.
  function openingBeats() {
    const cliffs = SCENES.cliffs.map((b, i) => Object.assign({}, b, {
      onShow: i === 0
        ? () => { const c = overlookCenter(); centerOn(c.x, c.z, CLIFF_PUSH); zoomTo(CLIFF_CLOSE, CLIFF_PUSH); }
        : null,
    }));
    const bridge = {
      kind: 'fx',
      skippable: false,
      run: finish => departCliffs(finish),
    };
    return cliffs.concat(cliffs.length ? [bridge] : [], SCENES.gate);
  }
  function enterChosenScene() {
    if (REVIEW_MINE) {
      // Review entry: load the finished mine sequence without requiring someone
      // to replay the overlook and gate battle. This is deliberately a URL mode,
      // not a second copy of the scene, so review exercises the exact production
      // staging, dialogue, portrait, arrow, resonance, and white-out.
      enterMine();
      startMineEntrance(() => startDialogue(
        configureMineBeats(SCENES.mine).concat(
          [{ kind: 'tbc', text: 'End of Part I' }]),
        () => {}
      ));
      return;
    }
    if (REVIEW_BATTLE) {
      // Direct comparison entry for battlefield review. This invokes the real
      // production battle state rather than maintaining a separate mock scene.
      enterTown();
      frameConfrontation(true);
      newRound();
      return;
    }
    if (FIGARO) {
      // Battle 3 has NO opening cinematic: the raiders are already through the
      // gate when the card lifts, and the party is already on the terrace. So
      // this composes the shot and starts the first round — no dialogue, no
      // beats, and above all no fall-through to the cliffs, which is where a
      // battle without its own branch would end up.
      enterTown();
      cancelCameraMoves();
      CENTER.set(W / 2, FIGARO_CENTER_Y, D / 2);
      clampCenter();
      camera.zoom = FIGARO_ZOOM; camera.updateProjectionMatrix();
      placeCamera();
      newRound();
      return;
    }
    if (WARBELL) {
      // Warning-bell prototype: onto the gallery floor, through the scripted
      // Seira opening (spec in DESIGN.md), then the normal turn engine. Snap
      // the camera to the gallery midpoint NOW — this runs under the opaque
      // card, so the reveal is already composed and the first beat glides
      // from a sensible frame instead of cutting.
      // enterTown() ends on Battle 1's slow push-in from the wide boot framing.
      // The gallery does not want it: the trio's arrival march is the first
      // thing that happens here, and it was playing inside a three-second zoom,
      // at a fraction of the scale it is staged for. Land the composed shot
      // instead, the way frameConfrontation(true) does for the review entry.
      enterTown();
      cancelCameraMoves();
      CENTER.set(6.5, 1.2, warbellScene.entryCenterZ);
      clampCenter();
      camera.zoom = OPEN_ZOOM;
      camera.updateProjectionMatrix();
      placeCamera();
      startDialogue(warbellScene.beats(), newRound);
      return;
    }
    if (!SCENES.cliffs.length) enterTown();
    startDialogue(openingBeats(), newRound);
  }

  // ---------------------------------------------------------------- entry card
  // The opaque curtain, its loading bar, the audio unlock and the ALL-art hold
  // live in src/boot/loading.mjs. WHICH scene is entered is not the card's
  // business: that branch is `enterChosenScene` above, handed over as onOpen.
  //
  // Every value the card is built from is a PARAMETER with today's behaviour as
  // its default, because a chained battle's card is player-facing and its feel
  // is not settled. Battle 2 arriving behind its own NARSHE MINES card may read
  // as a natural act break or as an interruption; that is Jonah's call during
  // campaign flow, not something to bake in here. So a flow controller can
  // retitle it, retime it, restyle it through a class, or drop the curtain
  // entirely and cover the transition itself — without surgery on this file.
  //
  // `curtain: false` still WAITS for every asset before entering; it only stops
  // drawing a card over the wait. The "all art before the scene is shown"
  // contract is the card's reason to exist and does not move with its styling.
  const REVIEW_ENTRY = REVIEW_MINE || REVIEW_BATTLE;
  const CARD = context.card || {};
  const splash = createSplashCard({
    document,
    progress: loadProgress,
    // every readiness source, paired with the progress name its loader registers
    // under, so closing on settlement makes the bar's arithmetic total
    sources: [
      ['art', artReady], ['mine', mineArtReady], ['portraits', portraitsReady],
      ['script', scriptReady], ['music', musicReady], ['terrain', terrainSkinReady],
      ['gallery', gallerySkinReady], ['plates', wbPlatesReady],
    ],
    splashFloor: CARD.floor ?? (REVIEW_ENTRY ? 350 : 1700),
    splashFade: CARD.fade ?? 900,
    curtain: CARD.curtain ?? true,
    className: CARD.className ?? null,
    startMusic,
    audioContext: () => music.audioContext(),
    onOpen: enterChosenScene,
    signal,
  });
  const { assetsReady, opened } = splash;
  // tooling waits on these rather than guessing at the card's duration
  Object.assign(window.__BATTLE, { assetsReady, portraitsReady, opened });
  const clock = new THREE.Clock();

  function wantsFrame(nowMs) {
    if (RENDER_FPS <= 0 || RENDER_FPS >= 60) return true;    // uncapped
    // Half a frame of slack: against a 60Hz rAF a strict interval test would let
    // 30fps fall to 20 (two ticks is 33.3ms, just under the 33.3ms deadline).
    return nowMs - lastDrawAt >= 1000 / RENDER_FPS - 8;
  }
  // Exposed here rather than plumbed through the `knobs` context of
  // src/debug/battle-api.mjs, following the Object.assign idiom used a few lines
  // above for the splash hooks. Accessors, never captured values (trap 2): the
  // tuning path rewrites RENDER_FPS at runtime.
  Object.assign(window.__BATTLE, {
    // Battle 3's scenery seam, named so the gate that guards it can see whether
    // the module was constructed and how much it drew — the art pass replaces
    // its contents and this stays the same question. Null everywhere else.
    figaroScenery: () => (figaroScenery ? {
      props: figaroScenery.group.children.length,
      torches: figaroScenery.torches.length,
      visible: figaroScenery.group.visible,
    } : null),
    fps: () => RENDER_FPS,
    setFps: v => { RENDER_FPS = Math.max(0, Number(v) || 0); return RENDER_FPS; },
    /**
     * What this scene is holding on the GPU, from both sides of the ledger.
     *
     * `renderer.info` is three.js's own live count of what the driver has, and
     * it is the side that can be asserted as an INTEGER returning to a recorded
     * baseline after a teardown — the whole point of the exercise. `ledger` is
     * this scene's view of the same question, and the two disagreeing is itself
     * a finding: a resource in the ledger the renderer never counted was built
     * and never drawn, and a renderer count the ledger cannot explain came from
     * somewhere the substitution does not reach (the post chain's addons, or
     * three.js's own internals).
     */
    gpu: () => ({
      renderer: {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs ? renderer.info.programs.length : 0,
      },
      ledger: ledger.counts(),
      // The bytes the JS heap cannot see. A battle's real weight is decoded
      // pixels and PCM sitting outside the heap, so a soak that watched
      // `performance.memory` alone would report a leak-free session while
      // 105 MB a battle accumulated beside it (SCALABILITY §4.3).
      textureBytes: ledger.textureBytes(),
      music: music.state(),
    }),
  });

  // ---------------------------------------------------------------- animate
  // One frame of this battle. The requestAnimationFrame loop itself is the
  // SESSION's — it outlives any single battle and calls whichever scene is
  // current — so what used to be `animate()`'s self-rescheduling body is now
  // just its body. Nothing else about the frame moved: same order, same clock,
  // same frame cap, same composer call.
  function frame() {
    splash.begin();          // idempotent; the card runs on the first drawn frame
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (dialogueUp()) placeDlgBubble();

    stepCamera(dt);

    hoistWheel.rotation.z += dt * 0.4;
    if (figaroScenery) figaroScenery.flicker(t);
    updateGame(dt, t);

    for (const sm of smokeStacks) {
      sm.children.forEach((puff, i) => {
        const cyc = (t * 0.4 + i * 0.25) % 1;
        puff.position.y = cyc * 1.4;
        puff.position.x = Math.sin(t * 1.2 + i * 2.1) * 0.08 * cyc;
        puff.material.opacity = 0.38 * (1 - cyc) * Math.min(1, cyc * 6);
        puff.scale.setScalar(0.7 + cyc * 1.1);
      });
    }

    if (snowPts.parent) {
      const p = snowPts.geometry.attributes.position;
      const { drift, rangeX, rangeZ, height } = snowPts.userData;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) - dt * (0.55 + 0.25 * Math.sin(drift[i]));
        if (y < 0) {
          y = height;
          p.setX(i, CENTER.x + (Math.random() - 0.5) * rangeX);
          p.setZ(i, CENTER.z + (Math.random() - 0.5) * rangeZ);
        }
        p.setX(i, p.getX(i) + Math.sin(t * 0.8 + drift[i]) * dt * 0.18);
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }

    // FAST_SIM keeps its own 1-in-10 rule untouched: the sims already render far
    // below the idle rate, and stacking the two reductions would change what the
    // balance bots see between beats.
    const nowMs = performance.now();
    if (FAST_SIM ? (frameNo++ % 10 === 0) : wantsFrame(nowMs)) {
      lastDrawAt = nowMs;
      composer.render();
    }
  }
  let frameNo = 0;

  // ---------------------------------------------------------------- teardown
  // Give the battle back. Everything below is ordered, and the order is the
  // interesting part:
  //
  //  1. STOP THINGS IN FLIGHT FIRST. A scheduled callback that fires after the
  //     ledger has run holds a disposed geometry and throws into the next
  //     battle's frame loop, where nothing will explain where it came from.
  //     Timers, tweens, camera glides, a dialogue's completion callback and an
  //     AI beat are all cancelled before a single resource is freed.
  //  2. EMPTY THE GRAPH, INCLUDING WHAT THE GRAPH DOES NOT SHOW. `background`
  //     and `environment` are the two the three.js manual calls out by name:
  //     the renderer caches textures for both internally, and a traverse()
  //     never reaches either. They are nulled by hand for that reason.
  //  3. FREE THE LEDGER — every geometry, material, texture and render target
  //     registered at construction, plus the score, the post chain and the
  //     blob URLs adopted beside it.
  //  4. DROP THE RENDERER'S CACHES. `renderLists` holds per-scene arrays of
  //     the objects it drew, which keep disposed meshes (and their materials)
  //     alive across a transition and stop `renderer.info.programs` settling.
  //
  // Idempotent, and it must stay that way: a double teardown re-firing
  // three.js's `dispose` events can free a resource the NEXT battle has bound.
  let disposed = false;
  function dispose() {
    if (disposed) return { alreadyDisposed: true, freed: null, errors: [] };
    disposed = true;

    runtimeTimers.cancelAll();
    cancelCameraMoves();
    stopCliffExit();
    exploration.end();
    abandonDialogue();
    haltBattlePresentation();
    tweens.length = 0;
    smokeStacks.length = 0;
    buildingOccluders.length = 0;

    scene.background = null;
    scene.environment = null;
    scene.fog = null;
    scene.clear();

    const report = ledger.dispose();
    renderer.renderLists.dispose();
    return { alreadyDisposed: false, ...report };
  }

  return {
    /** Which encounter this is, for a session that is chaining them. */
    id: BATTLE_DEF.id,
    /** One frame; the session's rAF loop calls it. */
    frame,
    /** The window resized; the session's one listener calls it. */
    layout,
    /** Free everything this battle allocated. See the note above. */
    dispose,
    /** The entry card's two promises, so a caller can wait for a real scene. */
    assetsReady, opened,
    /** For the session's own counters and the lifecycle gate. */
    ledger,
  };
}
