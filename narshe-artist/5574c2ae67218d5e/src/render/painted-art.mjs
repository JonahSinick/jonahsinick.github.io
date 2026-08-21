/**
 * Painted character art: the drop-in plate sets from HANDOFF_ART.md, the view
 * selection that decides which plate a figure's facing calls for against the
 * live camera, the distance-driven walk cycle, and the loader that decodes the
 * whole cast while the title card holds.
 *
 * One module rather than a loader/runtime pair. The two halves share exactly
 * one thing — the mutable `art` plate map the loader fills and every runtime
 * query reads — and handing that map across a module boundary would be a
 * weaker seam than the one being replaced, not a stronger one. It stays
 * private here instead, which is also why the cutscene-actor glue
 * (`actorSetFrame`/`useActorArt`) moved in: those are painted-art operations,
 * and leaving them on the page would have forced `art`, `ART_BY_PAL`,
 * `sameQuad` and `viewNow` to become public just to serve them.
 *
 * Per-frame contract: `billboard()` calls `trackWalkDistance`, `pickView` and
 * `frameKeyFor` on every figure every frame. They are returned
 * as plain closures for the page to destructure once, so a frame costs the
 * same direct calls it did inline — no namespace lookup, no context rebinding,
 * and no allocation this module did not already do.
 *
 * The `loadProgress` bookkeeping is preserved exactly: `loadPlates()` reserves
 * the nominal estimate synchronously before its first await, signs the real
 * list against it once the manifest lands, registers discovered walk frames one
 * at a time on the probe path, and ticks once per plate including failures.
 * What the page kept is the step AFTER loading — applying the decoded sets to
 * units and cutscene actors, and the `finally` that reveals every figure
 * whether the art pass succeeded or threw — because that is scene
 * orchestration, not art.
 */

import {
  battleArtDeclarations,
  characterForm,
  getCharacter,
} from '../content/characters/index.mjs';

const CONTEXT_FIELDS = [
  'THREE',              // scene-graph constructors (injected, never imported)
  'renderer',           // for the max anisotropy a decoded plate is filtered at
  'camera',             // viewNow resolves a figure's facing against the live lens
  'loadProgress',       // the splash bar every loader registers its work with
  'setSpritePose',      // the page's painted-vs-procedural dispatch, called by useArt
  'sideViewInBattle',   // whether battle units may use the profile plate
  'battleWalkAnim',     // () -> bool, read LIVE: setBattleWalk must take effect next frame
  'reviewMine',         // ?scene=mine loads only the three arriving characters
  'warbell',            // the gallery battle also loads the review-candidate pair
  'battleDef',          // the resolved battle record: art names and form declarations
  'loadedPortrait',     // (key) -> a decoded portrait image, or undefined
  'overridePortrait',   // (key, img) -> point a character's portrait at a form's face
];

