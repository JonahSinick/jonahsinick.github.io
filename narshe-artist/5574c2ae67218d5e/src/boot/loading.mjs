/**
 * The entry card, and the arithmetic behind its loading bar.
 *
 * Two factories, because the page needs the halves at two different moments.
 * `createLoadProgress()` has to exist before the first loader runs, near the top
 * of the page; `createSplashCard()` needs every readiness promise in the game
 * and therefore comes last. They meet through the progress instance.
 *
 * The rule the card exists to enforce (Jonah, 2026-07-31, after the published
 * preview lifted early on network loads): the curtain is opaque and stays up
 * until EVERY delivered asset has decoded and been handed to its consumer, so
 * the painted art is what the player sees first and placeholders are never
 * glimpsed. There is deliberately NO time cap. The loaders settle failed
 * requests with recorded errors instead of hanging, so a missing file cannot
 * brick the card — only honest waiting remains. Keeping that wait short is the
 * runtime-compaction pipeline's job, not this module's.
 */

/**
 * The counter that makes an honest, uncapped wait legible: every loader
 * REGISTERS the items it is about to fetch and TICKS one as each settles.
 * Failure ticks exactly like success — the card waits on settlement, not on
 * success, so that is what the bar must measure.
 *
 * Two rules keep an incrementally-known denominator from reading as a bug.
 * A source may reserve a NOMINAL estimate before its list exists and reconcile
 * with a signed expect() once it does (the art pass does; its manifest has to
 * arrive first). And the DISPLAYED fraction never moves backwards, so a late
 * registration pauses the bar instead of rewinding it. Progress counts media
 * items only — the two small manifest JSONs are not worth a slot, and close()
 * covers them anyway.
 *
 * close(name) settles whatever a source reserved but never ticked, driven by
 * that source's readiness promise; it is what guarantees the bar cannot stall
 * below full because a loader took an early return out of its own list.
 */
export function createLoadProgress({ document }) {
  const sources = new Map();
  const PRE_FULL = 0.97;        // never claim 100% while the card is still waiting
  let shown = 0;                // what the bar reads; monotonic
  let complete = false;
  const of = name => {
    let source = sources.get(name);
    if (!source) sources.set(name, source = { name, total: 0, done: 0, closed: false });
    return source;
  };
  const counts = () => {
    let done = 0, total = 0;
    for (const source of sources.values()) { done += source.done; total += source.total; }
    return { done, total };
  };
  const paint = () => {
    const { done, total } = counts();
    const raw = total > 0 ? done / total : 0;
    const next = complete ? 1 : Math.min(PRE_FULL, raw);
    if (next > shown) shown = next;
    const bar = document.querySelector('#splash .loadbar');
    if (!bar) return;           // the card has lifted and taken the bar with it
    bar.firstElementChild.style.width = (shown * 100).toFixed(2) + '%';
    bar.setAttribute('aria-valuenow', Math.round(shown * 100));
  };
  return {
    // Declare n items this source is about to load. n may be negative, which is
    // how a nominal reservation reconciles against the real list.
    expect(name, n = 1) {
      const source = of(name);
      source.total = Math.max(source.done, source.total + n);
      paint();
    },
    tick(name, n = 1) {
      const source = of(name);
      source.done = Math.min(source.total, source.done + n);
      paint();
    },
    close(name) { const source = of(name); source.closed = true; source.done = source.total; paint(); },
    finish() {
      complete = true;
      for (const source of sources.values()) source.done = source.total;
      paint();
    },
    report() {
      const { done, total } = counts();
      return {
        done, total, complete,
        fraction: total > 0 ? done / total : 0,
        shown,                   // the fraction the bar is actually drawing
        sources: Array.from(sources.values(), source => ({ ...source })),
      };
    },
  };
}

/**
 * The card itself: assemble every readiness promise, hold the curtain until they
 * settle, then hand the scene over.
 *
 * WHICH scene is entered is not this module's business — that decision branches
 * on the review entries, the warning-bell prototype and the normal opening, and
 * it stays with the page as `onOpen`. This module owns only the curtain: when it
 * may lift, what dismisses it, and the audio unlock that has to land first.
 */
