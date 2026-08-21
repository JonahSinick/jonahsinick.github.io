/**
 * Which diorama is on screen, and how it is lit.
 *
 * Three worlds share one renderer, one fog and one sun, so switching scenes is
 * a grading change rather than a teardown: swap the background, refog, retint
 * the hemisphere and the sun, move the exposure, and light only the lamps that
 * belong to the scene being shown. Everything a scene owns exclusively (its
 * geometry, its actors) belongs to that scene's own module; this is the shared
 * rig they take turns in front of.
 *
 * The cliffs get a second, dedicated key light from the camera side. The shared
 * sun rakes from behind — which is what gives the town its bright snow tops —
 * and without the key every rock face the player can actually see is in shadow
 * and the whole crest reads as one black mass.
 *
 * `figaro` is a fourth GRADING rather than a fourth world: battle 3 is fought
 * on the same battle world the town uses (one terrain builder, one grid), and
 * what makes it a different place is the light — warm desert dusk against
 * Narshe's overcast snow — plus its own lamp bucket. So it shows the town's
 * world and lights none of the town's windows.
 *
 * Battle 3 gets its own key light for the same reason the cliffs do, and the
 * reason is the camera. The shared sun rakes from the NORTH-WEST and high; the
 * board is viewed from the SOUTH-WEST (azimuth -45°), so the faces a player can
 * actually see are the west-facing and south-facing ones, and under the shared
 * sun every one of them is a silhouette — which is exactly what the castle
 * looked like before this light existed: black slabs. `figaroKey` is a low warm
 * sun off the west shoulder of the frame — see the bearing and elevation note
 * where it is built — and it throws the long shadows across the courtyard that
 * make the place read as dusk. It is also the ONLY shadow caster while battle 3 is
 * showing — the shared sun keeps its warm/cool job as an unshadowed slate fill,
 * so the shadows it would otherwise cross-hatch never appear.
 */
