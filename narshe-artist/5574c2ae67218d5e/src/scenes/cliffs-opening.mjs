/**
 * Cliffs opening — the overlook above Narshe, where the script opens.
 *
 * A second diorama built with the same idiom as the town (boxy rock columns
 * with snow caps, cone pines, plank shacks) but graded for the reference
 * shot: dusk purple sky, near-black craggy masses, one pale snow crest
 * threading between them, and the town itself only as a scatter of lit
 * windows far below beyond the overlook. Nothing here is walkable — the
 * three imperials are display figures, not units, so the battle layer never
 * learns this scene exists.
 *
 * This module owns the cliffs' own geometry and dusk materials, its three
 * display actors (`addActor`/`townLookYaw`), and the cliff-exit machinery
 * that walks them off the bottom of frame at the end of the opening
 * dialogue (`startCliffExit`/`stepCliffExit`/`departCliffs`) — two halves
 * that sat far apart in the page (construction near the top, exit logic
 * near the bottom) because the exit logic is itself a late-file, per-frame
 * concern, but they only ever operate on the same `cliffActors`.
 *
 * What stays on the page: `showScene`/`applyMood`/`MOOD` (shared by town,
 * cliffs, and the mine, so cliffs is just one of their callers), `sceneFade`/
 * `enterTown`/`transitionToMine` (generic scene-transition fade glue every
 * scene uses), `frameConfrontation` (the TOWN battle's own push-in, not a
 * cliffs concern even though it runs right after the cliffs fade out), and
 * `openingBeats()` (which interleaves cliffs staging with the gate battle's
 * own dialogue, so it belongs to neither scene alone). Settling the opening
 * camera orbit without a glide is one exact three-statement idiom
 * (`azimuth = azTarget = azFrom = angle; azT = 1;`) repeated at every scene
 * entry point in the page, so the page hands over just that as `setAzimuth`
 * rather than the four variables themselves.
 */

const CONTEXT_FIELDS = [
  'THREE',              // scene graph constructors (injected, never imported)
  'scene',              // the THREE.Scene cliffsWorld and its lights attach to
  'box',                // (w,h,d,mat,x,y,z,{shadow,group}) -> kit-geometry mesh
  'mulberry',           // seeded PRNG, for the dusk rock/snow/town textures
  'makeTex',            // canvas -> THREE.CanvasTexture
  'texSnow',            // the town's own snow texture, dusk's non-authored fallback
  'spriteFigure',       // (kind, pal) -> procedural figure + materials
  'actorSetFrame',      // (actor, frame) -> draw a gait/art frame
  'warmLight',          // (x,y,z,intensity,dist,bucket) -> lit-window PointLight
  'cliffLights',        // the shared bucket applyMood toggles by scene
  'HU',                 // one height unit
  'topThick',           // world-space thickness of a tile's top slab
  'authoredTerrain',    // Battle 1's accepted terrain sheets, or null
  'cliffsProcedural',   // ?cliffs=procedural: force the painted dusk set
  'tuneEnabled',        // ?tune=1: show the live cliffs-tint dev panel
  'warbell',            // WARBELL: the tune panel never shows outside Battle 1
  'reviewMine',         // REVIEW_MINE: same gating as WARBELL for the panel
  'reviewBattle',       // REVIEW_BATTLE: same gating as WARBELL for the panel
  'introMorning',       // ?intro=morning tint set
  'introDawn',          // ?intro=dawn tint set
  'createCliffsTintPanel', // the dev panel factory (src/ui/tuning-panels.mjs)
  'sceneName',          // () -> the page's current scene name (panel lifetime)
  'setWalking',         // (actor, on) -> gait on/off
  'center',             // CENTER: the shared camera-rig look-at point
  'clampCenter',        // clamp CENTER to the current scene's bounds
  'camera',             // the tactical camera (zoom, projection, matrix)
  'placeCamera',        // apply camera/orbit state to the THREE camera
  'setAzimuth',         // (angle) -> snap the orbit angle with no glide
  'artHeight',          // world height of a display-actor's art plate
  'showScene',          // (name) -> switch the visible diorama layer
  'sceneFade',          // (done) -> the shared fade-through-black transition
];

