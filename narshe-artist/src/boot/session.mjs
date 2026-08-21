/**
 * The browser session: what survives a battle, so that battles can follow each
 * other without a page load.
 *
 * Exactly four things live here, and the list is short on purpose — anything
 * else that outlived a battle would be a leak with a nice name.
 *
 *  1. THE RENDERER AND ITS CANVAS. One WebGL context per tab. A renderer per
 *     battle would spend a context per encounter (browsers cap them, and drop
 *     the oldest without warning), and it would reset `renderer.info` on every
 *     transition — which is the counter the whole disposal assertion reads.
 *     The grade lives here with it: pixel ratio, shadow map, colour space,
 *     tone mapping and exposure are constant across every battle.
 *  2. THE FRAME LOOP. One requestAnimationFrame chain, calling whichever scene
 *     is current. A loop per battle would keep running after its scene was
 *     disposed, drawing a freed graph.
 *  3. THE RESIZE LISTENER, delegating to the current scene for the same
 *     reason.
 *  4. THE PRISTINE CHROME. `diorama.html`'s markup, captured before anything
 *     has touched it, and restored between battles.
 *
 * WHY THE CHROME IS RESTORED RATHER THAN RESET FIELD BY FIELD. The HUD, the
 * dialogue card, the overlay, the explore hint, the entry card and the body
 * itself all carry state as classes, text and inline styles, and the entry
 * card REMOVES ITSELF from the document when it lifts — so a second battle
 * would have no card to hold up at all. Replacing the markup wholesale fixes
 * both, and buys a third thing for free: every listener any module attached to
 * a chrome element dies with the node it was attached to. That leaves only
 * window-level and canvas-level listeners to unhook, which is what the
 * per-battle AbortSignal is for.
 */

import * as THREE from 'three';

import { createBattleScene } from '../battle-scene.mjs';

/**
 * @param {object} options
 * @param {Document} options.document
 * @param {string} [options.search] the page's query string; defaults to location.search
 */
export function createSession({ document, search = location.search }) {
  // Captured before the canvas is appended, so restoring it cannot destroy the
  // renderer's own element, and before any module has added a class.
  const pristineChrome = document.body.innerHTML;
  const pristineBodyClass = document.body.className;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  let current = null;          // the live scene, or null between battles
  let controller = null;       // its AbortSignal source
  let looping = false;

  function mountCanvas() {
    const app = document.getElementById('app');
    app.appendChild(renderer.domElement);
  }

  function resetChrome() {
    document.body.innerHTML = pristineChrome;
    document.body.className = pristineBodyClass;
    mountCanvas();
  }

  /** What the renderer is holding right now, with or without a scene. */
  function gpu() {
    return {
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs ? renderer.info.programs.length : 0,
    };
  }

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    if (current) current.layout();
  });

  function loop() {
    requestAnimationFrame(loop);
    if (current) current.frame();
  }

  /**
   * Build a battle and make it the one being drawn.
   *
   * `battleId` is written into a copy of the page's own query string rather
   * than replacing it, so every other knob a run was launched with — ?fps,
   * ?rules, ?tune, ?terrain, the balance sweeps — carries into the next battle
   * exactly as it would across a reload.
   *
   * Returns synchronously with the scene. Callers that need a PLAYABLE battle
   * wait on `scene.opened`, which settles when the entry card lifts — the card
   * still holds until every asset for THIS battle has arrived, which is the
   * contract chaining had to keep.
   *
   * `options.card` is how a flow controller decides what the player sees while
   * that wait happens: `{ title, floor, fade, className, curtain }`, each
   * defaulting to the battle's own. A card between two battles of one campaign
   * may read as an act break or as an interruption, and that is a decision for
   * the flow, not for the battle — so it is a parameter here rather than a
   * hardcode inside the scene. `curtain: false` removes the card and keeps
   * every other promise: the scene is still entered only once its art has
   * landed, so a caller that wants to cover the transition with its own fade
   * can, without the entry contract moving.
   *
   * `options.outro` is the other end of the same idea: `{ beats, onEnd }`, the
   * terminal beats this battle plays instead of the end card it shows when it
   * is played alone, and the callback that fires when they are done. It is what
   * lets a campaign put its own card after the last encounter and cut straight
   * through the ones before it. Null — every `?battle=` entry, every gate —
   * leaves each battle ending exactly as it always has.
   */
  function start(battleId, options = {}) {
    if (current) throw new Error('session: a battle is already running; dispose it first');
    resetChrome();
    const params = new URLSearchParams(search);
    if (battleId) params.set('battle', battleId);
    else params.delete('battle');
    controller = new AbortController();
    current = createBattleScene({
      renderer, params, signal: controller.signal,
      card: options.card || null,
      outro: options.outro || null,
    });
    if (!looping) { looping = true; loop(); }
    return current;
  }

  /**
   * Tear the current battle down. Named for the scene it expects, so a caller
   * that has lost track of which battle is up fails loudly here instead of
   * silently disposing the wrong one.
   *
   * Order matters: the scene stops being drawn BEFORE it is freed, because a
   * frame drawn between the two would render a half-disposed graph.
   */
  function dispose(expected = null) {
    if (!current) return null;
    if (expected && current.id !== expected) {
      throw new Error(`session: asked to dispose "${expected}" but "${current.id}" is running`);
    }
    const scene = current;
    current = null;
    const report = scene.dispose();
    controller.abort();
    controller = null;
    // The debug surface belongs to a scene, not to the tab. Leaving the old
    // one published is how a gate ends up driving a battle that no longer
    // exists and reporting its stale state as the new one's.
    delete window.__BATTLE;
    resetChrome();
    return report;
  }

  return {
    renderer,
    gpu,
    start,
    dispose,
    current: () => (current ? current.id : null),
    scene: () => current,
  };
}
