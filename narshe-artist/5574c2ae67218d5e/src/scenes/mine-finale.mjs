/**
 * Mine finale — Part I's songbeast-sanctuary cutscene.
 *
 * MINE SANCTUARY: narshe_esper.jpeg supplies the composition rather than the
 * literal FF6 map — a broad approach enters from the bottom of frame, three
 * figures advance into it, shallow steps compress the space, and the
 * supernatural subject occupies a raised pocket at the very top. Low rails
 * and a cart say "working mine" without putting scenery between the camera
 * and any actor.
 *
 * This module owns the chamber's geometry, its seven staged actors (the
 * imperial trio, the songbeast, Lenne, and the two children), the shared
 * resonance-aura pulse, the arrow-flight/whiteout beats
 * `configureMineBeats` turns opening-scene.md's stage directives into, and
 * the per-frame `stepMineStory` tween driver. What it does NOT own: entering
 * and settling the climax camera frame is one exact, unrepeated sequence
 * against page state (`phase`/`mode`/`glide`/`marker`/`azimuth`/`CENTER`),
 * so the page bundles it behind `frameMineClimax` and hands over the
 * function rather than each of those primitives individually — the module
 * calls it, but does not reach into turn-state or camera-rig internals to
 * build it.
 *
 * THREE and the page's rendering/staging primitives arrive through one
 * explicit context object, the way `warning-bell-opening.mjs` takes them, so
 * this stays constructible from Node with a stub and a page edit that drops
 * a primitive fails loudly here instead of silently stranding the finale.
 */

const CONTEXT_FIELDS = [
  'THREE',           // scene graph constructors (injected, never imported)
  'scene',           // the THREE.Scene mine lights attach to directly
  'box',             // (w,h,d,mat,x,y,z,{shadow,group}) -> kit-geometry mesh
  'hash',            // deterministic jitter for rock rotation/scale
  'makeTex',         // canvas -> THREE.CanvasTexture, for the resonance aura
  'spriteFigure',    // (kind, pal) -> procedural figure + materials
  'actorSetFrame',   // (actor, frame) -> draw a gait/art frame
  'setWalking',      // (actor, on) -> gait on/off
  'renderer',        // for anisotropy on the songbeast/Lenne/children sprites
  'loadProgress',    // { expect, tick } — the mine art source on the splash bar
  'later',           // (fn, ms) scheduled on the battle's own generation
  'cancelLater',      // cancel a `later` handle
  'camera',          // read for the whiteout's screen-space origin
  'showScene',       // (name) -> switch the visible diorama layer
  'frameMineClimax', // settle the climax camera/turn-state frame (page-owned)
  'easeInOut',       // shared tween easing
  'fastSim',         // () -> FAST_SIM, so headless sims skip the tween entirely
  'sceneName',       // () -> the page's current scene name (for the resonance pulse)
  'warbell',         // WARBELL: the scripted warning-bell opening never reaches this scene
  'reviewMine',       // REVIEW_MINE (?scene=mine): can reach it regardless of WARBELL
];

