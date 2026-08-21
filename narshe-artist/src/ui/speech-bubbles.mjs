/**
 * Speech bubbles: the one parchment panel form, and the battle barks that use
 * it without becoming dialogue.
 *
 * Two things live here because Jonah's rule is that there is exactly one bubble
 * form everywhere. `place` is the FFT placement — below the speaker with the
 * tail up, flipped above when the panel would run off the bottom — and it is
 * called by the story bubble and by every bark, so the two can never drift
 * apart visually. `bark` is the battle-side use of that form: the same markup
 * and the same CSS as story dialogue, but inert. No overlay, no input capture,
 * no advance; it tracks its speaker each frame and expires on its own.
 *
 * Barks age on a plain injected clock rather than the gameplay scheduler, and
 * that is deliberate: pure UI ephemera should fade out even across a scene
 * change rather than be orphaned by a generation cancel.
 *
 * The module reaches for nothing — the camera, the viewport, the document and
 * the clock all arrive as named context fields, so placement arithmetic is
 * checkable in Node against a stub camera instead of only in a browser.
 */

// Every primitive a bubble may use. Listed rather than duck-typed so a page
// edit that drops one fails at construction instead of stranding a bark with no
// placement, pinned wherever the layout engine happened to leave it.
export const BUBBLE_CONTEXT_FIELDS = [
  'THREE',    // Vector3, for projecting the speaker's head and feet
  'camera',   // the live camera those projections are against
  'document', // builds the panel element
  'layer',    // the element barks are appended to
  'viewport', // () -> { width, height } in CSS pixels
  'now',      // () -> monotonic milliseconds
];

// A bark holds, then fades, then is gone. The fade is CSS on the opacity write,
// so the second number only has to outlast the transition.
const BARK_HOLD_MS = 3000;
const BARK_FADE_MS = 300;

export function createSpeechBubbles(context) {
  const missing = BUBBLE_CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('speech bubbles: missing context field(s) ' + missing.join(', '));
  }
  const { THREE, camera, document, layer, viewport, now } = context;

  const active = [];

  /**
   * Glue a panel to its speaker. Reads the live group position rather than the
   * tile, because it also serves the cliffs and gallery cutscene actors, which
   * have no grid coordinates at all.
   */
  function place(panel, unit) {
    const tail = panel.querySelector('.tail');
    const w = panel.offsetWidth || 420, h = panel.offsetHeight || 100;
    const view = viewport();
    const p = unit.group.position;
    const head = new THREE.Vector3(p.x, p.y + 2.0, p.z).project(camera);
    const feet = new THREE.Vector3(p.x, p.y, p.z).project(camera);
    const sx = (head.x + 1) / 2 * view.width;
    const syTop = (1 - head.y) / 2 * view.height, syBot = (1 - feet.y) / 2 * view.height;
    let bx = Math.min(Math.max(sx - w * 0.38, 10), view.width - w - 10);
    let by = syBot + 20;                                  // FFT default: below the sprite, tail up
    let up = true;
    if (by + h > view.height - 90) { by = syTop - h - 24; up = false; }   // flip above when cramped
    panel.style.left = bx + 'px';
    panel.style.top = Math.max(10, by) + 'px';
    tail.className = 'tail ' + (up ? 'up' : 'down');
    tail.style.left = Math.min(Math.max(sx - bx - 11, 18), w - 40) + 'px';
  }

  /** One battle line over a unit's head. Returns nothing; it expires by itself. */
  function bark(u, text, portraitSrc, holdMs = BARK_HOLD_MS) {
    // Structure as markup, but the two variable parts as text: barks are literal
    // strings today and will be story-driven, and a line of dialogue must never
    // be able to inject markup into the panel.
    const el = document.createElement('div');
    el.className = 'dpanel';
    el.innerHTML = '<div class="tail up"></div>' +
      '<div class="dport"><div class="spk caps"></div>' +
      '<div class="facecrop">' + (portraitSrc ? '<img alt="" src="' + portraitSrc + '">' : '') + '</div></div>' +
      '<div class="dmain"><div class="ln"></div></div>';
    el.querySelector('.spk').textContent = u.name;
    el.querySelector('.ln').textContent = text;
    layer.appendChild(el);
    active.push({ el, u, text, until: now() + holdMs });
    place(el, u);
  }

  /** Per frame: follow the speakers, retire the expired. */
  function update() {
    for (let i = active.length - 1; i >= 0; i--) {
      const b = active[i];
      place(b.el, b.u);
      const age = now() - b.until;
      if (age > 0) b.el.style.opacity = '0';
      if (age > BARK_FADE_MS) { b.el.remove(); active.splice(i, 1); }
    }
  }

  return {
    place,
    bark,
    update,
    // the live list, so the debug adapter reads what is actually on screen
    active,
  };
}
