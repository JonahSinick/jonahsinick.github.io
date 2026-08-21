/**
 * The scene's resource ledger: what a battle allocated on the GPU, recorded at
 * the moment it was allocated, so a teardown frees it by reading a list rather
 * than by guessing.
 *
 * WHY NOT WALK THE SCENE GRAPH AT TEARDOWN. That is the obvious implementation
 * and it is the wrong one, for reasons three.js documents rather than reasons
 * we discovered: several categories of resource are simply not reachable from
 * the graph. `scene.background`, `scene.environment` and `material.envMap`
 * hold textures the renderer caches internally and a traverse() never sees;
 * a material swapped off a mesh (the building-occlusion ghosting clones one
 * per mesh) is unreachable the moment it is swapped; and a mesh removed from
 * its parent for any reason takes its geometry out of reach while the GPU
 * still holds it. The three.js manual is explicit that lifetime is the
 * application's problem, not the library's.
 *
 * WHAT THIS DOES INSTEAD. `ledger.three` is a stand-in for the `three`
 * namespace in which every geometry, material, texture and render-target class
 * has been replaced by a subclass that registers each instance as it is
 * constructed. Because every module in this codebase takes THREE as injected
 * context and never imports it, handing the battle scope `ledger.three` makes
 * EVERY construction site in the game trackable without touching a single one
 * of them — including the ones written before this file existed, the clones
 * three.js makes internally (`Material.clone()` calls `new this.constructor()`,
 * so a clone of a tracked material is tracked), and the ones a future battle
 * will add. You cannot forget to register something you were forced to
 * register in order to build it.
 *
 * Everything that is disposable but not constructed through THREE — the
 * postprocessing composer's private render targets, an AudioContext holding a
 * decoded score, a blob URL behind a portrait — is `adopt`ed with its own
 * disposer and freed in the same pass.
 *
 * THE ASSERTION THIS EXISTS FOR. `renderer.info.memory.{geometries,textures}`
 * and `renderer.info.programs` are live integer counters. Snapshot them before
 * a scene is built, dispose the scene, and they must return to what they were.
 * That is a gate assertion rather than a qualitative worry, and it is what
 * `tools/lifecycle_check.py` asserts.
 */

// Every class whose instances hold GPU memory, by the base each one extends.
// Order matters only in that no class extends two of these.
const KINDS = [
  ['geometries', 'BufferGeometry'],
  ['materials', 'Material'],
  ['textures', 'Texture'],
  ['renderTargets', 'WebGLRenderTarget'],
  // A shadow-casting light owns a depth render target the renderer allocates
  // on its behalf, so the light is where that target's lifetime is decided.
  // MEASURED: with lights left out, a build/dispose/build cycle kept one
  // texture per shadow-casting light — one for Battle 1's sun, two more for
  // the gallery's sun and the terrain kit's key. `DirectionalLight.dispose()`
  // is three.js's own `this.shadow.dispose()`; the base `Light.dispose()` is
  // an empty method, so the lights that cast nothing cost nothing here.
  ['lights', 'Light'],
];

/**
 * @param {object} THREE the real `three` namespace
 * @returns {{three: object, counts: () => object, adopt: Function,
 *            adoptUrl: Function, dispose: () => object, live: object}}
 */
