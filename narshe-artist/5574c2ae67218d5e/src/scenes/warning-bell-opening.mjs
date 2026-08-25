/**
 * Warning-bell opening — the encounter's cinematics and staging layer.
 *
 * Everything the scripted opening needs in order to STAGE itself lives here:
 * the Jonah-approved beat list, the bell entrance (party march, sentry, chime,
 * the bonded pair walking out of the shaft), the cutscene actors and plates
 * that exist only while a cinematic is running, the held-reprisal and
 * form-switch beats, and the prototype's end card.
 *
 * The page keeps the GAME — units, rules, renderer, dialogue runner — and hands
 * this module the primitives a beat is allowed to use through one explicit
 * context object. Nothing here reads a global or reaches back into the page: if
 * a new beat needs something the page owns, it arrives as another named context
 * field. That is the whole point of the boundary — staging is the part of this
 * encounter that gets revised most often, and revising it must not mean editing
 * `diorama.html`.
 *
 * Three.js arrives through the context the way `render/terrain-kit.mjs` takes
 * it, so the module stays constructible from Node with a stub.
 */

// Every primitive a beat may use. Listed rather than duck-typed so a page edit
// that drops one fails loudly at construction instead of halfway through a
// non-skippable cinematic, where a throw silently strands the scripted opening.
const CONTEXT_FIELDS = [
  'THREE',           // scene graph constructors (injected, never imported)
  'world',           // the group cinematic props are added to
  'grid',            // { width, depth } of the battle grid
  'units',           // live roster array (searched by name at beat time)
  'tileTop',         // per-tile walkable surface heights
  'tileCenter',      // (x, z) -> world position of a tile's centre
  'anchors',         // () -> terrain-kit anchors (resolved after the kit builds)
  'plateTextures',   // preloaded cinematic plate textures by key
  'artLoadErrors',   // structured art-failure channel (__BATTLE.artErrors)
  'spriteFigure',    // (kind, pal) -> procedural figure + materials
  'useActorArt',     // (actor) -> true when the painted set took
  'actorSetFrame',   // (actor, frame) -> draw a gait frame
  'artHeight',       // world height of a sprite plate
  'setWalking',      // (unit, on) -> gait on/off
  'faceToward',      // (unit, x, z) -> logical facing
  'moveUnit',        // (unit, path, done) -> real tile-by-tile movement
  'centerOn',        // (x, z, dur) -> camera glide
  'bark',            // ({name, group, topY}, text, portrait, holdMs)
  'portraitOf',      // (who) -> portrait src
  'beginScriptedCombat',  // () -> the scripted fight starts: raise the health bars
  'castCry',         // (unit, done) -> the real Mournful Cry
  'switchForm',      // (unit, formId) -> enter one of that character's forms
  'reactions',       // reaction registry (suspend/resume)
  'fireReaction',    // (record, unit) -> animate one held reaction
  'unitById',        // (id) -> unit
  'revengeDamage',   // () -> current fixed revenge damage (live-tunable)
  'chimeBell',       // synthesized bell chime
  'cueBattleMusic',  // release the held battle track
  'later',           // (fn, ms) scheduled on the battle's own generation
  'cineLater',       // `later` on the cinematic clock
  'cineTween',       // tween on the cinematic clock
  'haltBattle',      // stop the battle presentation before an end card
  'startDialogue',   // (beats, done) -> run a beat list
];