export function createSceneMood({
  THREE, scene, renderer, center,
  // the shared lights the grading retints
  hemi, moon,
  // per-scene lamp buckets, lit only while their scene is showing
  townLights, cliffLights, mineLights,
  // battle 3's torches; absent for the two encounters that have none
  figaroLights = [],
  // battle 3's dusk backdrop (a canvas gradient); a flat colour without it
  figaroSky = null,
  // the three worlds, one visible at a time
  townWorld, cliffsWorld, mineWorld,
  // pan bounds per scene, handed to the camera rig on every switch
  bounds, setBounds,
  // a scene change drops every timer the previous scene had in flight
  cancelTimers,
  // the tactical chrome, hidden for a cutscene
  battleChrome,
  // 'morning' | 'dawn' | null — the two alternate cliffs gradings
  intro,
}) {
  for (const [name, value] of Object.entries({
    THREE, scene, renderer, center, hemi, moon,
    townLights, cliffLights, mineLights,
    townWorld, cliffsWorld, mineWorld, bounds, setBounds, cancelTimers, battleChrome,
  })) {
    if (value === undefined || value === null)
      throw new Error(`scene-mood: missing context "${name}"`);
  }

  const morning = intro === 'morning';
  const dawn = intro === 'dawn';

  const cliffKey = new THREE.DirectionalLight(
    morning ? 0xe8eeff : dawn ? 0xe0d6f8 : 0xd8c6ff,
    morning ? 1.2 : dawn ? 1.35 : 1.45);
  cliffKey.position.set(center.x + 12, 16, center.z + 20);
  cliffKey.target.position.set(4.5, 0, 8);
  cliffKey.visible = false;
  scene.add(cliffKey, cliffKey.target);

  // Battle 3's low desert sun, and its bearing is a composition decision, not a
  // physical one. Both visible face families want light from the south-west,
  // but a light on that exact diagonal throws its shadows on the camera's own
  // axis, where the object casting them hides them: the first version of this
  // read as a scene with no shadows at all. Swinging it round to nearly due WEST
  // keeps the west-facing faces (the near curtain wall, most of the masonry)
  // fully lit, leaves the south-facing ones on a soft rake, and lays the shadows
  // ACROSS the courtyard where the player can see them.
  //
  // ELEVATION IS A TRADE, and 29° is where it settles. Lower is a longer shadow
  // and a moodier rake, but the key's contribution to a HORIZONTAL surface goes
  // with the sine of it: at 20° the courtyard floor was getting less light from
  // the sun than from the ambient fill, so dropping a shadow on it changed
  // almost nothing and the scene read as unlit rather than as dusk. At 29° the
  // floor is keyed about twice as hard as it is filled, the shadows have
  // somewhere to fall from, and a curtain wall still lays about three tiles.
  // Match the standalone diorama: a high amber key from the front-left gives
  // pale sandstone its glow while retaining cool blue-grey shaded faces.
  const figaroKey = new THREE.DirectionalLight(0xffbd74, 4.8);
  figaroKey.position.set(center.x - 18, 30, center.z + 22);
  figaroKey.target.position.set(center.x, 3, center.z);
  figaroKey.castShadow = true;
  figaroKey.shadow.mapSize.set(2048, 2048);
  figaroKey.shadow.camera.left = -17; figaroKey.shadow.camera.right = 17;
  figaroKey.shadow.camera.top = 20; figaroKey.shadow.camera.bottom = -20;
  figaroKey.shadow.camera.near = 2; figaroKey.shadow.camera.far = 62;
  // three.js never recomputes a shadow camera's projection for you — it only
  // copies the matrix it already has — so a frustum set and left unapplied is a
  // frustum that silently stays at the OrthographicCamera default of ±5, which
  // clips the shadows of everything past the middle of the board.
  figaroKey.shadow.camera.updateProjectionMatrix();
  // A light this shallow grazes every horizontal surface, which is where shadow
  // acne comes from; the normal offset is what keeps the courtyard floor clean.
  figaroKey.shadow.bias = -0.0004;
  figaroKey.shadow.normalBias = 0.045;
  figaroKey.visible = false;
  scene.add(figaroKey, figaroKey.target);

  const MOOD = {
    town:   { bg: 0x9db0cd, fog: [0xa4b4cf, 58, 150], hemi: [0xdde6f5, 0x9aa0b4, 1.15],
              sun: [0xf5f8ff, 2.6], exposure: 1.0 },
    cliffs: morning
      ? { bg: 0x8299bd, fog: [0x8ba0bf, 52, 140], hemi: [0xd5def0, 0x7d8399, 1.25],
          sun: [0xeef3ff, 2.2], exposure: 1.12 }
      : dawn
      ? { bg: 0x6d6a94, fog: [0x5c5a80, 48, 124], hemi: [0xb9b4d8, 0x4a4560, 1.35],
          sun: [0xe4dcf5, 1.9], exposure: 1.11 }
      : { bg: 0x50396b, fog: [0x3d2a50, 46, 116], hemi: [0xa895cc, 0x352c48, 1.45],
          sun: [0xd6bdff, 1.6], exposure: 1.1 },
    mine:   { bg: 0x101225, fog: [0x17192b, 34, 82], hemi: [0x8494bd, 0x171725, 1.0],
              sun: [0xaebde5, 1.25], exposure: 1.08 },
    // Battle 3: the warm key above does the lighting, so the SHARED sun is
    // demoted to a cool slate fill from the opposite quarter. That split is the
    // whole look — warm where the light lands, blue-grey where it does not, so
    // the castle's dark brick keeps its slate against gold sand. The fog sits
    // far out: a courtyard has no distance to lose, and the sky is a gradient
    // rather than a colour, so there is nothing for haze to do here.
    figaro: { bg: 0x71879a, bgTex: figaroSky, fog: [0x71879a, 58, 150],
              hemi: [0xffe5c0, 0x2d3340, 2.25], sun: [0x7699c4, 0.85], exposure: 1.18 },
  };

  function applyMood(k) {
    const m = MOOD[k];
    scene.background = m.bgTex || new THREE.Color(m.bg);
    scene.fog.color.setHex(m.fog[0]); scene.fog.near = m.fog[1]; scene.fog.far = m.fog[2];
    hemi.color.setHex(m.hemi[0]); hemi.groundColor.setHex(m.hemi[1]); hemi.intensity = m.hemi[2];
    moon.color.setHex(m.sun[0]); moon.intensity = m.sun[1];
    cliffKey.visible = k === 'cliffs';
    figaroKey.visible = k === 'figaro';
    // One shadow caster at a time: battle 3's key throws them, so the shared sun
    // stops, and every other scene keeps the sun it always cast with.
    moon.castShadow = k !== 'figaro';
    renderer.toneMappingExposure = m.exposure;
    for (const l of townLights) l.visible = k === 'town';
    for (const l of cliffLights) l.visible = k === 'cliffs';
    for (const l of mineLights) l.visible = k === 'mine';
    for (const l of figaroLights) l.visible = k === 'figaro';
  }

  let sceneName = 'town';
  function show(k) {
    if (sceneName !== k) cancelTimers();
    sceneName = k;
    // The battle world carries whichever battle is being fought on it, so it is
    // shown for its own grading as well as the town's.
    townWorld.visible = k === 'town' || k === 'figaro';
    cliffsWorld.visible = k === 'cliffs';
    mineWorld.visible = k === 'mine';
    applyMood(k);
    setBounds(bounds[k].width, bounds[k].depth);
    // the tactical chrome belongs to the battle, not to a cutscene
    const cut = k === 'cliffs' || k === 'mine';
    for (const el of battleChrome) el.style.display = cut ? 'none' : '';
  }

  return { show, applyMood, name: () => sceneName, cliffKey, figaroKey };
}
