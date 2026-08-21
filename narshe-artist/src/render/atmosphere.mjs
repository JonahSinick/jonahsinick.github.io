/**
 * Builds the diorama's atmosphere: the falling-snow particle system (built
 * but disabled since 2026-07-26 — "visual noise, added nothing" — kept for
 * easy revival) and the bloom/tilt-shift postprocessing composer that every
 * frame renders through.
 *
 * The postprocessing classes (`EffectComposer`/`RenderPass`/`UnrealBloomPass`/
 * `BokehPass`/`OutputPass`) arrive as injected context rather than being
 * imported here: they come from `three/addons/postprocessing/*`, a separate
 * import surface from the `THREE` namespace object, and the page already owns
 * that import map.
 *
 * The per-frame snow drift and `composer.render()` call stay in the page's
 * render loop (not moved here) — this module only builds the pieces; what
 * animates them each frame is presenter/render-loop territory.
 */
export function createAtmosphere({
  THREE, renderer, scene, camera, center, dist,
  EffectComposer, RenderPass, UnrealBloomPass, BokehPass, OutputPass,
}) {
  for (const [name, value] of Object.entries({
    THREE, renderer, scene, camera, center, dist,
    EffectComposer, RenderPass, UnrealBloomPass, BokehPass, OutputPass,
  })) {
    if (value === undefined || value === null)
      throw new Error(`atmosphere: missing context "${name}"`);
  }

  // ---------------------------------------------------------------- falling snow
  let snowPts;
  {
    const COUNT = 420, rangeX = 17, rangeZ = 24, height = 12;
    const pos = new Float32Array(COUNT * 3), drift = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = center.x + (Math.random() - 0.5) * rangeX;
      pos[i * 3 + 1] = Math.random() * height;
      pos[i * 3 + 2] = center.z + (Math.random() - 0.5) * rangeZ;
      drift[i] = Math.random() * Math.PI * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    snowPts = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xe8eeff, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.62, depthWrite: false }));
    snowPts.userData = { drift, rangeX, rangeZ, height };
    // snowfall disabled 2026-07-26 (visual noise, added nothing) — snowPts kept for easy revival
  }

  // ---------------------------------------------------------------- postprocessing: bloom + tilt-shift
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Bloom runs at half the composer's resolution (2026-08-01 fan-load work).
  // Measured: the blur chain was ~2.5ms of GPU per frame at full res and is the
  // cheapest stage to shrink, because at strength 0.22 / threshold 0.97 the glow
  // is too subtle to show the resolution drop. The base render and the tilt-shift
  // stay at full res; only the blur chain moves, and bloom's final composite is
  // still an additive blit at full res, so nothing else in the frame softens.
  //
  // The constructor's resolution argument CANNOT do this on its own:
  // `composer.addPass()` immediately calls `pass.setSize(width * pixelRatio, ...)`
  // and overwrites it, as does every later `composer.setSize()`. Halving has to
  // happen inside setSize or it silently does not happen at all. (UnrealBloomPass
  // then halves again internally for its own mip chain — that is its normal
  // behaviour, not a second application of this change.)
  const BLOOM_SCALE = 0.5;
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth * BLOOM_SCALE, innerHeight * BLOOM_SCALE), 0.22, 0.35, 0.97);
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => bloomSetSize(Math.max(1, Math.round(w * BLOOM_SCALE)),
                                         Math.max(1, Math.round(h * BLOOM_SCALE)));
  composer.addPass(bloom);
  const bokeh = new BokehPass(scene, camera, { focus: dist, aperture: 0.00013, maxblur: 0.008 });
  composer.addPass(bokeh);
  composer.addPass(new OutputPass());

  return { snowPts, composer, bloom, bokeh };
}