// ---- staging constants (referenced by name from DESIGN.md; keep the names)
// The party's march in: [name, seconds of walk, ms of head start, stride
// offset in cycles]. Seira has the deepest staging tile, so she walks longest.
// (Jonah asked on 2026-07-31 for CASSIEN to lead with Seira behind him. The
// full position swap is real and staged on the `warbell-marching-order`
// branch; it is not here because it flips the warbell-kit doctrine gate from a
// round-6 win to a loss, and the resolution is a balance decision. See
// HANDOFF_PROJECT.md.)
// Column-order only (Jonah, 2026-07-31): CASSIEN steps out of the fog first
// and leads the column; everyone keeps their original staging tiles, so the
// balance-relevant positions — and the doctrine gates — are untouched.
const WB_PARTY_MARCH = [
  ['Cassien', 1.05, 0, 0.31],
  ['Seira', 1.55, 260, 0],
  ['Brecht', 1.05, 500, 0.63],
];
// A world z past the south wall line (the floor's last row is z 10), so they
// come out of the fog rather than fading up in the middle of the room. The
// south wall group itself is hidden at the default camera; the doorway they
// use is where it stands.
const WB_DOOR_Z = 10.9;
// Far enough up the gallery that the sentry's bark bubble clears the party.
const WB_SENTRY_POST = [4.2, 4.4];
// The entry card fades over SPLASH_FADE. The scripted beat starts under it, so
// without this the march was most of the way done by the time the curtain was
// off the screen. The camera opens on an empty gallery first, and THEN the
// party comes through the door.
const WB_CURTAIN_HOLD = 1250;
// The gallery holds still after they arrive, before anyone speaks.
const WB_ARRIVAL_HOLD = 1100;
// The entry frame sits south of the gallery midpoint so the doorway the party
// comes through is on screen; the camera cranes up to the bell for the sentry.
const WB_ENTRY_CENTER_Z = 7.2;
// World height of the bell plate. Named because the mount pivot below does
// arithmetic with it.
const WB_BELL_H = 1.15;
// Ending on (6,4) keeps both bonded enemies inside the self-centred burst,
// which is what the beat needs mechanically. (The flanking route that walks
// her AROUND Cassien lives on the `warbell-marching-order` branch, with the
// staging swap it belongs to.)
const WB_CRY_PATH = [[6, 7], [6, 6], [6, 5], [6, 4]];
// Which form Cassien's rebuke stresses her into. What Type 2 MAKES her — role,
// kit, costume, face — belongs to her character record, not to the script.
const WB_STRESS_FORM = 2;