export function createMineFinale(context) {
  const missing = CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('mine finale: missing context field(s) ' + missing.join(', '));
  }
  const {
    THREE, scene, box, hash, makeTex, spriteFigure, actorSetFrame, setWalking,
    renderer, loadProgress, later, cancelLater, camera, showScene,
    frameMineClimax, easeInOut, fastSim, sceneName, warbell, reviewMine,
  } = context;

  const MW = 12, MD = 19;
  const MINE_LOW_TOP = 0.46, MINE_HIGH_TOP = 0.82;
  const mineWorld = new THREE.Group();
  scene.add(mineWorld);
  const mineLights = [];
  const mineActors = [], minePartyActors = [], mineSpriteActors = [];
  const minePortraits = {};
  let mineEntrance = null, mineArrowFlight = null, mineBeastReaction = null;
  let mineLastArrowPath = null;
  let mineResonanceLevel = 0;

  const matMine = {
    rock: new THREE.MeshStandardMaterial({ color: 0x27283a, roughness: 1, flatShading: true }),
    rockHi: new THREE.MeshStandardMaterial({ color: 0x3b3a50, roughness: 1, flatShading: true }),
    floor: new THREE.MeshStandardMaterial({ color: 0x394054, roughness: 0.96 }),
    frost: new THREE.MeshStandardMaterial({
      color: 0xa8b7cc, roughness: 0.88, transparent: true, opacity: 0.42, depthWrite: false,
    }),
    rail: new THREE.MeshStandardMaterial({ color: 0x292c34, roughness: 0.52, metalness: 0.62 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x574332, roughness: 0.92 }),
    glow: new THREE.MeshBasicMaterial({
      color: 0x8cecf5, transparent: true, opacity: 0.25,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  };

  function mineRock(x, y, z, sx, sy, sz, hi = false) {
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.75, 0),
      hi ? matMine.rockHi : matMine.rock
    );
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.rotation.set(hash(x, z) * 0.3, hash(z, x) * 2.2, hash(x + 9, z) * 0.22);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mineWorld.add(mesh);
    return mesh;
  }

  {
    // The approach and altar are two large, uninterrupted shapes. The three
    // shallow risers give the reference image's upward cadence without reading as
    // a floating staircase.
    box(7.3, MINE_LOW_TOP, 10.6, matMine.floor, 6, MINE_LOW_TOP / 2, 5.55,
      { group: mineWorld });
    box(8.5, MINE_HIGH_TOP, 6.7, matMine.floor, 6, MINE_HIGH_TOP / 2, 15.25,
      { group: mineWorld });
    for (let i = 0; i < 3; i++) {
      const h = MINE_LOW_TOP + (i + 1) * (MINE_HIGH_TOP - MINE_LOW_TOP) / 3;
      box(5.9 + i * 0.45, h, 0.62, matMine.floor, 6, h / 2, 10.72 + i * 0.56,
        { group: mineWorld });
    }
    // Frost is confined to the sanctuary shelf. It catches the cyan light and
    // preserves the script's snow imagery while the foreground remains bare mine.
    box(8.15, 0.025, 6.25, matMine.frost, 6, MINE_HIGH_TOP + 0.018, 15.28,
      { group: mineWorld, shadow: false });

    // Rails guide the eye from the arriving party to the steps, then stop: no
    // industrial line cuts through the children or the songbeast.
    for (const x of [5.28, 6.72])
      box(0.085, 0.065, 8.7, matMine.rail, x, MINE_LOW_TOP + 0.055, 5.55,
        { group: mineWorld });
    for (let z = 1.35; z < 10; z += 0.72)
      box(2.15, 0.07, 0.12, matMine.wood, 6, MINE_LOW_TOP + 0.03, z,
        { group: mineWorld });

    // A small, low cart gives the open lower chamber scale without obscuring a
    // party member. It is pushed to the extreme left sightline.
    box(1.35, 0.58, 1.0, matMine.wood, 2.22, MINE_LOW_TOP + 0.35, 6.25,
      { group: mineWorld });
    for (const x of [1.78, 2.66]) for (const z of [5.85, 6.65]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12), matMine.rail);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(x, MINE_LOW_TOP + 0.14, z);
      mineWorld.add(wheel);
    }

    // Connected rock masses make a dark proscenium around the playable picture.
    // The inner shoulders stay below actor-head height until the far grotto, so
    // camera rotation cannot put a wall in front of the cast.
    for (let z = 1; z <= 16.5; z += 1.25) {
      const widen = z > 11 ? 0.35 : 0;
      mineRock(1.0 - widen, 1.1, z, 1.55, 1.5 + hash(1, z) * 0.7, 1.2, z % 2.5 > 1);
      mineRock(11.0 + widen, 1.1, z, 1.55, 1.5 + hash(11, z) * 0.7, 1.2, z % 2.5 <= 1);
    }
    for (let x = 1.1; x <= 10.9; x += 1.2)
      mineRock(x, 1.4 + Math.abs(x - 6) * 0.13, 18.25, 1.15, 1.6, 1.0, x % 2.4 > 1);

    // The focal pocket is kept deliberately plain. The cast and their resonance
    // supply the supernatural light; unexplained decorative crystals competed
    // with that story signal.
    const resonance = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.38, 48), matMine.glow);
    resonance.rotation.x = -Math.PI / 2;
    resonance.position.set(6, MINE_HIGH_TOP + 0.042, 15.45);
    mineWorld.add(resonance);
    resonance.userData.resonance = true;

    const arrow = new THREE.Group();
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xf2e9d4, toneMapped: false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.78, 6), arrowMat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.18, 6), arrowMat);
    head.position.y = 0.47;
    const fletch = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.13, 0.025),
      new THREE.MeshBasicMaterial({ color: 0x8b2432, toneMapped: false })
    );
    fletch.position.y = -0.38;
    arrow.add(shaft, head, fletch);
    arrow.visible = false; arrow.userData.storyArrow = true;
    mineWorld.add(arrow);

    const cyanLight = new THREE.PointLight(0x7defff, 4.2, 11, 2);
    cyanLight.position.set(6, 3.15, 16.0); scene.add(cyanLight); mineLights.push(cyanLight);
    const approachLight = new THREE.PointLight(0xffbd78, 1.6, 8, 2);
    approachLight.position.set(3.0, 2.25, 5.0); scene.add(approachLight); mineLights.push(approachLight);
  }

  function addMinePartyActor(name, kind, pal, x, z) {
    const { group: fig, mats, mesh } = spriteFigure(kind, pal);
    const group = new THREE.Group();
    group.add(fig);
    group.position.set(x, MINE_LOW_TOP, z);
    group.rotation.y = 0;                       // up-cave; camera sees their backs
    mineWorld.add(group);
    const a = { name, kind, pal, team: 'player', group, fig, sprite: mesh, mats,
                flip: 1, art: null, artFace: 'back', artKey: 'back',
                walking: false, walkT: 0, walkDist: 0, lastX: x, lastZ: z,
                cutscene: true };
    a.setFrame = f => actorSetFrame(a, f);
    mineActors.push(a); minePartyActors.push(a);
    return a;
  }

  // Their dialogue positions sit just below the steps, inside the same dramatic
  // space as the children. At this depth the bottom-docked portrait box no longer
  // covers their bodies.
  const mineCassien = addMinePartyActor('Cassien', 'knight', 'cassien', 6.0, 8.85);
  const mineBrecht  = addMinePartyActor('Brecht',  'archer', 'brecht',  4.72, 8.05);
  const mineSeira   = addMinePartyActor('Seira',   'mage',   'seira',   7.28, 8.05);
  [mineCassien, mineBrecht, mineSeira].forEach((a, i) => { a.gaitOffset = [0, 0.31, 0.63][i]; });

  function addMineSpriteActor(name, path, x, z, height, yaw = Math.PI) {
    const material = new THREE.MeshBasicMaterial({
      transparent: true, alphaTest: 0.08, side: THREE.DoubleSide,
      toneMapped: false, fog: true,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * 0.7, height), material);
    mesh.position.y = height / 2;
    const fig = new THREE.Group(); fig.add(mesh);
    const group = new THREE.Group(); group.add(fig);
    group.position.set(x, MINE_HIGH_TOP, z); group.rotation.y = yaw;
    group.visible = false;
    mineWorld.add(group);
    const actor = { name, path, group, fig, sprite: mesh, height, staticPlate: true };
    mineActors.push(actor); mineSpriteActors.push(actor);
    return actor;
  }

  // The songbeast and children occupy the esper's exact narrative slot: a compact
  // upper grouping, well above and beyond the arriving imperial triangle.
  const mineSongbeast = addMineSpriteActor('Songbeast',
    'art/runtime/review/mine_songbeast/sprites/songbeast_front.png', 6.0, 15.45, 2.36);
  const mineLenne = addMineSpriteActor('Lenne',
    'art/runtime/review/mine_songbeast/sprites/lenne_front.png', 5.05, 13.62, 1.36);
  const mineOlderChild = addMineSpriteActor('Older Child',
    'art/runtime/review/mine_songbeast/sprites/child_older_front.png', 4.18, 14.55, 1.31);
  const mineYoungerChild = addMineSpriteActor('Younger Child',
    'art/runtime/review/mine_songbeast/sprites/child_younger_front.png', 7.48, 14.35, 1.25);

  function makeResonanceAura(color) {
    const tex = makeTex((ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.18, `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},0.7)`);
      g.addColorStop(0.58, `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},0.18)`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    }, 256);
    const aura = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false,
      depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    aura.visible = false;
    aura.renderOrder = 20;
    return aura;
  }
  const mineBeastAura = makeResonanceAura(0x7defff);
  mineBeastAura.position.set(0, 1.12, 0);
  mineBeastAura.userData.baseScale = 3.35;
  mineSongbeast.group.add(mineBeastAura);
  const mineSeiraAura = makeResonanceAura(0xd9b7ff);
  mineSeiraAura.position.set(0, 0.82, 0);
  mineSeiraAura.userData.baseScale = 1.85;
  mineSeira.group.add(mineSeiraAura);

  function croppedSceneCanvas(img, padding = 0.045) {
    const probe = document.createElement('canvas');
    probe.width = img.naturalWidth; probe.height = img.naturalHeight;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(img, 0, 0);
    const data = pctx.getImageData(0, 0, probe.width, probe.height).data;
    let x0 = probe.width, y0 = probe.height, x1 = 0, y1 = 0;
    for (let y = 0; y < probe.height; y++) for (let x = 0; x < probe.width; x++) {
      if (data[(y * probe.width + x) * 4 + 3] < 18) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (x1 <= x0 || y1 <= y0) return probe;
    const pad = Math.ceil(Math.max(x1 - x0, y1 - y0) * padding);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(probe.width - 1, x1 + pad); y1 = Math.min(probe.height - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(img, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  async function loadMineSprite(actor) {
    const res = await fetch(actor.path);
    if (!res.ok) throw new Error(actor.path + ': HTTP ' + res.status);
    const img = new Image(); img.src = URL.createObjectURL(await res.blob());
    await img.decode();
    const canvas = croppedSceneCanvas(img);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    actor.sprite.material.map = tex;
    actor.sprite.material.needsUpdate = true;
    actor.sprite.geometry.dispose();
    actor.sprite.geometry = new THREE.PlaneGeometry(actor.height * canvas.width / canvas.height, actor.height);
    actor.group.visible = true;
  }

  async function loadMinePortrait(key, path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(path + ': HTTP ' + res.status);
    minePortraits[key] = URL.createObjectURL(await res.blob());
  }

  // The mine finale is Battle 1's own story tail — opening-scene.md's @stage
  // directives are what ever call showScene('mine'), and the warning-bell
  // encounter runs its own scripted opening instead of that parsed script, so
  // it can never reach the mine scene. REVIEW_MINE (?scene=mine) always can,
  // regardless of which battle happens to be selected alongside it.
  const mineArtReady = (!warbell || reviewMine)
    ? (() => {
        const items = [
          ...mineSpriteActors.map(actor => () => loadMineSprite(actor)),
          () => loadMinePortrait('lenne', 'art/runtime/review/mine_songbeast/anime/lenne.png'),
        ];
        loadProgress.expect('mine', items.length);
        return Promise.all(items.map(run =>
          run().finally(() => loadProgress.tick('mine'))))
          .catch(err => console.warn('Mine art did not fully load:', err));
      })()
    : Promise.resolve();

  const MINE_PARTY_HOME = new Map(minePartyActors.map(a =>
    [a.name, { x: a.group.position.x, z: a.group.position.z }]));

  function storyArrow() {
    return mineWorld.children.find(child => child.userData.storyArrow);
  }
  function resonanceMark() {
    return mineWorld.children.find(child => child.userData.resonance);
  }
  function resetMineTableau() {
    mineEntrance = null; mineArrowFlight = null; mineBeastReaction = null;
    mineLastArrowPath = null;
    mineResonanceLevel = 0;
    const arrow = storyArrow(); if (arrow) arrow.visible = false;
    const resonance = resonanceMark();
    if (resonance) { resonance.material.opacity = 0.25; resonance.scale.setScalar(1); }
    for (const actor of minePartyActors) {
      const home = MINE_PARTY_HOME.get(actor.name);
      actor.group.position.set(home.x, MINE_LOW_TOP, home.z);
      actor.group.rotation.set(0, 0, 0);
      setWalking(actor, false);
    }
    mineLenne.group.position.set(5.05, MINE_HIGH_TOP, 13.62);
    mineLenne.group.rotation.set(0, Math.PI, 0);
    mineLenne.sprite.rotation.z = 0;
    mineLenne.sprite.position.y = mineLenne.height / 2;
    mineSongbeast.group.position.set(6.0, MINE_HIGH_TOP, 15.45);
    mineSongbeast.group.scale.setScalar(1);
    mineSongbeast.sprite.rotation.z = 0;
    for (const aura of [mineBeastAura, mineSeiraAura]) {
      aura.visible = false; aura.material.opacity = 0;
    }
    const white = document.getElementById('whiteout');
    white.style.transition = 'none';
    white.style.opacity = '0';
    white.style.clipPath = 'circle(0px at 50% 50%)';
  }
  function enterMine() {
    resetMineTableau();
    showScene('mine');
    // A deliberate close tableau: all seven figures remain in frame, while the
    // arriving trio is still large enough to read above the bottom dialogue box.
    // The exact camera/turn-state settle is page state — see frameMineClimax.
    frameMineClimax();
  }
  function startMineEntrance(done) {
    if (fastSim()) {
      for (const actor of minePartyActors) {
        const home = MINE_PARTY_HOME.get(actor.name);
        actor.group.position.z = home.z;
        setWalking(actor, false);
      }
      later(done, 0);
      return;
    }
    const starts = minePartyActors.map(actor => {
      const home = MINE_PARTY_HOME.get(actor.name);
      actor.group.position.set(home.x, MINE_LOW_TOP, home.z - 2.15);
      actor.group.rotation.y = 0;
      setWalking(actor, true);
      return { actor, fromZ: home.z - 2.15, toZ: home.z };
    });
    mineEntrance = { t: 0, dur: 1.65, starts, done };
  }
  function woundLenne() {
    mineLenne.sprite.rotation.z = 1.23;
    mineLenne.sprite.position.y = 0.34;
    mineLenne.group.position.set(5.78, MINE_HIGH_TOP, 13.72);
    mineBeastReaction = { t: 0, dur: 0.72 };
    mineResonanceLevel = Math.max(mineResonanceLevel, 0.24);
  }
  function runMineArrow(done) {
    const arrow = storyArrow();
    if (!arrow) { woundLenne(); done(); return {}; }
    const from = new THREE.Vector3(
      mineBrecht.group.position.x, MINE_LOW_TOP + 1.05, mineBrecht.group.position.z + 0.35);
    // Brecht sights on the songbeast. Lenne begins off that line, then crosses it
    // after the arrow is already in flight; the collision point is only partway
    // along the beastward trajectory.
    const beastward = new THREE.Vector3(
      mineSongbeast.group.position.x, MINE_HIGH_TOP + 1.02, mineSongbeast.group.position.z - 0.1);
    const to = from.clone().lerp(beastward, 0.78);
    const lungeFrom = mineLenne.group.position.clone();
    const lungeTo = new THREE.Vector3(5.78, MINE_HIGH_TOP, 13.72);
    mineLastArrowPath = { from: from.clone(), to: to.clone(),
      beastward: beastward.clone(), lungeFrom: lungeFrom.clone() };
    arrow.position.copy(from); arrow.visible = true;
    arrow.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      beastward.clone().sub(from).normalize()
    );
    if (fastSim()) {
      mineLenne.group.position.copy(lungeTo);
      arrow.position.copy(to); arrow.visible = false; woundLenne();
      later(done, 0);
      return {};
    }
    mineArrowFlight = { t: 0, dur: 0.9, from, to, lungeFrom, lungeTo, done, arrow };
    return {};
  }
  function stirSongbeast() {
    mineResonanceLevel = Math.max(mineResonanceLevel, 0.45);
  }
  function mineWhiteout(done) {
    const el = document.getElementById('whiteout');
    const T = fastSim() ? 30 : 1550, HOLD = fastSim() ? 15 : 420;
    const source = mineSeira.group.position.clone();
    source.y += 0.88;
    source.project(camera);
    const x = (source.x + 1) * innerWidth / 2;
    const y = (1 - source.y) * innerHeight / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 40;
    mineResonanceLevel = 1.25;
    el.style.transition = 'none';
    el.style.opacity = '0.985';
    el.style.clipPath = `circle(0px at ${x}px ${y}px)`;
    // Force the zero-radius frame to commit before setting the destination.
    // This avoids requestAnimationFrame throttling turning the climax into a
    // late global cut, and preserves the visible origin at Seira.
    void el.offsetWidth;
    el.style.transition = `clip-path ${T}ms cubic-bezier(.18,.02,.22,1)`;
    el.style.clipPath = `circle(${radius}px at ${x}px ${y}px)`;
    const timer = later(done, T + HOLD);
    return { skip: () => {
      cancelLater(timer);
      el.style.opacity = '0.985';
      el.style.clipPath = `circle(${radius}px at ${x}px ${y}px)`;
      done();
    } };
  }
  function configureMineBeats(beats) {
    const out = [];
    for (const source of beats || []) {
      if (source.kind !== 'directive') {
        out.push({ ...source });
        continue;
      }
      if (source.name === 'mine-end') break;
      if (source.name === 'arrow-shot')
        out.push({ kind: 'fx', skippable: false, run: runMineArrow });
      else if (source.name === 'beast-react')
        out.push({ kind: 'stage', skip: true, onShow: stirSongbeast });
      else if (source.name === 'resonance-start')
        out.push({ kind: 'stage', skip: true,
          onShow: () => { mineResonanceLevel = Math.max(mineResonanceLevel, 0.7); } });
      else if (source.name === 'resonance-climax')
        out.push({ kind: 'stage', skip: true, onShow: () => { mineResonanceLevel = 1; } });
      else if (source.name === 'whiteout')
        out.push({ kind: 'fx', skippable: false, run: mineWhiteout });
    }
    return out;
  }
  function stepMineStory(dt, t) {
    if (mineEntrance) {
      const e = mineEntrance;
      e.t = Math.min(e.dur, e.t + dt);
      const p = easeInOut(e.t / e.dur);
      for (const row of e.starts)
        row.actor.group.position.z = row.fromZ + (row.toZ - row.fromZ) * p;
      if (e.t >= e.dur) {
        for (const row of e.starts) setWalking(row.actor, false);
        mineEntrance = null;
        e.done();
      }
    }
    if (mineArrowFlight) {
      const f = mineArrowFlight;
      f.t = Math.min(f.dur, f.t + dt);
      const p = easeInOut(f.t / f.dur);
      f.arrow.position.lerpVectors(f.from, f.to, p);
      // The arrow is already committed to the beast before Lenne crosses the
      // trajectory. Her interception begins late and finishes just before impact.
      const lunge = THREE.MathUtils.clamp((p - 0.38) / 0.5, 0, 1);
      mineLenne.group.position.lerpVectors(f.lungeFrom, f.lungeTo, easeInOut(lunge));
      if (f.t >= f.dur) {
        f.arrow.visible = false;
        mineArrowFlight = null;
        woundLenne();
        f.done();
      }
    }
    if (mineBeastReaction) {
      const reaction = mineBeastReaction;
      reaction.t = Math.min(reaction.dur, reaction.t + dt);
      const p = easeInOut(reaction.t / reaction.dur);
      // A quick recoil, then a protective surge toward Lenne. The final lean is
      // held so the creature never snaps back to indifference after she falls.
      const recoil = Math.sin(Math.min(1, p * 2) * Math.PI) * 0.08;
      mineSongbeast.group.position.set(
        6.0, MINE_HIGH_TOP + recoil, 15.45 - p * 0.58);
      mineSongbeast.group.scale.setScalar(1 + p * 0.11);
      mineSongbeast.sprite.rotation.z = -p * 0.17;
      if (reaction.t >= reaction.dur) mineBeastReaction = null;
    }
    if (sceneName() === 'mine') {
      const ring = resonanceMark();
      const pulse = 0.5 + 0.5 * Math.sin(t * (3.2 + mineResonanceLevel * 3.5));
      if (ring) {
        ring.material.opacity = 0.20 + mineResonanceLevel * (0.26 + pulse * 0.24);
        ring.scale.setScalar(1 + mineResonanceLevel * pulse * 0.12);
      }
      const beastLevel = mineResonanceLevel > 0 ? Math.max(0.36, mineResonanceLevel) : 0;
      const seiraLevel = mineResonanceLevel >= 0.65 ? mineResonanceLevel : 0;
      for (const [aura, level] of [[mineBeastAura, beastLevel], [mineSeiraAura, seiraLevel]]) {
        aura.visible = level > 0;
        aura.material.opacity = level > 0 ? Math.min(0.78, level * (0.22 + pulse * 0.28)) : 0;
        const base = aura.userData.baseScale;
        aura.scale.setScalar(base * (1 + level * (0.06 + pulse * 0.14)));
      }
    }
  }

  return {
    world: mineWorld,
    lights: mineLights,
    grid: { width: MW, depth: MD },
    actors: mineActors,
    partyActors: minePartyActors,
    spriteActors: mineSpriteActors,
    portraits: minePortraits,
    artReady: mineArtReady,
    enterMine,
    startMineEntrance,
    configureMineBeats,
    stepMineStory,
    // stepMine's debug hook reports the beast's in-flight recoil progress.
    beastReactionProgress: () => mineBeastReaction ? mineBeastReaction.t : null,
    // __BATTLE.mine()'s whole snapshot beyond the actor list (which the page
    // already holds via `actors`) and `active` (which is the page's own
    // sceneName check) — the tableau state, aura glow, and last arrow path
    // are otherwise private to this closure.
    debugState() {
      return {
        lowerTop: MINE_LOW_TOP,
        upperTop: MINE_HIGH_TOP,
        entrance: !!mineEntrance,
        arrow: !!mineArrowFlight,
        resonance: +mineResonanceLevel.toFixed(2),
        reaction: !!mineBeastReaction,
        glow: {
          beast: mineBeastAura.visible ? +mineBeastAura.material.opacity.toFixed(3) : 0,
          seira: mineSeiraAura.visible ? +mineSeiraAura.material.opacity.toFixed(3) : 0,
        },
        arrowPath: mineLastArrowPath && {
          targetX: +mineLastArrowPath.to.x.toFixed(3),
          targetZ: +mineLastArrowPath.to.z.toFixed(3),
          beastX: +mineLastArrowPath.beastward.x.toFixed(3),
          beastZ: +mineLastArrowPath.beastward.z.toFixed(3),
          lenneStartX: +mineLastArrowPath.lungeFrom.x.toFixed(3),
          lenneStartZ: +mineLastArrowPath.lungeFrom.z.toFixed(3),
        },
      };
    },
  };
}