export function createResourceLedger(THREE) {
  const live = {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
    renderTargets: new Set(),
    lights: new Set(),
  };
  // Monotonic totals. `live` shrinks as the game disposes transient effects of
  // its own accord (a thrown stone, a floating-text plate); `created` is what
  // says how much a battle allocated in total, which is the number a leak
  // investigation wants.
  const created = { geometries: 0, materials: 0, textures: 0, renderTargets: 0, lights: 0 };
  // Non-THREE disposables: [label, () => void]
  const adopted = [];
  let disposed = false;

  // A plain object, not a Proxy: module namespaces are exotic objects with
  // enough invariants that a Proxy over one is a footgun, and a shallow copy of
  // ~1000 exports costs microseconds once per battle. Only the classes below
  // differ from the real namespace; everything else is the same binding.
  const three = { ...THREE };

  for (const name of Object.keys(THREE)) {
    const Base = THREE[name];
    if (typeof Base !== 'function' || !Base.prototype) continue;
    const kind = KINDS.find(([, baseName]) => {
      const RootBase = THREE[baseName];
      return typeof RootBase === 'function'
        && (Base === RootBase || Base.prototype instanceof RootBase);
    });
    if (!kind) continue;
    const bucket = kind[0];
    // A subclass rather than a wrapper function, so `new`, `instanceof`, the
    // `.type` string three writes in each constructor, and every subclass
    // three.js itself instantiates through `this.constructor` all keep working.
    three[name] = class extends Base {
      constructor(...args) {
        super(...args);
        live[bucket].add(this);
        created[bucket]++;
      }
    };
    // Some tooling reads a class name; keep the original rather than "".
    Object.defineProperty(three[name], 'name', { value: name, configurable: true });
  }

  // THE ONE HOLE IN THE SUBSTITUTION, AND HOW IT IS PLUGGED.
  //
  // `TextureLoader.load()` builds its texture with three.js's OWN `Texture`
  // class — the loader imports it directly, so replacing the namespace export
  // never reaches it. Every authored terrain sheet, every terrain-kit skin and
  // every cinematic plate arrives through that path, and MEASURED, they were
  // exactly the residue a build/dispose/build cycle left behind: three
  // textures still resident per battle after a teardown that reported success.
  //
  // Registering the returned texture is half the fix. The other half is that a
  // texture three.js made clones into another texture three.js makes
  // (`clone()` is `new this.constructor().copy(this)`, and its constructor is
  // the real class), so the terrain kit's per-tile map clones would escape in
  // turn. Adoption therefore patches the instance's own `clone` to adopt what
  // it returns, which closes the family rather than the first member.
  function adoptTexture(texture) {
    if (!texture || live.textures.has(texture)) return texture;
    live.textures.add(texture);
    created.textures++;
    const cloneFrom = texture.clone.bind(texture);
    texture.clone = () => adoptTexture(cloneFrom());
    return texture;
  }
  for (const name of ['TextureLoader', 'CubeTextureLoader']) {
    const Loader = THREE[name];
    if (typeof Loader !== 'function') continue;
    three[name] = class extends Loader {
      load(...args) { return adoptTexture(super.load(...args)); }
    };
    Object.defineProperty(three[name], 'name', { value: name, configurable: true });
  }

  /**
   * Register something disposable that THREE did not construct. `disposer` is
   * called once, at teardown; `label` is what a leak report calls it.
   */
  function adopt(label, disposer) {
    if (typeof disposer !== 'function') {
      throw new Error(`resource ledger: adopt(${label}) needs a disposer function`);
    }
    adopted.push([label, disposer]);
  }

  /** A blob URL is a document-lifetime reference to decoded bytes until revoked. */
  function adoptUrl(label, url) {
    if (url) adopt(label, () => URL.revokeObjectURL(url));
  }

  /**
   * Roughly how many bytes of decoded image the live textures represent,
   * deduplicated by source image the way the GPU stores them.
   *
   * This is the number the JS heap cannot see and therefore the number a soak
   * measurement most needs: `performance.memory` reports the heap, while a
   * battle's real weight is decoded pixels and PCM sitting outside it.
   * RGBA8 with no mip allowance, which understates by up to a third and is
   * stated rather than corrected — the point is the order of magnitude and
   * whether it returns to zero, not a byte-exact figure.
   */
  function textureBytes() {
    const seen = new Set();
    let bytes = 0;
    for (const texture of live.textures) {
      const image = texture.image;
      if (!image || !image.width || !image.height) continue;
      const key = texture.source || image;
      if (seen.has(key)) continue;
      seen.add(key);
      bytes += image.width * image.height * 4;
    }
    return bytes;
  }

  function counts() {
    return {
      geometries: live.geometries.size,
      materials: live.materials.size,
      textures: live.textures.size,
      renderTargets: live.renderTargets.size,
      lights: live.lights.size,
      adopted: adopted.length,
      created: { ...created },
      disposed,
    };
  }

  /**
   * Free everything registered since construction. Safe to call twice.
   *
   * A single throwing disposer must not strand the rest of the ledger — a
   * half-freed scene is the failure mode this whole file exists to prevent —
   * so failures are collected and returned rather than propagated. The caller
   * (and the lifecycle gate) reports them.
   */
  function dispose() {
    const errors = [];
    const freed = { geometries: 0, materials: 0, textures: 0, renderTargets: 0, lights: 0, adopted: 0 };
    // Render targets first: each owns a texture, and disposing the target is
    // what releases the framebuffer the texture is attached to.
    for (const bucket of ['lights', 'renderTargets', 'materials', 'textures', 'geometries']) {
      for (const resource of live[bucket]) {
        try {
          resource.dispose();
          freed[bucket]++;
        } catch (err) {
          errors.push(`${bucket}: ${err && err.message ? err.message : String(err)}`);
        }
      }
      live[bucket].clear();
    }
    for (const [label, disposer] of adopted) {
      try {
        disposer();
        freed.adopted++;
      } catch (err) {
        errors.push(`${label}: ${err && err.message ? err.message : String(err)}`);
      }
    }
    adopted.length = 0;
    disposed = true;
    return { freed, errors };
  }

  return { three, live, adopt, adoptUrl, counts, textureBytes, dispose };
}