export function createCliffsOpening(context) {
  const missing = CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('cliffs opening: missing context field(s) ' + missing.join(', '));
  }
  const {
    THREE, scene, box, mulberry, makeTex, texSnow, spriteFigure, actorSetFrame,
    warmLight, cliffLights, HU, topThick, authoredTerrain, cliffsProcedural,
    tuneEnabled, warbell, reviewMine, reviewBattle, introMorning, introDawn,
    createCliffsTintPanel, sceneName, setWalking, center, clampCenter, camera,
    placeCamera, setAzimuth, artHeight, showScene, sceneFade,
  } = context;

  const CW = 10, CD = 14;                     // cliffs grid (the town's is 12x18)
  const CLIFF_BASE = 7;                       // a high shelf above the town basin
  const CLIFF_PATH_END = 14;
  const TOWN_BASIN_Y = -1.2;
  const TOWN_SETBACK_Z = 22.0;
  const TOWN_BASIN_LOCAL_Z = 2.8;
  const TOWN_HOUSE_NEAR_Z = TOWN_SETBACK_Z;
  const cliffsWorld = new THREE.Group();
  scene.add(cliffsWorld);

  // dusk rock: the same strata language as texRock, drifted purple and much darker
  const texRockDusk = makeTex((ctx, s) => {
    const r = mulberry(77);
    ctx.fillStyle = '#4a4058'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 46; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(26,20,36,0.34)' : 'rgba(96,84,118,0.20)';
      ctx.beginPath();
      const cx = r() * s, cy = r() * s, rad = 8 + r() * 34;
      ctx.moveTo(cx + rad, cy);
      for (let a = 0.6; a < 6.3; a += 0.6) ctx.lineTo(cx + Math.cos(a) * rad * (0.6 + r() * 0.7), cy + Math.sin(a) * rad * (0.6 + r() * 0.7));
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(16,12,24,0.5)'; ctx.lineWidth = 2;
    for (let i = 0; i < 18; i++) {                       // bedding planes, roughly horizontal
      ctx.beginPath();
      let x = r() * s, y = r() * s; ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += 30 + r() * 30; y += (r() - 0.5) * 16; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });
  const texBasinDusk = texRockDusk.clone();
  texBasinDusk.wrapS = texBasinDusk.wrapT = THREE.RepeatWrapping;
  texBasinDusk.repeat.set(8, 8);
  texBasinDusk.needsUpdate = true;
  const texTownSnow = makeTex((ctx, s) => {
    const r = mulberry(90210);
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(137,131,160,0.92)';
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      const rad = 0.39 + (r() - 0.5) * 0.08;
      const x = s * (0.5 + Math.cos(a) * rad);
      const y = s * (0.5 + Math.sin(a) * rad * 0.68);
      if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(205,201,225,0.045)' : 'rgba(55,47,71,0.04)';
      ctx.beginPath();
      ctx.arc(s * (0.16 + r() * 0.68), s * (0.25 + r() * 0.5), 2 + r() * 13, 0, 7);
      ctx.fill();
    }
  });
  // Stopgap intro reskin (Jonah, 2026-07-30): the cliffs consume the ACCEPTED
  // narshe-gate sheets under this scene's dusk grade — the sheets stay in their
  // neutral daylight key and the tint supplies the hour. Bespoke cliffs sheets
  // from Codex may supersede this; ?cliffs=procedural restores the painted set.
  const CLIFFS_AUTHORED = !!authoredTerrain && !cliffsProcedural;
  const texBasinAuthored = CLIFFS_AUTHORED ? authoredTerrain.rock.clone() : null;
  if (texBasinAuthored) {
    texBasinAuthored.wrapS = texBasinAuthored.wrapT = THREE.RepeatWrapping;
    texBasinAuthored.repeat.set(8, 8);
    texBasinAuthored.needsUpdate = true;
  }
  // One tint set per intro hour: the dusk values are the committed look, the
  // morning set lifts terrain and town together into the battle's daylight key
  // so the composition stays consonant while brightening (Jonah's ask).
  const CTINT = introMorning
    ? { rock: 0xc3cadd, rockDark: 0x3c4054, basin: 0x9aa2b8, snow: 0xf2f5ff,
        wall: 0x4a4f6b, roof: 0x555d7d, roofSnow: 0xc2c9de, beam: 0x2c2f40 }
    : introDawn
    ? { rock: 0xaea6c8, rockDark: 0x322c44, basin: 0x6e6484, snow: 0xe6e4f8,
        wall: 0x343050, roof: 0x413c5c, roofSnow: 0x9c9fc4, beam: 0x201c2e }
    : { rock: 0x9a8fb4, rockDark: 0x2b2438, basin: 0x625671, snow: 0xd8d6f2,
        wall: 0x2b2740, roof: 0x37324e, roofSnow: 0x8c8fb6, beam: 0x1c1826 };
  const matC = {
    rock:     new THREE.MeshStandardMaterial({ map: CLIFFS_AUTHORED ? authoredTerrain.rock : texRockDusk,
                                               color: CLIFFS_AUTHORED ? CTINT.rock : 0xffffff, roughness: 1 }),
    rockDark: new THREE.MeshStandardMaterial({ color: CTINT.rockDark, roughness: 1 }),
    basin:    new THREE.MeshStandardMaterial({ map: CLIFFS_AUTHORED ? texBasinAuthored : texBasinDusk,
                                               color: CTINT.basin, roughness: 1 }),
    basinSnow:new THREE.MeshStandardMaterial({
      map: texTownSnow, transparent: true, alphaTest: 0.02, depthWrite: false, roughness: 1,
    }),
    // the crest is the brightest thing in the reference shot by a wide margin —
    // everything else is a silhouette around it
    snow:     new THREE.MeshStandardMaterial({ map: CLIFFS_AUTHORED ? authoredTerrain.snow : texSnow,
                                               color: CTINT.snow, roughness: 0.95 }),
    wall:     new THREE.MeshStandardMaterial({ color: CTINT.wall, roughness: 1 }),
    roof:     new THREE.MeshStandardMaterial({ color: CTINT.roof, roughness: 1 }),
    roofSnow: new THREE.MeshStandardMaterial({ color: CTINT.roofSnow, roughness: 1 }),
    // the lamps stay lit in either hour — a mining town on a dark winter
    // morning keeps them burning, and they are the intro's best charm
    win:      new THREE.MeshStandardMaterial({ color: 0xffc078, emissive: 0xff9430, emissiveIntensity: 1.9 }),
    beam:     new THREE.MeshStandardMaterial({ color: CTINT.beam, roughness: 1 }),
  };
  if (CLIFFS_AUTHORED && !warbell && !reviewMine && !reviewBattle && tuneEnabled) {
    // Dev chrome only. The panel owns its dials; the page owns which materials
    // they write and — below — the fact that this one lives exactly as long as
    // the cliffs scene does.
    const { element: panel } = createCliffsTintPanel({
      document, THREE,
      tints: { rock: CTINT.rock, basin: CTINT.basin, snow: CTINT.snow },
      materials: { rock: matC.rock, basin: matC.basin, snow: matC.snow },
    });
    document.body.appendChild(panel);
    let sawCliffs = false;
    const watch = setInterval(() => {
      if (sceneName() === 'cliffs') sawCliffs = true;
      else if (sawCliffs) { panel.remove(); clearInterval(watch); }
    }, 600);
  }

  // over_narshe.png supplies the composition: one continuous snow pass between
  // grounded canyon walls, opening onto the town basin at screen-top. The camera
  // looks straight along +z, leaving -z as the clear lower-screen exit.
  function cliffPathX(z) { return 4.15 + Math.sin((z + 1) * 0.24) * 0.45; }
  const cliffTopY = CLIFF_BASE * HU + topThick;          // world y the figures stand on
  // The overlook is a held composition, not a traversal map. Five shelf slices
  // between the trio and the lower lip are enough to establish the pass; the old
  // shelf continued to z=-2 and made the eventual exit feel like a second scene.
  // From the nearest actor at z=10.4, this is about 40% of that former run.
  const CLIFF_PATH_START = 5;

  {
    // Overlapping slices share one height and read as a single natural shelf, not
    // the detached staircase of the discarded concept.
    const passBaseH = CLIFF_BASE * HU;
    for (let z = CLIFF_PATH_START; z <= CLIFF_PATH_END; z++) {
      const c = cliffPathX(z);
      const width = z >= 9 ? 5.8 : 4.8 + Math.sin(z * 0.4) * 0.25;
      box(width, passBaseH, 1.06, matC.rock, c, passBaseH / 2, z + 0.5,
        { group: cliffsWorld });
      box(width + 0.03, topThick, 1.07, matC.snow, c,
        passBaseH + topThick / 2 - 0.002, z + 0.5, { group: cliffsWorld });
    }

    // Connected, overlapping rock masses form the canyon shoulders. They are all
    // grounded from y=0 and deliberately bare on top like the reference's dark
    // walls; the snow belongs to the pass, not to giant rectangular platforms.
    for (const [x, z, w, d, h] of [
      [-0.1, 7.5, 3.7, 4.3, 3.7],
      [0.2, 11.3, 3.2, 4.1, 3.2],
      [8.3, 7.8, 3.6, 4.3, 3.5],
      [8.0, 11.5, 3.1, 4.0, 3.0],
    ]) {
      box(w, h, d, matC.rock, x, h / 2, z, { group: cliffsWorld });
    }
    // ---- Narshe in the basin: large enough to be the destination, centred above
    // the trio on screen, and separated from them by a visible drop.
    const townBelow = new THREE.Group();
    const tr = mulberry(1207);
    for (let i = 0; i < 28; i++) {
      const bx = tr() * 7.2, bz = tr() * 5.7, s = 0.42 + tr() * 0.20;
      const g = new THREE.Group();
      box(1.5 * s, 0.85 * s, 1.2 * s, matC.wall, 0, 0.42 * s, 0, { group: g, shadow: false });
      for (const sd of [-1, 1]) {
        const plane = box(1.05 * s, 0.09, 1.45 * s, matC.roof, sd * 0.4 * s, 1.08 * s, 0, { group: g, shadow: false });
        plane.rotation.z = -sd * 0.62;
        const sn = box(1.0 * s, 0.07, 1.5 * s, matC.roofSnow, sd * 0.4 * s, 1.15 * s, 0, { group: g, shadow: false });
        sn.rotation.z = -sd * 0.62;
      }
      for (let k = 0; k < 1 + (tr() > 0.4 ? 1 : 0); k++)                 // warm windows face the approaching party
        box(0.24 * s, 0.24 * s, 0.05, matC.win, (tr() - 0.5) * 0.8 * s, 0.5 * s, -0.63 * s, { group: g, shadow: false });
      g.position.set(bx, 0, bz);                   // every foundation sits on the basin floor
      g.rotation.y = (tr() - 0.5) * 0.14;
      townBelow.add(g);
    }
    // The lower valley continues beyond every edge of the shot and stays dusk-
    // dark, so it cannot merge visually with the bright overlook shelf.
    const basinGround = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), matC.basin);
    basinGround.rotation.x = -Math.PI / 2;
    basinGround.position.set(3.6, -0.08, TOWN_BASIN_LOCAL_Z + 8);
    basinGround.receiveShadow = true;
    townBelow.add(basinGround);
    const townClearing = new THREE.Mesh(new THREE.PlaneGeometry(13.2, 9.2), matC.basinSnow);
    townClearing.rotation.x = -Math.PI / 2;
    townClearing.position.set(3.6, -0.035, TOWN_BASIN_LOCAL_Z);
    townClearing.receiveShadow = true;
    townBelow.add(townClearing);
    // The basin starts beyond the far edge of the shelf and substantially below
    // it. No house or town-ground mesh overlaps the cliff in either axis.
    townBelow.position.set(0.6, TOWN_BASIN_Y, TOWN_SETBACK_Z);
    cliffsWorld.add(townBelow);
    for (const [lx, lz] of [[2.0, 23.5], [4.2, 25.5], [1.8, 27.0], [5.0, 23.7]])
      warmLight(lx, TOWN_BASIN_Y + 0.35, lz, 2.7, 7, cliffLights);
  }

  // ---- display figures: the same painted plates the battle uses, with none of the
  // unit machinery behind them (no HP bar, no disc, no turn state).
  const cliffActors = [];
  function addActor(name, kind, pal, x, z, ry) {
    const { group: fig, mats, mesh } = spriteFigure(kind, pal);
    const group = new THREE.Group();
    group.add(fig);
    group.position.set(x, cliffTopY, z);
    group.rotation.y = ry;
    group.visible = false;                    // raised with the units, once art has decoded
    cliffsWorld.add(group);
    const a = { name, kind, pal, team: 'player', group, fig, sprite: mesh, mats,
                flip: 1, art: null, artFace: 'front', artKey: 'front',
                walking: false, walkT: 0, walkDist: 0, lastX: x, lastZ: z,
                cutscene: true };            // scripted staging: always walks, always may use the profile
    a.setFrame = f => actorSetFrame(a, f);
    cliffActors.push(a);
    return a;
  }
  // The held composition looks over the town rather than toward the camera. Their
  // exit later turns them toward the open lower lip as a separate staging beat.
  const CLIFF_TOWN_LOOK = { x: 4.2, z: 25.5 };
  function townLookYaw(x, z) {
    return Math.atan2(CLIFF_TOWN_LOOK.x - x, CLIFF_TOWN_LOOK.z - z);
  }
  addActor('Cassien', 'knight', 'cassien', 3.5, 10.4, townLookYaw(3.5, 10.4));
  addActor('Brecht',  'archer', 'brecht',  4.6, 10.9, townLookYaw(4.6, 10.9));
  addActor('Seira',   'mage',   'seira',   4.1, 11.9, townLookYaw(4.1, 11.9));

  // The cliffs beat is a cutscene, so it borrows the battle's camera machinery and
  // nothing else: the same glide/zoom tweens, the same bubbles, no grid, no turns.
  const CLIFF_WIDE = 0.92, CLIFF_CLOSE = 1.15, CLIFF_PUSH = 3.2;
  // Unused by any current caller (nothing composes the live trio position into a
  // shot), kept alongside overlookCenter as the pair it was written with rather
  // than dropped in a behavior-preserving move.
  function trioCenter() {
    const p = cliffActors.reduce((s, a) => ({ x: s.x + a.group.position.x, z: s.z + a.group.position.z }),
                                 { x: 0, z: 0 });
    return { x: p.x / cliffActors.length - 0.5, z: p.z / cliffActors.length - 0.5 };
  }
  function overlookCenter() {
    return { x: 3.7, z: 12.5 };        // centerOn adds half a tile: (4.2, 13.0)
  }
  function enterCliffs() {
    showScene('cliffs');
    // Look straight up the pass: canyon walls remain on the screen edges, Narshe
    // sits at screen-top, and the open lower lip is the party's exit.
    setAzimuth(Math.PI);
    const c = overlookCenter();
    center.set(c.x + 0.5, 1.8, c.z + 0.5);
    clampCenter();
    camera.zoom = CLIFF_WIDE; camera.updateProjectionMatrix();
    placeCamera();
  }

  // ---------------------------------------------------------------- opening scene
  // The reference composition is a held overlook: the trio talk in place, then move
  // toward the foreground/down-screen only after Cassien settles the argument.
  // The path's x-meander still guides their one-way departure.
  const CLIFF_EXIT_SPEED = 1.05;        // ~2.1 stride cycles/sec: purposeful, not fast-forward
  const CLIFF_EXIT_MAX = 8.0;           // safety cap; normal completion is screen-space
  // A quiet crane toward Narshe lets the actors cover only 1 / (1 + 1.5) = 40%
  // of the former ground distance while still walking completely through the
  // lower frame. Their own pace and gait cadence stay untouched.
  const CLIFF_EXIT_CAMERA_LEAD = 1.5;
  // Begin only on stable contact phases. Third-cycle offsets dropped Brecht and
  // Seira directly into up/passing drawings when the held tableau released,
  // which read as a visual pop beside Cassien's contact start. The opposing
  // half-cycle still keeps the three bodies from feeling mechanically identical.
  const CLIFF_GAIT_OFFSETS = [0, 0.5, 0];
  let cliffExit = null;
  let cliffExitCompletedOffscreen = false;
  function cliffPathXAt(z) {
    const z0 = Math.floor(z), f = z - z0;
    return cliffPathX(z0) * (1 - f) + cliffPathX(z0 + 1) * f;
  }
  function startCliffExit(done) {
    if (cliffExit || !cliffActors.length) return;
    cliffExitCompletedOffscreen = false;
    const home = cliffActors.map(a => ({ x: a.group.position.x, z: a.group.position.z }));
    cliffExit = { home, t: 0, done, cameraZ: center.z };
    cliffActors.forEach((a, i) => { a.gaitOffset = CLIFF_GAIT_OFFSETS[i] || 0; });
    for (const a of cliffActors) setWalking(a, true);
  }
  function stopCliffExit() {
    if (!cliffExit) return;
    for (const a of cliffActors) setWalking(a, false);
    cliffExit = null;
  }
  function stepCliffExit(dt) {
    const exit = cliffExit;
    if (!exit || !cliffsWorld.visible) return;
    exit.t = Math.min(CLIFF_EXIT_MAX, exit.t + CLIFF_EXIT_SPEED * dt);
    cliffActors.forEach((a, i) => {
      const h = exit.home[i], z = h.z - exit.t;
      a.group.position.z = z;
      a.group.position.x = h.x + (cliffPathXAt(z) - cliffPathXAt(h.z)) * 0.5;
      a.group.position.y = cliffTopY;
      a.group.rotation.y = Math.PI;                     // -z projects down toward the foreground
    });
    // Move the lens toward the destination as the formation advances toward us.
    // This is deliberately scripted outside clampCenter(): the tactical camera
    // limits do not describe a cutscene crane over the town basin.
    center.z = exit.cameraZ + exit.t * CLIFF_EXIT_CAMERA_LEAD;
    placeCamera();
    camera.updateMatrixWorld();
    const allBelowFrame = cliffActors.every(a => {
      const p = new THREE.Vector3(
        a.group.position.x, a.group.position.y + artHeight * 0.5, a.group.position.z,
      ).project(camera);
      return p.y < -1.16;
    });
    if (allBelowFrame || exit.t >= CLIFF_EXIT_MAX) {
      cliffExitCompletedOffscreen = allBelowFrame;
      const done = exit.done;
      stopCliffExit();
      if (done) done();
    }
  }
  function departCliffs(done) {
    let fade = null;
    const beginFade = () => { fade = sceneFade(done); };
    startCliffExit(beginFade);
    return { skip: () => {
      if (fade) { fade.skip(); return; }
      stopCliffExit();
      fade = sceneFade(done);
      fade.skip();
    } };
  }

  return {
    world: cliffsWorld,
    grid: { width: CW, depth: CD },
    actors: cliffActors,
    overlookCenter,
    pushTime: CLIFF_PUSH,
    closeZoom: CLIFF_CLOSE,
    enterCliffs,
    departCliffs,
    stopCliffExit,
    stepCliffExit,
    // stepCliffs's debug hook reports the exit's raw, unrounded progress.
    exitProgress: () => cliffExit ? cliffExit.t : null,
    // __BATTLE.walk()'s cliffs-only fields; the generic walk-cycle numbers
    // (fps, contactHold, etc.) stay page state.
    debugState() {
      return {
        cliffExitSpeed: CLIFF_EXIT_SPEED,
        cliffExitCameraLead: CLIFF_EXIT_CAMERA_LEAD,
        cliffPathStart: CLIFF_PATH_START,
        cliffLayout: {
          shelfTop: +cliffTopY.toFixed(3),
          shelfFarZ: +(CLIFF_PATH_END + 1.03).toFixed(3),
          townHouseNearZ: TOWN_HOUSE_NEAR_Z,
          townBasinY: TOWN_BASIN_Y,
        },
        exit: cliffExit ? { t: +cliffExit.t.toFixed(3), maxDistance: CLIFF_EXIT_MAX } : null,
        exitCompletedOffscreen: cliffExitCompletedOffscreen,
      };
    },
  };
}