export function createWarningBellOpening(context) {
  const missing = CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('warning-bell opening: missing context field(s) ' + missing.join(', '));
  }
  const {
    THREE, world, grid, units, tileTop, tileCenter, anchors, plateTextures,
    artLoadErrors, spriteFigure, useActorArt, actorSetFrame, artHeight,
    setWalking, faceToward, moveUnit, centerOn, bark, portraitOf,
    beginScriptedCombat, castCry,
    switchForm, reactions, fireReaction, unitById, revengeDamage,
    chimeBell, cueBattleMusic, later, cineLater, cineTween, haltBattle,
    startDialogue,
  } = context;
  const W = grid.width, D = grid.depth;
  const byName = name => units.find(v => v.name === name);

  // Yawed to the camera every frame like units; the page walks both lists.
  const cineBillboards = [];
  // Gallery cutscene actors: the cliffs/mine figure, standing on the battle
  // floor. A figure that CROSSES the gallery is one of these rather than a slid
  // plate, so the engine's distance-synced gait carries it — two strides per
  // tile off its own travel, the view its heading calls for — instead of a
  // texture flip pretending underneath a glide.
  const cineActors = [];

  // The gallery floor is flat, so cinematic props may sit at fractional grid
  // coordinates: height comes from one known-good tile, never from indexing
  // tileTop with a fraction.
  function wbFloorPos(x, z) {
    return new THREE.Vector3(x + 0.5, tileTop[2][6], z + 0.5);
  }
  // `pivot: 'top'` hangs the plate from its own top edge instead of balancing it
  // on its middle. A mesh rotates about its geometry's origin, so a plate whose
  // geometry is centred swings like a propeller — the mount travels as far as the
  // thing it is holding. Sliding the geometry down inside the mesh by half its
  // height puts the origin ON the top edge, and a rotation then reads as the
  // bracket staying planted while the body swings beneath it (Jonah, 2026-07-31).
  function wbCineBillboard(texKey, height, x, z, pivot = 'center') {
    const tex = plateTextures[texKey];
    const aspect = tex && tex.image ? tex.image.width / tex.image.height : 0.6;
    const material = new THREE.MeshBasicMaterial({
      map: tex || null, transparent: true, alphaTest: 0.08,
      side: THREE.DoubleSide, toneMapped: false, fog: true,
    });
    const geometry = new THREE.PlaneGeometry(height * aspect, height);
    if (pivot === 'top') geometry.translate(0, -height / 2, 0);
    const mesh = new THREE.Mesh(geometry, material);
    // either way the plate's BOTTOM lands on the group origin; only what
    // mesh.position.y names changes — the middle, or the mount.
    mesh.position.y = pivot === 'top' ? height : height / 2;
    const group = new THREE.Group();
    group.add(mesh);
    group.position.copy(wbFloorPos(x, z));
    world.add(group);
    const b = { group, mesh, material };
    cineBillboards.push(b);
    return b;
  }
  // Gallery props are kit geometry again (Jonah, 2026-07-31): billboard
  // plates read as straddling squares and turning wrongly for scenery. The
  // authored plates stay archived under art/review/narshe-mine-props/.
  // The bell is the only plate left, and it hangs for the whole battle, so the
  // retire path lives with the actors below — a figure that leaves the scene is
  // now a figure, not a plate.
  function addWarbellActor(name, kind, pal, x, z) {
    const { group: fig, mats, mesh } = spriteFigure(kind, pal);
    const group = new THREE.Group();
    group.add(fig);
    group.position.copy(wbFloorPos(x, z));
    world.add(group);
    const a = { name, kind, pal, team: 'player', group, fig, sprite: mesh, mats,
                flip: 1, art: null, artFace: 'front', artKey: 'front',
                walking: false, walkT: 0, walkDist: 0,
                lastX: group.position.x, lastZ: group.position.z,
                cutscene: true, topY: artHeight };   // scripted staging: gait is unconditional
    a.setFrame = f => actorSetFrame(a, f);
    // Runs after the card's all-art wait, so the painted set is already in. If it
    // somehow is not, say so through the same channel every other asset uses:
    // falling back to the procedural figure SILENTLY is how a pixelated stand-in
    // ships looking like a finished shot.
    if (!useActorArt(a)) {
      artLoadErrors.push({ name: pal, pose: 'front', path: 'art/runtime/sprites/' + pal + '_front.png',
                           error: 'cutscene actor "' + name + '" fell back to the procedural figure' });
    }
    cineActors.push(a);
    return a;
  }
  // Point a cutscene actor along its own travel; the view selection then decides
  // which plate that heading calls for, exactly as it does for a battle unit.
  function wbFaceAlong(a, dx, dz) {
    if (dx || dz) a.group.rotation.y = Math.atan2(dx, dz);
  }
  // An actor that has left the scene must also leave the per-frame billboard
  // list and give its geometry/material back. Its TEXTURES are not its own —
  // they are the shared painted set every miner draws from — so they stay.
  function wbRetireActor(a) {
    const at = cineActors.indexOf(a);
    if (at >= 0) cineActors.splice(at, 1);
    world.remove(a.group);
    a.sprite.geometry.dispose();
    for (const m of a.mats) m.dispose();
  }

  // ---- bell entrance (Jonah's staging, unlocked by the captain's plates): the
  // imperial trio walks in through the south doorway, a sentry watching from up
  // the gallery calls it, runs to the warning bell, rings it, and flees into the
  // dark; only then do Ragna and Skarn walk out of the shaft together — the pair
  // entering as one is the visual statement of the bond the retaliation rules
  // then teach.
  function warbellBellEntrance(finish) {
    const gx = k => k + W / 2, gz = k => k + D / 2;      // kit-local anchor -> grid
    const kitAnchors = anchors();
    const bellA = (kitAnchors && kitAnchors.warningBell) || [2.28, 1.22, -5.13];
    const bell = wbCineBillboard('bell', WB_BELL_H, gx(bellA[0]) - 0.5, gz(bellA[2]) - 0.5, 'top');
    // hangs from the shaft frame, not floor-standing. With the top-edge pivot
    // this y names the MOUNT, so it carries half a plate more than the old
    // centre-pivot number to leave the bell body hanging exactly where it was.
    bell.mesh.position.y = (bellA[1] || 1.22) + 0.35 + WB_BELL_H / 2;
    // kind/pal match the fielded militia (MINER): 'archer' is the procedural
    // fallback shape, 'miner' the palette AND the painted set he actually uses.
    // He stands well up the gallery, away from the party's staging: his bark
    // bubble hangs over his own head, and down at the south end it covered the
    // very arrival it is reacting to (Jonah, 2026-07-31).
    const sentry = addWarbellActor('Sentry', 'archer', 'miner', WB_SENTRY_POST[0], WB_SENTRY_POST[1]);
    const ragna = byName('Ragna');
    const skarn = byName('Skarn');
    // the pair is UNSEEN in the dark of the shaft until the bell has spoken
    for (const [u, sx] of [[ragna, 6], [skarn, 7]]) {
      u.x = sx; u.z = 0;
      u.group.position.copy(tileCenter(sx, 0));
      u.group.visible = false;
      u.cutscene = true;                                  // unconditional gait for the entrance
    }
    // The trio ARRIVES rather than already standing there (Jonah, 2026-07-31):
    // it starts past the south wall line, in the fog outside the doorway, and
    // walks up to its staging tiles on the real gait. Staggered starts and
    // per-figure stride offsets keep it from reading as one soldier drawn three
    // times, the same trick the cliffs march uses.
    // A name that is not on the roster is dropped rather than thrown on: a
    // renamed or re-cast party must not take the opening beat down with it, and
    // whoever is missing simply starts on their tile.
    const marchers = WB_PARTY_MARCH.map(([name, dur, delay, offset]) => {
      const u = byName(name);
      if (!u) return null;
      const home = { x: u.x, z: u.z };
      u.cutscene = true;                                  // unconditional gait for the entrance
      u.gaitOffset = offset;
      u.group.position.copy(wbFloorPos(u.x, WB_DOOR_Z));
      u.group.visible = false;
      return { u, home, dur, delay };
    }).filter(Boolean);
    const marchIn = done => {
      if (!marchers.length) { done(); return; }
      let landed = 0;
      for (const m of marchers) cineLater(() => {
        m.u.group.visible = true;
        const from = m.u.group.position.clone();
        const to = tileCenter(m.home.x, m.home.z);
        wbFaceAlong(m.u, to.x - from.x, to.z - from.z);
        setWalking(m.u, true);
        cineTween(m.dur, p => m.u.group.position.lerpVectors(from, to, p), () => {
          setWalking(m.u, false);
          m.u.group.position.copy(to);
          m.u.cutscene = false;
          faceToward(m.u, m.home.x, 0);                   // they arrive looking up the gallery
          if (++landed === marchers.length) done();
        });
      }, m.delay);
    };
    // He crosses on his own feet: the gait is driven by the ground he covers, so
    // the stride stays in step with the tween at any march speed, and the plate
    // is whichever view his heading calls for rather than a fixed front.
    const sentryWalk = (to, dur, done) => {
      const from = sentry.group.position.clone();
      wbFaceAlong(sentry, to.x - from.x, to.z - from.z);
      setWalking(sentry, true);
      cineTween(dur, p => sentry.group.position.lerpVectors(from, to, p), () => {
        setWalking(sentry, false);
        done();
      });
    };
    // Order is the point of the staging: they walk in, the gallery holds still
    // long enough to register that someone has arrived, and only THEN does the
    // sentry speak — his "Intruders!" is a reaction to what he has just watched,
    // not a line that opens the scene.
    cineLater(() => marchIn(() => cineLater(() => {
      centerOn(Math.round(gx(bellA[0]) - 1.5), Math.max(1, Math.round(gz(bellA[2]) + 2.6)), 1.0);
      // "Intruders!" is Jonah's line (2026-07-31) — the sentry names the threat,
      // PLANTED; the bubble finishes fading BEFORE his feet move.
      // The face is the painted militia portrait every other speaking townsman
      // uses — same wool cap, red scarf and pit-lamp this sentry wears. It was
      // pointed at his FIELD SPRITE, so the one bubble in the scene held a
      // shrunken battlefield figure where every other panel holds a portrait.
      bark({ name: 'Sentry', group: sentry.group, topY: sentry.topY }, 'Intruders!',
        portraitOf('guard'), 1600);
      runToBell();
    }, WB_ARRIVAL_HOLD)), WB_CURTAIN_HOLD);
    function runToBell() {
      cineLater(() => sentryWalk(bell.group.position.clone().add(new THREE.Vector3(0.7, 0, 0.4)), 1.35, () => {
        // three swings, three chimes — the encounter's namesake earns its title
        // card. The bell is HEARD, not captioned: the synthesized chime and the
        // swinging plate carry it, and the floated "CLANG!" that used to spell it
        // out is gone (Jonah, 2026-07-31).
        let swings = 0;
        const swing = () => {
          chimeBell();
          cineTween(0.42, p => { bell.mesh.rotation.z = Math.sin(p * Math.PI * 2) * 0.28; }, () => {
            bell.mesh.rotation.z = 0;
            if (++swings < 3) swing();
            else cineLater(() => {
              // the sentry bolts INTO the shaft — he is running to FETCH the
              // rescue crew, and out of that same darkness they will come
              sentryWalk(wbFloorPos(6.0, -0.4), 0.85, () => wbRetireActor(sentry));
              // He keeps walking while he fades, so the opacity is re-applied every
              // frame: each new gait frame resets the material the walk cycle set.
              // alphaTest has to come down with it or the figure would pop out at
              // the cutoff instead of thinning into the dark.
              cineTween(0.85, p => {
                const o = 1 - Math.max(0, (p - 0.55) / 0.45);
                for (const m of sentry.mats) {
                  m.transparent = true; m.opacity = o; m.alphaTest = Math.min(0.4, o * 0.4);
                }
              });
              cineLater(pairEntrance, 1050);
            }, 420);
          });
        };
        cineLater(swing, 200);
      }), 2100);   // bark holds 1600ms + 300ms fade + a breath, THEN he runs
    }
    function pairEntrance(){
      centerOn(6, 3, 1.05);
      ragna.group.visible = true;
      skarn.group.visible = true;
      moveUnit(ragna, [[6, 1], [6, 2]], () => { ragna.cutscene = false; faceToward(ragna, 6, 9); });
      cineLater(() => moveUnit(skarn, [[7, 1], [7, 2]], () => {
        skarn.cutscene = false; faceToward(skarn, 7, 9);
        cueBattleMusic();                    // Hoof and Horn lands with the pair on the field
        cineLater(finish, 550);
      }), 380);
    }
  }
  // During the scripted cry the reprisals are HELD, so the captain's rage line
  // can land between the hurt and the answer (Jonah's beat order); the next fx
  // beat releases them onto Seira. The hold is an explicit call on the registry
  // that owns reactions, not a global the mechanic has to remember to consult —
  // which is what made it possible for a dead timer chain to disable
  // cross-retaliation for the rest of the battle without anything noticing.
  function warbellScriptedCry(u, finish) {
    // THE HEALTH BARS COME UP HERE (Jonah, 2026-08-05). This beat is where the
    // encounter stops being an entrance and becomes a fight: Seira steps out,
    // Cries, takes both retaliations and is left near death, and the Heal that
    // follows is the answer to a number the player has to have watched fall.
    // Everything before it — the bell, the sentry, the trio walking in, Ragna
    // and Skarn coming out of the shaft — is staging, and carries no bars.
    // NUMERALS DO NOT COME WITH THEM: see `turnNumeralOf` in the page. A number
    // beside a bar is a claim about a queue that is running, and no queue runs
    // until round 1; the bars are about damage, which is real from this beat on.
    beginScriptedCombat();
    reactions.suspend(['bond-retaliation']);
    centerOn(6, 4, 0.9);
    moveUnit(u, WB_CRY_PATH, () => {
      castCry(u, () => cineLater(finish, 600));
    });
  }
  function warbellReprisalBeat(finish) {
    const held = reactions.resume();
    const seira = byName('Seira');
    const expected = seira.hp - held.length * revengeDamage();
    for (const record of held) fireReaction(record, unitById(record.unitId));
    // Hand the beat back when the stones have actually landed — their rAF
    // flight time varies wildly with machine load, so a fixed hold either
    // drags the scene or cuts it — with a hard cap as the backstop.
    const t0 = performance.now();
    const settled = () => {
      if (seira.hp <= expected || performance.now() - t0 > 6000) { cineLater(finish, 400); return; }
      later(settled, 150);   // the 6s cap is a machine-load backstop and never scales
    };
    settled();
  }
  function warbellSwitchBeat(u, finish) {
    switchForm(u, WB_STRESS_FORM);
    cineLater(finish, 900);
  }
  // Scripted opening per Jonah's spec: Seira opens on 3 TP, declares the first
  // move, wades in, and Cries; both bonded enemies answer with fixed revenge;
  // Cassien's rebuke stresses her 4 → 2. The lines below are Jonah-approved as
  // of 2026-07-31 and mirror `story/warning-bell-draft.md` verbatim; edit there
  // first. Beat order is spec — reordering breaks the mechanics it narrates.
  function warbellOpeningBeats() {
    const seira = byName('Seira');
    return [
      { kind: 'fx', skippable: false, run: finish => warbellBellEntrance(finish) },
      { kind: 'line', who: 'Ragna', text: 'Ha! Would you look at that – the Empire feeds us now! Three soldiers, armor and all. Skarn loves the crunchy ones.' },
      { kind: 'line', who: 'Seira', text: 'Let me open. Mournful Cry answers both at once.' },
      { kind: 'line', who: 'Cassien', text: 'Seira, hold position—' },
      { kind: 'fx', skippable: false, run: finish => warbellScriptedCry(seira, finish) },
      { kind: 'line', who: 'Ragna', text: 'You came into MY cave. You hurt MY beast.' },
      { kind: 'fx', skippable: false, run: finish => warbellReprisalBeat(finish) },
      { kind: 'line', who: 'Seira', text: '...Both of them. At once.' },
      { kind: 'line', who: 'Cassien', text: 'That was pride, not judgment.' },
      { kind: 'line', who: 'Cassien', text: "You made yourself the center of this and now you're bleeding for it." },
      { kind: 'fx', skippable: false, run: finish => warbellSwitchBeat(seira, finish) },
      { kind: 'line', who: 'Seira', text: 'Then it is time for me to focus on helping others.' },
    ];
  }
  // The prototype ends on a plain card: Battle 1's victory staging (post-battle
  // script, mine transition) belongs to Part I and never runs here.
  //
  // Both arguments are the campaign's, and both default to the prototype's own
  // ending, so an encounter played alone is untouched. `endBeats` is what the
  // flow controller wants shown instead of the prototype card — Part I's real
  // "to be continued" now that the game runs on past the mine — and `onEnd`
  // fires when the player clicks through it. Passed as arguments rather than as
  // context fields because they belong to the RUN, not to the staging: the same
  // constructed scene ends differently depending on how it was entered.
  function warbellVictory(endBeats = null, onEnd = null) {
    haltBattle();
    const beats = endBeats || [{ kind: 'tbc', text: 'End of Encounter Prototype' }];
    later(() => startDialogue(beats, onEnd || (() => {})), 700);
  }

  return {
    // the camera's opening frame, composed under the entry card
    entryCenterZ: WB_ENTRY_CENTER_Z,
    // live lists the page's render loop and debug API read; a retired actor
    // leaves `actors` in place, so the identity of these arrays is the seam
    actors: cineActors,
    billboards: cineBillboards,
    beats: warbellOpeningBeats,
    victory: warbellVictory,
  };
}