export function createPaintedArt(context) {
  const missing = CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('painted art: missing context field(s) ' + missing.join(', '));
  }
  const {
    THREE, renderer, camera, loadProgress, setSpritePose, sideViewInBattle,
    battleWalkAnim, reviewMine, warbell, battleDef, loadedPortrait,
    overridePortrait,
  } = context;

  // The drop-in contract from HANDOFF_ART.md: art/sprites/<name>_front|_back|_down.png.
  // Whatever is delivered replaces that character's procedural billboard on load;
  // whatever is missing keeps the placeholder, per character AND per pose. Detection
  // is one request for the directory — with art/ absent that is a single 404 and the
  // game is the pixel-art build untouched; with it present a static listing names the
  // files, so the usual case probes nothing that isn't there.
  const ART_NAMES = ['cassien', 'brecht', 'seira', 'miner', 'alchemist'];
  // three billboard VIEWS (which way the figure is turned) and, for each, an
  // optional walk. Every file is independent: a character can have a side view with
  // no side walk, front walks with no back walks, or nothing but _front.
  const ART_VIEWS = ['front', 'back', 'side'];
  // A view's gait is however many numbered walk frames were drawn for it, walk1
  // upward, contiguous. Nothing in the engine knows what N ought to be: two frames
  // and a fully drawn eight-frame stride are the same code path, and characters
  // with different counts share a scene.
  const ART_WALK_MAX = 8;
  const ART_POSES = ['front', 'back', 'down', 'side'];
  for (const view of ART_VIEWS) {
    for (let i = 1; i <= ART_WALK_MAX; i++) ART_POSES.push(view + '_walk' + i);
  }
  // Direct mine review only needs the three arriving characters and the view the
  // entrance actually shows. Avoid decoding the entire five-character, 100+ frame
  // battlefield set before the reviewer can see the new scene.
  // The gallery's bell sentry is a miner-set cutscene actor whoever is FIELDED,
  // and this file is where he is built, so this file guarantees his plates are
  // in the card's wait. Leaning on the battle descriptor alone made his art a
  // cross-file dependency: a browser holding a cached warning-bell.mjs next to a
  // fresh page would drop 'miner' from the list and drop him back to the
  // procedural placeholder, which is exactly what that looks like on screen.
  const ART_LOAD_NAMES = (reviewMine ? ['cassien', 'brecht', 'seira']
                                      : (battleDef.artNames || ART_NAMES))
    .concat(warbell ? ['miner'] : [])
    .filter((name, at, all) => all.indexOf(name) === at);
  const ART_LOAD_POSES = reviewMine
    ? ['front', 'back', ...Array.from({ length: ART_WALK_MAX }, (_, i) => 'back_walk' + (i + 1))]
    : ART_POSES;
  const ART_RUNTIME_MANIFEST = 'art/runtime/sprites/manifest.json';
  // Cutscene actors are palettes rather than characters — the bell sentry is a
  // miner-set body with no record — so they still map their ramp to a plate set
  // here. A UNIT gets its set from its character record instead.
  const ART_BY_PAL = { cassien: 'cassien', brecht: 'brecht', seira: 'seira', miner: 'miner', alch: 'alchemist',
                       defender: 'defender', cragbeast: 'cragbeast' };
  // A unit draws from the set its character record declares; a form switch
  // repoints that same field at the set drawn for the form.
  function artSetKey(u) { return u.artSet; }
  // the handoff draws characters filling ~90% of the image height, so a 1.63-unit
  // quad stands them ~1.5 units tall — the same eyeline the pixel sprites hold
  const ART_H = 1.63;
  // A figure with no `_down` plate is knocked over IN THE SCREEN PLANE — rolled
  // a quarter turn like a toppled standee — rather than tipped away from the
  // camera. See layDownArt for why the tip could not be made to read.
  const ART_FALL_ROLL = Math.PI / 2;
  const ART_DEAD = 0x8d8b93;                      // grey drained out of a downed figure
  const art = {};                                 // art name -> { front, back, down }
  const artBustCache = {};
  const artLoadErrors = [];

  // alpha sampled once into a small grid: enough to keep clicks honest without
  // re-reading a 1024px image on every pointer move
  function alphaSolid(img, cols = 32, rows = 40) {
    const c = document.createElement('canvas'); c.width = cols; c.height = rows;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, cols, rows);
    const d = x.getImageData(0, 0, cols, rows).data;
    return (ux, uy) => d[((Math.min(rows - 1, Math.max(0, Math.floor((1 - uy) * rows))) * cols) +
                          Math.min(cols - 1, Math.max(0, Math.floor(ux * cols)))) * 4 + 3] > 90;
  }
  // How much of a plate is actually PAINTED, as a fraction of its own width.
  // A plate is mostly transparent margin — a standing figure fills about two
  // thirds of its canvas and a fallen one, with its gear laid out beside it,
  // nearly all of it — so the canvas says nothing about how much floor a figure
  // appears to take up. Sampled from the same small alpha grid the click test
  // uses (32 columns, so ~3% precision), which costs one more read of an image
  // that has already been drawn to a canvas.
  function inkWidthFraction(img, cols = 32, rows = 40) {
    const c = document.createElement('canvas'); c.width = cols; c.height = rows;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, cols, rows);
    const d = x.getImageData(0, 0, cols, rows).data;
    let left = cols, right = -1;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (d[((row * cols) + col) * 4 + 3] <= 90) continue;
        if (col < left) left = col;
        if (col > right) right = col;
      }
    }
    if (right < 0) return 1;                       // fully transparent: no claim
    return (right + 1 - left) / cols;
  }
  // an <img>, not an ImageBitmap: WebGL cannot apply flipY to a bitmap upload, so a
  // bitmap texture arrives on the quad upside down, and the head crop below wants
  // the un-flipped source anyway
  function artFrame(img) {
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    // painted art, not pixel art: filter it, and mip it so the diorama's distant
    // ranks don't shimmer. Nearest here would just look like a JPEG artefact.
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    return {
      tex, img, aspect: img.naturalWidth / img.naturalHeight, solid: alphaSolid(img),
      ink: inkWidthFraction(img),
    };
  }
  // bar, reticle and poison drop ride the sprite's real top, so art of a different
  // height can never leave them floating or buried in the hat
  function layoutOverhead(u) {
    u.bar.position.y = u.topY + 0.232;
    u.aimMesh.position.y = u.topY - 0.068;
    u.poisonIcon.position.y = u.topY - 0.088;
  }
  // Frames are swapped several times a second during a walk, so the quad is rebuilt
  // only when the new frame is actually a different shape — a walk cycle drawn to
  // the same canvas as its idle costs one map assignment per frame and nothing else.
  // Compare against the dimensions actually APPLIED, not the unclamped ideal:
  // a plate narrowed to fit its one-tile footprint (Skarn) never matched
  // ART_H * aspect, so the geometry was disposed and rebuilt every walk frame.
  function sameQuad(mesh, f, w = ART_H * f.aspect, h = ART_H) {
    const p = mesh.geometry.parameters;
    return mesh.userData.artFrame &&
           Math.abs(p.height - h) < 0.002 && Math.abs(p.width - w) < 0.002;
  }
  function setArtFrame(u, f) {
    const m = u.sprite.material;
    m.map = f.tex; m.transparent = true; m.alphaTest = 0.4; m.needsUpdate = true;
    // A unit is one tile; a plate wider than artMaxW shrinks uniformly until it
    // fits its footprint (Skarn's broad silhouette was spilling over neighbors).
    let h = ART_H, w = ART_H * f.aspect;
    if (u.artMaxW && w > u.artMaxW) { h = u.artMaxW / f.aspect; w = u.artMaxW; }
    // A FALLEN PLATE IS SCALED LIKE EVERY OTHER ONE, and the reason is worth
    // recording, because the obvious fix here is wrong.
    //
    // Jonah reported dropped weapons reaching into the next square
    // (2026-08-03), and the naive answer — shrink a down plate until its
    // painted content fits a tile — was tried and reverted the same day, on his
    // second report: the fallen figures came out MUCH smaller than the standing
    // ones, which reads worse than the overhang did. Measured, that is exactly
    // what it did. Every down plate in the game, the militia's accepted ones
    // included, draws its figure at 60-64% of the standing figure's height on
    // an identically sized canvas — a kneel, at the SAME body scale, which is
    // what GPT's plates were built to preserve and what the militia has always
    // done. Scaling by painted width dropped that to 45-61% and did it
    // UNEVENLY, because it keys off how much gear a pose happens to lay out:
    // Brecht (no wide gear) kept his size while the miner lost a third of his.
    //
    // So the height stays the scale, the body scale is preserved by
    // construction, and the residual gear overhang is a look for Jonah to rule
    // on with correctly sized figures in front of him — not something to buy
    // by shrinking the character. `f.ink` is kept and reported through
    // `__BATTLE.art()` so that overhang can be MEASURED rather than argued.
    if (!sameQuad(u.sprite, f, w, h)) {
      u.sprite.geometry.dispose();
      u.sprite.geometry = new THREE.PlaneGeometry(w, h);
    }
    u.sprite.userData.artFrame = f;
    u.sprite.userData.artH = h;
    u.sprite.userData.solid = f.solid;
    // A frame change defines the whole pose, both angles: the standing plate is
    // square to the camera and upright, whatever the last one was doing.
    u.sprite.rotation.x = 0;
    u.sprite.rotation.z = 0;
    u.sprite.position.set(0, h / 2, 0);           // image bottom sits on the tile top
    u.topY = h;
    layoutOverhead(u);
  }
  // No `_down` was drawn for this character: knock the standing figure over and
  // put it in shadow.
  //
  // This is a FALLBACK and it looks like one. Jonah played the bell on
  // 2026-08-03 and reported the fallen reading as grey ghosts. Two things made
  // them ghosts, and each is fixed here.
  //
  //  1. HALF-TRANSPARENT. The body was drawn at opacity 0.55 with the floor
  //     showing through it. It is opaque now. The DARKENING stays: `color`
  //     multiplies the plate, so ART_DEAD is a figure in shadow rather than a
  //     desaturated one, and that half always read correctly.
  //  2. TIPPED AWAY FROM THE CAMERA, which cannot be made to work. The plate
  //     was rotated about its own x-axis, pivoting on the figure's feet so the
  //     head fell backwards. On an isometric camera "backwards" is up-screen,
  //     so the head lands at roughly the screen height it started at and the
  //     body stays exactly as tall as it was: at 65° it read as standing, and
  //     at 84° — measured, not guessed — it still did, only foreshortened.
  //     Laying it fully flat is worse still: coplanar with the tile it z-fights
  //     the floor and vanishes edge-on when the camera swings.
  //
  // So it is knocked over IN THE SCREEN PLANE instead, a quarter turn about the
  // view axis, like a standee pushed over. The plate stays square to the camera
  // — nothing is foreshortened, and it survives every camera rotation, because
  // its parent is billboarded and the roll rides along — and a horizontal
  // figure at ground level cannot be mistaken for a standing one. Which way it
  // falls alternates by unit id, so a line that goes down together does not
  // land in one direction like dominoes.
  //
  // The real fix is `_down` plates from the art lane. Characters that have one
  // (the militia's miner and alchemist sets) never come through here, and they
  // are the ones that look right. Cassien, Brecht and Seira have none, and
  // nobody in the warning bell does. Drawing them is Jonah's and the art lane's
  // call, not this module's.
  function layDownArt(u) {
    if (u.art.down) return;
    // After a quarter roll the plate's WIDTH is what stands off the ground, so
    // that is what centres the body on the tile it fell on.
    const width = u.sprite.geometry.parameters.width;
    u.sprite.rotation.x = 0;
    u.sprite.rotation.z = (u.id % 2 ? 1 : -1) * ART_FALL_ROLL;
    u.sprite.position.set(0, width / 2, 0);
    u.mats.forEach(m => {
      m.transparent = true; m.opacity = 1; m.alphaTest = 0.25;
      m.userData.baseColor = ART_DEAD; m.color.setHex(ART_DEAD);
    });
    u.topY = width;
  }
  // ---- view selection: which painted plate a figure's logical facing calls for
  // against the live camera. With only front/back drawn it is the original split —
  // facing toward the lens is the front, away is the back, with a deadband so a
  // side-on figure holds whatever it already had rather than flickering. With a
  // _side plate delivered the circle is quantised into three: the 90° wedge centred
  // on the camera is the front, the 90° wedge centred away is the back, and the two
  // quarters between them are the profile, mirrored for leftward vs rightward.
  // The wedge walls are pushed out past the nominal ±45°, because on this board the
  // nominal boundary is exactly where the art lives: the tactics camera sits on 45°
  // azimuth steps and units face grid axes, so a unit's facing is ALWAYS 45° or 135°
  // off the lens. A hard ±45° wall would leave every unit balanced on it, tipping
  // into the profile or out of it on nothing but how far off-centre the unit stands
  // (the lens is 54 units out, which is ±11° across the board). Widened, the 45°
  // lattice reads as a stable three-quarter front and the 135° one as a back — the
  // behaviour the game has always had — and the profile engages where it belongs:
  // on a facing genuinely square to the lens, which is the staged cutscene shot and
  // the sweep through a camera rotation.
  const VIEW_MARGIN = 20 * Math.PI / 180;
  const VIEW_FRONT = Math.PI / 4 + VIEW_MARGIN, VIEW_BACK = 3 * Math.PI / 4 - VIEW_MARGIN;
  function pickView(v, gy, yaw) {
    if (!v.art) return v.artFace;
    const rel = gy - yaw;
    let want;
    if (!v.art.side || (!v.cutscene && !sideViewInBattle)) {
      const toward = Math.cos(rel);
      want = toward < -0.06 ? 'back' : toward > 0.06 ? 'front' : v.artFace;
    } else {
      const d = Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel)));   // 0 = facing the lens
      want = d <= VIEW_FRONT ? 'front' : d >= VIEW_BACK ? 'back' : 'side';
    }
    if (v.art[want]) return want;
    // Undrawn view fallback: a missing BACK prefers the mirrored side profile
    // over the face-on front — a unit walking away must never appear to spin
    // toward the lens (Skarn, whose back plate is still queued with Codex).
    if (want === 'back' && v.art.side) return 'side';
    return 'front';                                                   // the one file that is required
  }
  function viewNow(v) {
    const yaw = Math.atan2(camera.position.x - v.group.position.x, camera.position.z - v.group.position.z);
    return pickView(v, v.group.rotation.y, yaw);
  }

  // ---- walk cycles. A view plays the frames drawn for it, walk1..walkN, in order
  // and on a loop, and the engine holds no opinion about N: two frames and a fully
  // drawn eight-frame stride are one code path, and a 2-frame character walks beside
  // an 8-frame one without either knowing.
  //
  // The phase is a function of GROUND COVERED, not of a clock: two full stride
  // cycles per tile, measured off the figure's own XZ travel. That is what makes the
  // feet stop skating — the plant lands at the same place on the ground at any
  // STEP_TIME, at any cutscene march speed, and the gait cannot drift out of sync
  // with the motion because it is not independently timed at all.
  const WALK_CYCLES_PER_TILE = 2;           // strides per tile: the one knob for gait cadence
  let WALK_FPS = 7;                         // only for a figure flagged walking that covers no
                                            // ground; nothing does that today (see frameKeyFor)
  // two drawn frames is the least that can read as a gait; a lone walk1 (a delivery
  // caught half-finished) is not animated, it just keeps the idle
  function walkFrames(v, view) { return walkFrameCount(v, view) >= 2; }
  // numbered walk frames drawn for this view, counted contiguously from 1
  function walkFrameCount(v, view) {
    let n = 0;
    while (n < ART_WALK_MAX && v.art && v.art[view + '_walk' + (n + 1)]) n++;
    return n;
  }
  // The loop this view plays: its own frames, in order, and nothing else. The idle
  // is a STANDING pose and is never dealt into a moving cycle — a walk that drops
  // back to the idle every other frame is the shuffle this replaced.
  function walkCycle(v, view) {
    const out = [];
    for (let i = 1, n = walkFrameCount(v, view); i <= n; i++) out.push(view + '_walk' + i);
    return out;
  }
  // Frames are not all worth the same distance. A foot resting on the ground reads
  // as a beat; the swing between beats reads as travel, and giving them equal share
  // makes a walk look metronomic. The contact frames — the first, and the one that
  // opens the second half-stride — are held longer by WALK_CONTACT_HOLD. At N=2
  // both frames are contacts, so that set stays evenly split.
  const WALK_CONTACT_HOLD = 1.25;
  const walkWeightCache = {};
  function walkWeights(n) {
    if (walkWeightCache[n]) return walkWeightCache[n];
    const w = new Array(n).fill(1);
    w[0] = WALK_CONTACT_HOLD;
    if (n > 1) w[Math.floor(n / 2)] = WALK_CONTACT_HOLD;
    // prefix sums over the unit cycle, so a fraction maps to a frame by one scan
    const total = w.reduce((s, x) => s + x, 0);
    const edge = [];
    let acc = 0;
    for (const x of w) { acc += x / total; edge.push(acc); }
    return (walkWeightCache[n] = { w, edge });
  }
  function anyWalkFrames(v) { return ART_VIEWS.some(view => walkFrames(v, view)); }
  function setWalking(v, on) {
    if (on && !v.walking) {                 // a fresh walk starts on a contact pose
      v.walkT = 0; v.walkDist = 0;
      v.lastX = v.group.position.x; v.lastZ = v.group.position.z;
    }
    v.walking = !!on;
  }
  // odometer: how far this figure's feet have carried it since the walk began. Read
  // off the live group position, so it counts battle steps, cutscene marches and
  // anything scripted later, all in the same units and with no per-caller wiring.
  function trackWalkDistance(v, dt) {
    v.walkT += dt;
    const dx = v.group.position.x - v.lastX, dz = v.group.position.z - v.lastZ;
    v.walkDist += Math.sqrt(dx * dx + dz * dz);
    v.lastX = v.group.position.x; v.lastZ = v.group.position.z;
  }
  // cutscene figures always walk; battle units walk only while the revert switch is
  // on. Read live rather than captured, so flipping the switch mid-step takes effect
  // on the next frame instead of at the next move.
  function gaitOn(v) { return v.cutscene || battleWalkAnim(); }
  // which phase of the stride this figure has walked itself into. Distance drives
  // it; the WALK_FPS clock is the fallback for a figure flagged walking that has
  // covered no ground at all, which nothing does today — it exists so an in-place
  // gait added later cannot freeze on a single contact pose.
  // How far through ONE stride this figure has walked, as a fraction in [0,1). This
  // is the quantity the whole gait hangs off, and deliberately so: it is a function
  // of ground covered and of nothing else — not of the view, not of the frame count,
  // not of a clock. That is what makes the phase survive a view switch (below) and
  // makes a 2-frame character and an 8-frame character agree about where in the
  // stride they are. gaitOffset is a head start, in cycles, so a column of figures
  // does not walk as one figure drawn three times.
  function walkFraction(v) {
    const cycles = v.walkDist > 0
      ? v.walkDist * WALK_CYCLES_PER_TILE + (v.gaitOffset || 0)
      : v.walkT * WALK_FPS / Math.max(1, walkCycle(v, v.artFace).length);
    return ((cycles % 1) + 1) % 1;
  }
  // that fraction, resolved against one view's frame count and hold weights
  function walkPhase(v, len) {
    const u = walkFraction(v), { edge } = walkWeights(len);
    for (let i = 0; i < len; i++) if (u < edge[i]) return i;
    return len - 1;
  }
  // the frame key this figure should be showing right now: the idle when it is
  // standing, otherwise the frame its own travel has walked it into. Turning to a
  // view with a different frame count re-resolves the SAME stride fraction against
  // the new cycle, so a facing change or a camera rotation never restarts the walk.
  /**
   * Yaw a figure's quad to the camera (Y only, so it stays upright), mirror it
   * for left/right, then put the right drawing on it — the view its facing calls
   * for, on the walk phase its movement calls for. `live` is false for a downed
   * unit, which keeps whatever frame it fell on.
   *
   * One rule for the battle units and every cutscene actor, which is why it
   * lives beside the view selection and gait tracking it calls rather than in
   * the page's per-frame loop.
   */
  function billboard(v, dt, live) {
    const gy = v.group.rotation.y;
    const yaw = Math.atan2(camera.position.x - v.group.position.x, camera.position.z - v.group.position.z);
    v.fig.rotation.y = yaw - gy;
    const side = Math.sin(gy - yaw);            // >0 when the figure faces screen-right
    if (Math.abs(side) > 0.12) v.flip = side < 0 ? -1 : 1;   // deadband: no flicker head-on
    if (v.walking) trackWalkDistance(v, dt);
    if (!v.art || !live) { v.sprite.scale.x = v.flip; return; }
    v.artFace = pickView(v, gy, yaw);
    // The accepted front and side plates lean toward image-left; their horizontal
    // mirror therefore runs opposite the logical screen direction. Rear plates
    // already read correctly under the old convention and deliberately keep it.
    // Treating front and back identically made face-on opponents appear to look
    // past one another even while their logical yaws were correct.
    v.sprite.scale.x = v.artFace === 'back' ? v.flip : -v.flip;
    const key = frameKeyFor(v);
    const f = v.art[key] || v.art[v.artFace] || v.art.front;
    if (f && f !== v.sprite.userData.artFrame) v.setFrame(f);
    v.artKey = key;
  }
  function frameKeyFor(v) {
    const view = v.artFace;
    if (!v.walking || !gaitOn(v) || !walkFrames(v, view)) return view;
    const cyc = walkCycle(v, view);
    const key = cyc[walkPhase(v, cyc.length)];
    return v.art[key] ? key : view;
  }
  function useArt(u) {
    const a = art[artSetKey(u)];
    if (!a || !a.front) return false;
    // choose the plate up front: art lands a second or two after the scene does, and
    // the imperials would otherwise flash their faces before the next frame turns them
    u.art = a; u.artFace = viewNow(u); u.artKey = u.artFace;
    setSpritePose(u, u.downed ? 'down' : 'stand');
    return true;
  }
  // A stress switch is a costume change, so a form wears its own plate SET rather
  // than its own frame: this repoints the unit at that set and nothing else. View
  // selection, the walk cycles and the frame-count-agnostic gait all read u.art,
  // so the new costume walks on its own frames from the next step — including a
  // set whose side cycle is two frames beside eight-phase front and back.
  //
  // Which set that is comes from the unit's character record, so a second
  // character's form needs a record edit and its art, not a case here. Returns
  // false when no art was drawn for the form, which leaves the unit in the plates
  // it already had rather than blanking it.
  function applyFormArt(u, formId) {
    const form = characterForm(u.charId, formId);
    if (!form || !art[form.art.set] || !art[form.art.set].front) return false;
    u.artSet = form.art.set;
    useArt(u);
    // A form repaints the whole character, so the override lands on the face the
    // character DECLARES rather than on its display name — a renamed unit keeps
    // its dialogue portrait.
    const painted = form.art.portrait && loadedPortrait(form.art.portrait);
    if (painted) overridePortrait(getCharacter(u.charId).art.portrait, painted);
    return true;
  }
  // portrait ladder: a delivered portraits/<key>.png wins, then a head crop off the
  // front sprite, then the procedural pixel bust
  function artBust(name, team) {
    const a = art[name];
    if (!a || !a.front) return null;
    const key = name + '|' + team;
    if (artBustCache[key]) return artBustCache[key];
    const src = a.front.img, S = 256;
    const w = src.naturalWidth, h = src.naturalHeight;
    const side = Math.min(w, h * 0.45);                       // the head sits in the top ~45%
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, team === 'player' ? '#2b3560' : '#452a34');
    g.addColorStop(1, '#10162c');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.drawImage(src, (w - side) / 2, h * 0.02, side, side, 0, 0, S, S);
    x.strokeStyle = 'rgba(8,10,20,0.65)'; x.lineWidth = 26;
    x.strokeRect(-6, -6, S + 12, S + 12);
    return (artBustCache[key] = c.toDataURL());
  }
  function artPortrait(key) {
    return key === 'guard' ? artBust('miner', 'enemy') : artBust(key, 'player');
  }
  // The accepted 1024px plates remain generation masters. A committed manifest
  // points the browser at compact derived plates, avoiding the 300MB+ decoded
  // footprint of loading every master merely to draw ~100px battlefield figures.
  // Older checkouts without a manifest retain the documented source-file fallback.
  // The art pass is most of the wait, and it cannot count its own work until the
  // runtime manifest arrives. It reserves a nominal count so the bar has a
  // truthful-enough denominator from the first frame, then reconciles below with
  // the real list. The nominal only has to be the right order of magnitude — the
  // displayed fraction never rewinds, so an over- or under-estimate costs at most
  // a brief pause, not a jump backwards. Measured: 107 plates for Battle 1 and 88
  // for the warning bell (which fields fewer of the manifest's names), so the
  // estimate straddles them.
  const ART_NOMINAL_ITEMS = 100;

  // Shared display-actor art glue: every scene's cutscene figures (cliffs, the
  // mine finale, the warning-bell gallery) are the same painted plates the
  // battle units use, so drawing a frame onto one and probing whether its
  // painted set decoded are both one function apiece, injected into each scene
  // module as context rather than defined inside any single one of them.
  function actorSetFrame(a, f) {
    const m = a.sprite.material;
    m.map = f.tex; m.transparent = true; m.alphaTest = 0.4; m.needsUpdate = true;
    if (!sameQuad(a.sprite, f)) {
      a.sprite.geometry.dispose();
      a.sprite.geometry = new THREE.PlaneGeometry(ART_H * f.aspect, ART_H);
    }
    a.sprite.userData.artFrame = f;
    a.sprite.position.set(0, ART_H / 2, 0);
  }
  function useActorArt(a) {
    const src = art[ART_BY_PAL[a.pal]];
    if (!src || !src.front) return false;
    a.art = src;
    a.artFace = viewNow(a); a.artKey = a.artFace;
    actorSetFrame(a, src[a.artFace] || src.front);
    return true;
  }

  // Decode every plate this battle fields. Resolves when the art pass has
  // settled; the page's own artReady wraps this with the apply-and-reveal step
  // and owns the finally that makes every figure visible either way.
  async function loadPlates() {
    loadProgress.expect('art', ART_NOMINAL_ITEMS);
    let manifestEntries = null;
    try {
      const res = await fetch(ART_RUNTIME_MANIFEST);
      if (res.ok) {
        const manifest = await res.json();
        if (manifest && manifest.schemaVersion === 1 &&
            Array.isArray(manifest.entries)) {
          manifestEntries = manifest.entries.filter(entry =>
            entry && ART_NAMES.includes(entry.name) &&
            ART_POSES.includes(entry.pose) &&
            typeof entry.file === 'string' &&
            /^[a-z0-9_]+\.png$/.test(entry.file));
        }
      }
    } catch (err) {
      // A missing runtime build is compatible with the original source loader.
    }
    let listed = null;
    try {
      if (manifestEntries) throw new Error('runtime manifest selected');
      const res = await fetch('art/sprites/');
      if (res.ok) {
        const txt = await res.text();
        const seen = new Set(Array.from(
          txt.matchAll(/[a-z]+_(?:front|back|down|side)(?:_walk[1-8])?\.png/g), m => m[0]));
        if (seen.size) listed = seen;            // a directory index names the files exactly
      }
      // Static hosts such as GitHub Pages do not expose directory indexes.
      // In that case, fall through to the bounded filename probe below.
    } catch (err) { /* manifest or filename probing below supplies the list */ }
    const decode = async path => {
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const img = new Image();
        img.decoding = 'async';
        img.src = path + (attempt ? (path.includes('?') ? '&' : '?') + 'retry=1' : '');
        try {
          await img.decode();
          if (!img.naturalWidth || !img.naturalHeight)
            throw new Error('decoded image has no dimensions');
          return img;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error('image decode failed');
    };
    const load = async (n, pose, path = 'art/sprites/' + n + '_' + pose + '.png',
                        expected = false) => {
      try {
        const img = await decode(path);
        (art[n] || (art[n] = {}))[pose] = artFrame(img);
        return true;
      } catch (err) {
        if (expected) artLoadErrors.push({
          name: n,
          pose,
          path,
          error: err && err.message ? err.message : String(err),
        });
        return false;                           // source fallback stays procedural
      } finally {
        loadProgress.tick('art');               // a plate that failed is a plate we stopped waiting on
      }
    };
    // A complete cast now contains well over a hundred large PNGs. Asking the
    // browser to fetch and decode all of them simultaneously caused occasional
    // frames to vanish under memory pressure, leaving a walk cycle randomly
    // short for that page load. A small worker pool keeps startup deterministic
    // without serialising the entire art pass.
    const loadBounded = async (items, limit = 8) => {
      let next = 0;
      const worker = async () => {
        while (next < items.length) {
          const [n, pose, path, expected] = items[next++];
          await load(n, pose, path, expected);
        }
      };
      await Promise.all(Array.from(
        { length: Math.min(limit, items.length) }, () => worker()));
    };
    const want = manifestEntries
      ? manifestEntries
          .filter(entry => ART_LOAD_NAMES.includes(entry.name) &&
            ART_LOAD_POSES.includes(entry.pose))
          .map(entry => [
            entry.name,
            entry.pose,
            'art/runtime/sprites/' + entry.file,
            true,
          ])
      : [];
    if (!manifestEntries) {
      for (const n of ART_LOAD_NAMES) for (const pose of ART_LOAD_POSES) {
        if (!listed || listed.has(n + '_' + pose + '.png')) want.push([n, pose]);
      }
    }
    loadProgress.expect('art', want.length - ART_NOMINAL_ITEMS);   // the real list replaces the estimate
    // Required standing plates are the cast, while walk frames are enhancement.
    // Load every character's base art before decoding a single optional gait
    // frame. Character-major ordering used to put Cassien/Brecht/Seira's 70+
    // walks ahead of the alchemist idle, so a memory-constrained browser could
    // show the final unit as its procedural placeholder despite valid files.
    const baseWant = want.filter(([, pose]) => !pose.includes('_walk'));
    const walkWant = want.filter(([, pose]) => pose.includes('_walk'));
    await loadBounded(baseWant);
    if (manifestEntries || listed) {
      await loadBounded(walkWant);
    } else {
      // No directory index to read, so the walk frames have to be discovered. They
      // are numbered contiguously by contract, which means the first miss is the
      // end of the cycle — walking up from walk1 and stopping there costs one 404
      // per view instead of eight.
      const cycles = ART_LOAD_NAMES.flatMap(n => ART_VIEWS.filter(view =>
        !reviewMine || view === 'back').map(() => [n, view]));
      let nextCycle = 0;
      const cycleWorker = async () => {
        while (nextCycle < cycles.length) {
          const [n, view] = cycles[nextCycle++];
          for (let i = 1; i <= ART_WALK_MAX; i++) {
            loadProgress.expect('art');         // discovered one at a time; register as we go
            if (!await load(n, view + '_walk' + i)) break;
          }
        }
      };
      await Promise.all(Array.from(
        { length: Math.min(4, cycles.length) }, () => cycleWorker()));
    }
    // ---- the defeated plates (GPT, 2026-08-03)
    //
    // Review candidates consumed in place, like the bonded pair's and the
    // Type-2 costume's: the masters stay under art/review/ and the game reads
    // the compact copies. Wiring them is DELIVERY, not machinery — a set that
    // owns a `down` frame stops taking the knocked-over fallback by itself,
    // because setSpritePose reaches for `art[set].down` first and layDownArt
    // returns immediately when it finds one. That is how the militia's accepted
    // miner_down and alchemist_down have always worked; the party simply had no
    // plate until now.
    //
    // A form switch is covered for free by the same rule, because a form wears
    // its own SET: a Seira downed as Type 2 is looked up as `seira_type2` and
    // finds the hooded plate, not the Type-4 one.
    //
    // Loaded LAST, after the accepted manifest, so that if an accepted
    // `<name>_down.png` is ever promoted into art/sprites the review candidate
    // still wins here — which is what "consumed in place" has to mean while a
    // plate is under review. Marked expected, so a missing one is reported
    // through __BATTLE.artErrors() (the gait gate fails on any entry) rather
    // than silently dropping a fallen figure back to the fallback.
    if (!reviewMine) {
      const DEFEATED = 'art/runtime/review/defeated_sprites/';
      const DEFEATED_PLATES = {
        cassien: 'cassien_down.png',
        brecht: 'brecht_down.png',
        seira: 'seira_down.png',
        seira_type2: 'seira_type2_down.png',
        // LOADED AND DORMANT, deliberately. The bonded pair LEAVE THE FIELD
        // when they fall (Jonah, 2026-07-31) — `downable: false`, so a fall
        // emits unitDefeated and killUnitView removes them — and nothing in a
        // battle ever poses them down. These two are here so the end-of-battle
        // tableau Jonah is still deciding on can use them without another art
        // cycle. Wiring them changes nothing that plays today.
        defender: 'ragna_down.png',
        cragbeast: 'skarn_down.png',
      };
      // Only what this battle actually fields: the accepted sets it loads, the
      // costume sets its roster declares, and the review pair when it is the
      // gallery. A plate for a set nobody fields would be a download for
      // nothing and a 404 channel entry if the file ever moved.
      const setsInPlay = new Set([
        ...ART_LOAD_NAMES,
        ...(warbell ? ['defender', 'cragbeast'] : []),
        ...battleArtDeclarations(battleDef).filter(decl => decl.sprites).map(decl => decl.set),
      ]);
      const defeatedWant = Object.entries(DEFEATED_PLATES)
        .filter(([set]) => setsInPlay.has(set))
        .map(([set, file]) => [set, 'down', DEFEATED + file, true]);
      loadProgress.expect('art', defeatedWant.length);
      await loadBounded(defeatedWant);
    }
    if (warbell) {
      // The bonded pair's plates are review candidates consumed in place —
      // never copied into art/sprites/ or the runtime manifest. Fronts are
      // required; sides and walks are the usual optional enhancement.
      const RV = 'art/runtime/review/bonded_defender_cragbeast/sprites/';
      // The defender consumes the aggressive-identity set (Codex, 562d00a):
      // rotations and two-frame review-pilot gaits keyed to the accepted
      // front. Files from the superseded pre-aggressive design are never
      // probed — mixing them flipped her identity mid-battle.
      const pairWant = [
        ['defender', 'front', RV + 'defender_type8_aggressive_candidate.png', true],
        ['defender', 'side', RV + 'defender_aggressive_side.png', false],
        ['defender', 'back', RV + 'defender_aggressive_back.png', false],
        // Skarn's front/back are the TRUE ON-AXIS plates (Codex, 9b2d037).
        // The originals were three-quarter rotations turned toward image-RIGHT,
        // against the house lean-LEFT convention, so the shared mirror rule
        // rendered him facing 180 degrees from his logical facing — he read as
        // staring at Ragna instead of the party. A head-on plate is symmetric
        // and therefore correct under the mirror either way. Side and the walk
        // cycles already followed the convention and are unchanged.
        // The FRONT is the stricter square pass (1702958): the first on-axis
        // plate killed the 180 error but still read turned on the board —
        // off-centre brow ridge, unequal horns, side kit showing. Jonah saw it
        // in play and the art lane had reached the same verdict independently.
        ['cragbeast', 'front', RV + 'cragbeast_front_onaxis_square_candidate.png', true],
        ['cragbeast', 'side', RV + 'cragbeast_side.png', false],
        ['cragbeast', 'back', RV + 'cragbeast_back_onaxis_candidate.png', false],
      ];
      for (let i = 1; i <= 2; i++) {
        pairWant.push(['defender', 'front_walk' + i, RV + 'defender_aggressive_front_walk' + i + '.png', false]);
        pairWant.push(['defender', 'side_walk' + i, RV + 'defender_aggressive_side_walk' + i + '.png', false]);
      }
      for (const view of ['front', 'side'])
        for (let i = 1; i <= ART_WALK_MAX; i++)
          pairWant.push(['cragbeast', view + '_walk' + i, RV + 'cragbeast_' + view + '_walk' + i + '.png', false]);
      loadProgress.expect('art', pairWant.length);
      await loadBounded(pairWant);
    }
    // Every costume a form on this battle's roster wears — declared by the
    // character records, so a new one is content. All of it is REQUIRED and
    // loads here, inside the card's all-art wait: a switch happens mid-battle,
    // so a lazily fetched costume would pop in after the beat that sells it.
    const formWant = battleArtDeclarations(battleDef)
      .filter(decl => decl.sprites)
      .flatMap(decl => decl.sprites.poses.map(
        pose => [decl.set, pose, decl.sprites.path + pose + '.png', true]));
    loadProgress.expect('art', formWant.length);
    await loadBounded(formWant);
  }

  return {
    // plate geometry and the loader's vocabulary
    ART_H, ART_VIEWS, ART_WALK_MAX, WALK_CYCLES_PER_TILE, WALK_CONTACT_HOLD,
    artLoadErrors,
    // per-figure frame application
    setArtFrame, layDownArt, layoutOverhead, useArt, applyFormArt, artSetKey,
    actorSetFrame, useActorArt,
    // view selection and gait; the first three run per figure per frame
    trackWalkDistance, pickView, frameKeyFor, setWalking, gaitOn, billboard,
    walkFrames, walkFrameCount, walkCycle, walkWeights, walkPhase, walkFraction,
    anyWalkFrames,
    // portrait ladder rung two: a head crop off the front plate
    artBust, artPortrait,
    // the art pass itself
    loadPlates,
    // WALK_FPS is module-private mutable state; the debug API drives it
    walkFps: () => WALK_FPS,
    setWalkFps: n => (WALK_FPS = n),
  };
}
