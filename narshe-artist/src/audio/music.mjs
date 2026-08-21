/**
 * The battle's music: probes an ordered candidate list for a playable score,
 * decodes it with Web Audio, and exposes the narrow set of transport actions
 * the page needs (`startMusic`, `cueBattleMusic`, `chimeBell`, `toggleMute`).
 * Everything here is best-effort — a missing `audio/` directory or a blocked
 * AudioContext must leave the battle untouched, never throw.
 *
 * The warning-bell battle holds its track until its opening cinematic releases
 * it (`cueBattleMusic`); `isHeld`/`isWanted`/`releaseHold` exist so the page's
 * round-boundary latch release (a defensive one-way-flag restore, see
 * `diorama.html`'s `newRound`) can read and clear that hold without reaching
 * into module-private state.
 *
 * Registers with the page's `loadProgress` bar as one source named 'music' —
 * ticked (well, closed) by the page's shared readiness wiring once
 * `musicReady` settles, exactly like every other independent loader.
 */

export const MUSIC_CONTEXT_FIELDS = [
  'loadProgress', // .expect(name) — music reserves one settlement slot on the splash bar
  'audioBtn',     // the mute/unmute button; this module owns its click listener and 'muted' class
  'candidates',   // ordered list of URLs to probe, most-preferred first
  'version',      // cache-busting query value, bumped whenever audio/ changes
  'held',         // whether the track should start deferred (BATTLE_DEF.holdMusic)
];

export function createMusicPlayer(context) {
  const missing = MUSIC_CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('music player: missing context field(s) ' + missing.join(', '));
  }
  const { loadProgress, audioBtn, candidates, version, held: holdOnStart } = context;

  let actx = null, musicBuf = null, musicSrc = null, musicGain = null;
  let muted = false, musicStarted = false, wantMusic = false;
  let musicUrl = null;          // which candidate actually loaded, for __BATTLE.state()
  let musicHeld = holdOnStart;

  // The track is one item however many candidates get probed; the page's
  // readiness wiring ticks it (via close()) when musicReady settles, success
  // or not.
  loadProgress.expect('music');
  const musicReady = (async () => {
    for (const url of candidates) {
      try {
        const res = await fetch(url + '?v=' + version);
        if (!res.ok) continue;
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength < 4096) continue;
        actx = new (window.AudioContext || window.webkitAudioContext)();
        musicBuf = await actx.decodeAudioData(bytes);
        musicUrl = url;
        if (wantMusic) startMusic();        // the gesture may have landed before the decode
        return;
      } catch (err) { /* candidate missing or undecodable — try the next */ }
    }
  })();

  function cueBattleMusic() { musicHeld = false; startMusic(); }

  // A cast-bell strike, synthesized: a handful of inharmonic partials with
  // exponential decay. No audio asset exists or is needed for this.
  function chimeBell() {
    if (!actx || actx.state !== 'running' || muted) return;   // the M toggle covers every cue
    const t0 = actx.currentTime;
    const out = actx.createGain();
    out.gain.value = 0.22;
    out.connect(actx.destination);
    for (const [ratio, amp, dur] of [[1, 1, 1.6], [2.02, 0.55, 1.1], [2.94, 0.32, 0.8], [4.18, 0.18, 0.5]]) {
      const osc = actx.createOscillator();
      osc.frequency.value = 392 * ratio;
      const g = actx.createGain();
      g.gain.setValueAtTime(amp * 0.28, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(out);
      osc.start(t0); osc.stop(t0 + dur);
    }
  }

  function startMusic() {
    wantMusic = true;
    if (musicHeld) { if (actx) actx.resume().catch(() => {}); return; }
    if (!musicBuf || !actx) return;
    // This succeeds immediately where autoplay is allowed. If the browser keeps
    // the context suspended, advanceDialogue() retries on the first real gesture.
    actx.resume().catch(() => {});
    if (musicStarted) return;
    musicStarted = true;
    try {
      musicGain = actx.createGain();
      musicGain.gain.value = muted ? 0 : 0.3;
      musicGain.connect(actx.destination);
      musicSrc = actx.createBufferSource();
      musicSrc.buffer = musicBuf; musicSrc.loop = true;
      musicSrc.connect(musicGain);
      musicSrc.start();
    } catch (err) { musicStarted = false; }
  }

  function toggleMute() {
    muted = !muted;
    audioBtn.classList.toggle('muted', muted);
    if (musicGain && actx) musicGain.gain.setTargetAtTime(muted ? 0 : 0.3, actx.currentTime, 0.05);
  }
  audioBtn.addEventListener('click', toggleMute);

  /**
   * Give the score back. The decoded `AudioBuffer` is the largest resident
   * object in the game by a wide margin — `decodeAudioData` expands a 3.4 MB
   * MP3 into 55 MB of Float32 PCM (SCALABILITY_2026-08-01 §2.5), and audio is
   * 55% of everything a chained session would accumulate — so a scene teardown
   * that skipped it would leave most of the leak in place.
   *
   * Closing the context is what actually releases it: a suspended context
   * still owns its buffers. Everything here is best-effort in the same way the
   * rest of this module is; a browser that refuses to close a context must not
   * take the teardown down with it.
   */
  function release() {
    try { if (musicSrc) musicSrc.stop(); } catch (err) { /* already stopped */ }
    try { if (musicSrc) musicSrc.disconnect(); } catch (err) { /* not connected */ }
    try { if (musicGain) musicGain.disconnect(); } catch (err) { /* not connected */ }
    musicSrc = null; musicGain = null; musicStarted = false;
    const closing = actx;
    actx = null; musicBuf = null;
    try { if (closing && closing.state !== 'closed') closing.close(); } catch (err) { /* nothing to close */ }
  }

  return {
    musicReady,
    startMusic,
    cueBattleMusic,
    chimeBell,
    toggleMute,
    release,
    isHeld: () => musicHeld,
    isWanted: () => wantMusic,
    releaseHold: () => { musicHeld = false; },
    audioContext: () => actx,
    state: () => ({
      loaded: !!musicBuf, started: musicStarted, muted, held: musicHeld,
      url: musicUrl, ver: version,
      context: actx ? actx.state : null,
      seconds: musicBuf ? +musicBuf.duration.toFixed(1) : 0,
    }),
  };
}