export function createSplashCard({
  document,
  progress,
  // [name, promise] per loader; the name is the progress source it registered under
  sources,
  // minimum hold, and the fade-out the removal waits for
  splashFloor, splashFade,
  startMusic, audioContext,
  onOpen,
  // Whether to DRAW a curtain over the wait. False keeps every other promise
  // this module makes — the scene is still entered only once every asset has
  // landed, and `opened` still settles at that moment — and simply removes the
  // card, for a caller that is covering the transition itself. It exists
  // because a chained battle's card is player-facing: between two battles of
  // one campaign it may read as an act break or as an interruption, and that
  // is a decision for whoever owns the flow, not for this module.
  curtain = true,
  // An extra class on the card, so a flow controller can restyle a
  // between-battles card without this module knowing what an act break is.
  className = null,
  // The scene's AbortSignal. The card's own element is replaced between
  // battles along with the rest of the chrome, but these two listeners sit on
  // the WINDOW, which does not go anywhere: without the signal a second
  // battle's Enter key would open two cards, one of which no longer exists.
  signal,
}) {
  for (const [name, value] of Object.entries({
    document, progress, sources, splashFloor, splashFade, startMusic, audioContext, onOpen,
  })) {
    if (value === undefined || value === null)
      throw new Error(`loading: missing context "${name}"`);
  }

  // Closing on settlement is what makes the bar's arithmetic total: a loader
  // that returned early out of its own list, or reserved more than it fetched,
  // cannot leave the bar hanging short of full.
  for (const [name, ready] of sources)
    Promise.resolve(ready).catch(() => {}).then(() => progress.close(name));
  const assetsReady = Promise.all(sources.map(([, ready]) => ready));
  // full exactly when the wait ends, not when the card's minimum hold elapses
  assetsReady.catch(() => {}).then(() => progress.finish());

  let openResolve;
  const opened = new Promise(res => { openResolve = res; });   // settles when the card lifts
  let entered = false;
  let started = false;

  function open(sp) {
    if (!sp || sp.classList.contains('out')) return;
    startMusic();
    // resume() only succeeds synchronously-ish when it is called inside a
    // trusted gesture. open() now fires on its own once the card is ready, so
    // most of the time this attempt lands with no gesture behind it and stays
    // suspended — that is expected, not an error, and unlockOnGesture() below
    // is what actually recovers it. Either way the reveal does not wait on the
    // outcome: an opaque page forever is worse than a silent first few seconds.
    const actx = audioContext();
    const resume = actx && actx.state !== 'running'
      ? actx.resume().catch(() => {})
      : Promise.resolve();
    Promise.resolve(resume).finally(() => {
      if (sp.classList.contains('out')) return;
      sp.classList.remove('ready');
      // Enter and FRAME the scene while the card is still opaque, then fade:
      // the reveal must show the composed entry, never a boot camera that cuts
      // (Jonah). The card is removed only after the fade completes.
      if (!entered) { entered = true; onOpen(); openResolve(); }
      sp.classList.add('out');
      setTimeout(() => sp.remove(), splashFade);
    });
  }

  addEventListener('keydown', event => {
    const sp = document.getElementById('splash');
    if (!sp || !sp.classList.contains('ready') ||
        !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
    event.preventDefault();
    open(sp);
  }, { signal });

  // The card now lifts on its own once assets settle — no click required
  // (Jonah). That means open()'s resume() attempt above frequently has no
  // trusted gesture behind it and the AudioContext stays suspended. Catch the
  // very first gesture anywhere on the page, of either kind, and retry once.
  // By the time a gesture can land, assetsReady (which includes the 'music'
  // source) has already settled, so the context exists if a track decoded at
  // all — nothing here waits on it or creates it.
  function unlockOnGesture() {
    const actx = audioContext();
    if (actx && actx.state !== 'running') actx.resume().catch(() => {});
  }
  addEventListener('pointerdown', unlockOnGesture, { once: true, signal });
  addEventListener('keydown', unlockOnGesture, { once: true, signal });

  /**
   * Run the card on the first rendered frame — not before, so the reveal is
   * composed against a scene that has actually drawn once. Idempotent; the
   * animation loop calls it every frame and it acts once.
   */
  function begin() {
    if (started) return;
    started = true;
    const sp = document.getElementById('splash');
    if (!sp) return;
    if (!curtain) {
      // No card, same contract: enter when the assets are in, not before, and
      // settle `opened` at that moment so tooling and the flow controller wait
      // on the same event they always did.
      sp.remove();
      assetsReady.catch(err => {
        console.error('asset readiness rejected:', err);
      }).then(() => {
        if (entered) return;
        entered = true;
        startMusic();
        onOpen();
        openResolve();
      });
      return;
    }
    if (className) sp.classList.add(className);
    sp.classList.add('run');
    Promise.all([assetsReady, new Promise(res => setTimeout(res, splashFloor))]).catch(err => {
      // The loaders themselves always settle; only a JS exception in their
      // consumer code can reject. The card must still open — a logged
      // partial-art start beats an opaque page forever.
      console.error('asset readiness rejected:', err);
    }).then(() => {
      sp.classList.add('ready');
      // A click or Enter here still works — open() is idempotent against the
      // 'out' class — but nothing waits on it any more (Jonah: the player must
      // never have to click past NARSHE once the game has loaded).
      sp.addEventListener('pointerdown', () => open(sp), { once: true });
      startMusic();                         // autoplay where permitted
      open(sp);
    });
  }

  return { assetsReady, opened, begin };
}
