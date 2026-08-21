/**
 * The dialogue engine: the portrait ladder, the beat runner behind the
 * parchment bubble, and the loader that fetches every face the card waits on.
 *
 * A "dialogue" is a list of beats, not of lines — a spoken `line`, a `narr`
 * stage direction and the `tbc` end card are clicked through, and an `fx` beat
 * is a scene change that runs itself and hands over when it lands. That state
 * machine and the portrait resolution above it are what moved; the page keeps
 * everything that is scene or session knowledge.
 *
 * What the page kept, deliberately:
 *  - `phase`, `mode` and every input guard. The engine never reads them; the
 *    page asks `active()` when it needs to know a card is up, which is the one
 *    thing about dialogue the rest of the game cares about.
 *  - The pointerdown handler on the panel, because it hands the camera back
 *    (it seeds a pan drag) rather than advancing anything.
 *  - The three DOM lookups, which stay with the page's other element handles
 *    and arrive here as context.
 *
 * Everything it needs from the game arrives as an explicit accessor or object:
 * scene identity, the unit and cutscene-actor lists a speaker may be anchored
 * to, the two face fallbacks below the portrait rungs, and the bubble placer
 * from src/ui/speech-bubbles.mjs. `sceneName` is a getter because the scene
 * changes underneath a running dialogue — an fx beat is exactly that.
 */

import { battleArtDeclarations } from '../content/characters/index.mjs';

const CONTEXT_FIELDS = [
  'THREE',              // MathUtils.clamp, for the portrait crop metadata
  'elDlg',              // the dialogue overlay root
  'elDlgPanel',         // the parchment panel inside it
  'elDlgFace',          // the portrait <img>
  'loadProgress',       // the splash bar; every face ticks it, delivered or not
  'battleDef',          // scopes line-specific rules and declared portraits
  'sceneName',          // () -> 'cliffs' | 'town' | 'mine'; an fx beat changes it
  'units',              // battle units a speaker may be anchored to
  'cliffActors',        // cutscene actors for the overlook scene
  'mineActors',         // cutscene actors for the mine finale
  'gateSpeakers',       // the two named guards, bound once by identity
  'minePortraits',      // Lenne's face, owned by the mine-finale module
  'placeBubblePanel',   // (panel, speaker) -> speech-bubbles placement
  'faceOf',             // (unit) -> the face this figure would show
  'placeholderFace',    // (cls, accent, team) -> a procedural bust of last resort
  'artPortrait',        // (key) -> a head crop off a painted front plate
  'startMusic',         // the first advance is the gesture browsers let us play on
];

export function createDialogue(context) {
  const missing = CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('dialogue: missing context field(s) ' + missing.join(', '));
  }
  const {
    THREE, elDlg, elDlgPanel, elDlgFace, loadProgress, battleDef, sceneName,
    units, cliffActors, mineActors, gateSpeakers, minePortraits,
    placeBubblePanel, faceOf, placeholderFace, artPortrait, startMusic,
  } = context;

  // Portrait art is optional. Each file is fetched once and handed to the <img> as a
  // blob, so a missing portraits/ directory can never leave a broken-image icon —
  // the panel just stays in the plain name-above-text layout. Cassien is the
  // sentinel: any request for a file that isn't there costs a 404 line in the
  // console no matter how it's made, so when the set hasn't been delivered we spend
  // exactly one and stop rather than four.
  const PORTRAIT_KEYS = ['cassien', 'brecht', 'seira', 'guard'];
  const portraits = {};
  const dialoguePortraitRules = [];
  const portraitLoadErrors = [];
  const DEFAULT_DIALOGUE_PORTRAITS = { brecht: 'brecht_prejudice.png' };
  // Dialogue art is composed to one shared apparent head-and-shoulder scale.
  // Cassien's accepted set establishes the baseline; small per-image crops keep a
  // speaker from shrinking or jumping when an expression variant replaces it.
  const BASE_PORTRAIT_FRAMES = {
    cassien: { scale: 1, x: 0, y: 0 },
    brecht:  { scale: 1.12, x: 0, y: 4 },
    seira:   { scale: 1.04, x: 0, y: 1 },
    guard:   { scale: 1, x: 0, y: 0 },
    lenne:   { scale: 1.03, x: 0, y: 1 },
  };
  // speaker key -> portrait url that has replaced this character's face for the
  // rest of the run. A form switch repaints the whole character, dialogue and
  // panel alike, so it belongs above the whole ladder rather than at one rung.
  const portraitOverrides = {};
  // a delivered portrait wins; failing that, a front sprite can supply its own head
  function portraitOf(who) {
    const k = who.toLowerCase();
    if (portraitOverrides[k]) return portraitOverrides[k];
    if (k === 'lenne' || k === 'girl') return minePortraits.lenne || null;
    if (k === 'ragna') return portraits.ragna || null;
    if (PORTRAIT_KEYS.includes(k)) return portraits[k] || artPortrait(k);
    if (k.includes('guard')) return portraits.guard || artPortrait('guard');
    return null;
  }
  function dialoguePortraitFor(beat) {
    if (!beat || beat.kind !== 'line') return null;
    const rule = dialoguePortraitRules.find(candidate =>
      candidate.speaker === beat.who && beat.text.includes(candidate.contains));
    return rule && rule.url ? rule : null;
  }
  function defaultDialoguePortraitFile(who) {
    return DEFAULT_DIALOGUE_PORTRAITS[String(who).toLowerCase()] || null;
  }
  function defaultDialoguePortraitRule(who) {
    const file = defaultDialoguePortraitFile(who);
    return file ? dialoguePortraitRules.find(rule => rule.file === file) : null;
  }
  function dialoguePortraitFrame(who, rule) {
    const speakerKey = String(who).toLowerCase() === 'girl' ? 'lenne' : String(who).toLowerCase();
    const base = BASE_PORTRAIT_FRAMES[speakerKey] ||
      BASE_PORTRAIT_FRAMES.guard;
    const frame = rule && rule.frame && typeof rule.frame === 'object' ? rule.frame : {};
    return {
      scale: Number.isFinite(+frame.scale) ? THREE.MathUtils.clamp(+frame.scale, 0.9, 1.25) : base.scale,
      x: Number.isFinite(+frame.x) ? THREE.MathUtils.clamp(+frame.x, -20, 20) : base.x,
      y: Number.isFinite(+frame.y) ? THREE.MathUtils.clamp(+frame.y, -20, 20) : base.y,
    };
  }
  function applyDialoguePortraitFrame(who, rule) {
    const frame = dialoguePortraitFrame(who, rule);
    elDlgFace.style.setProperty('--portrait-scale', frame.scale);
    elDlgFace.style.setProperty('--portrait-x', frame.x + 'px');
    elDlgFace.style.setProperty('--portrait-y', frame.y + 'px');
    elDlgFace.dataset.frame = [frame.scale, frame.x, frame.y].join(',');
  }
  let dlgLines = null, dlgAt = 0, dlgDone = null;
  let dlgFx = null;                      // set while an 'fx' beat (a scene change) is running
  let dlgPortraitKey = null;             // manifest filename, or null for the base portrait
  // preloaded alongside the sprites and awaited by the entry card, so the first
  // spoken line already has its painted face
  const portraitsReady = (async () => {
    async function loadPath(path) {
      try {
        const res = await fetch(path);
        if (!res.ok) return false;
        const blob = await res.blob();
        if (!blob.size) return false;
        const url = URL.createObjectURL(blob);
        // Ask the browser to warm its image cache, but do not make acceptance of a
        // valid fetched file depend on decode scheduling. Chromium can reject
        // decode() transiently when the full sprite atlas is warming in parallel.
        const img = new Image();
        img.src = url;
        img.decode().catch(() => {});
        return url;
      } catch (err) {
        portraitLoadErrors.push(path + ': ' + (err && err.message ? err.message : String(err)));
        return false;
      } finally {
        loadProgress.tick('portraits');    // every face, delivered or missing, on every exit
      }
    }
    // The 512px masters stay under portraits/ as the art contract and generation
    // source; the browser draws them into a 150px crop, so it fetches the
    // <=256px derivatives build_runtime_portraits.py produces instead (same
    // pattern art/runtime/sprites/ uses for battlefield plates).
    const PORTRAIT_RUNTIME = 'art/runtime/portraits/';
    async function loadBase(key) {
      const url = await loadPath(PORTRAIT_RUNTIME + key + '.png');
      if (url) portraits[key] = url;
      return !!url;
    }
    async function loadDialogueSet() {
      try {
        // The rule table (speaker/contains/file/frame/battle) is the tiny
        // engine-side manifest, not image weight, so it stays at its documented
        // path; only the face PNGs it names route through the compact set.
        const res = await fetch('portraits/dialogue/manifest.json');
        if (!res.ok) return;
        const manifest = await res.json();
        if (!Array.isArray(manifest)) return;
        // A rule's `battle` field scopes a line-specific expression to the
        // encounter that speaks that line; omitted means every encounter. This
        // keeps warning-bell from fetching Battle 1's town-gate variants (and
        // any future battle's) it can never trigger a match against. Leave
        // DEFAULT_DIALOGUE_PORTRAITS.brecht's rule unscoped even though its
        // `contains` line is Battle-1-only: below, it also stands in as
        // Brecht's accepted default face in EVERY portrait context, not only
        // on its scripted line, so every battle needs it fetched.
        // Filtering to the rules that will actually be FETCHED before loading any
        // of them is what lets the count be registered up front — a malformed rule
        // costs no request and must not reserve a progress slot.
        const applicable = manifest.filter(rule =>
          rule && (!rule.battle || rule.battle === battleDef.id) &&
          typeof rule.speaker === 'string' && typeof rule.contains === 'string' &&
          typeof rule.file === 'string' && /^[a-z0-9_-]+\.png$/.test(rule.file));
        loadProgress.expect('portraits', applicable.length);
        const loaded = await Promise.all(applicable.map(async rule => {
          const url = await loadPath(PORTRAIT_RUNTIME + 'dialogue/' + rule.file);
          return url ? { ...rule, url } : null;
        }));
        dialoguePortraitRules.push(...loaded.filter(Boolean));
      } catch (err) {
        portraitLoadErrors.push('manifest: ' + (err && err.message ? err.message : String(err)));
      }
    }
    // Faces that do not arrive as portraits/<key>.png: a review candidate
    // consumed compact and in place (Ragna's, until the art lane lands a
    // canonical portraits/ragna.png, which would then win by key), and a form's
    // face, held under its own key until the switch beat installs it. Both are
    // declared by the character records this battle fields, and both load with
    // everything else the entry card waits on — so a switch never shows the old
    // portrait for a frame.
    const declared = battleArtDeclarations(battleDef).filter(decl => decl.portraitPath);
    // Everything but the dialogue set is known now; that set registers its own
    // count once the manifest names it. The sentinel's early return below leaves
    // the rest reserved and unticked, which close('portraits') settles.
    loadProgress.expect('portraits', PORTRAIT_KEYS.length + declared.length);
    if (!await loadBase(PORTRAIT_KEYS[0])) return; // none delivered: derived busts stand
    await Promise.all([
      ...PORTRAIT_KEYS.slice(1).map(loadBase),
      loadDialogueSet(),
      ...declared.map(async decl => {
        const url = await loadPath(decl.portraitPath);
        if (url) portraits[decl.portrait] = url;
      }),
    ]);
    // The suspicious portrait is the accepted baseline Brecht depiction, not a
    // one-line expression variant. It therefore supplies dialogue, forecasts, and
    // every other portrait use once the dialogue set has loaded.
    const brechtDefault = dialoguePortraitRules.find(
      rule => rule.file === DEFAULT_DIALOGUE_PORTRAITS.brecht);
    if (brechtDefault) portraits.brecht = brechtDefault.url;
    if (dlgLines) drawBeat();
  })();
  // A "dialogue" is now a list of beats, not a list of lines. Three kinds carry a
  // card the player clicks through — a spoken 'line', a 'narr' stage direction, and
  // the 'tbc' end card — and a fourth, 'fx', is a scene change that runs itself and
  // hands over when it lands. dlgLines stays non-null for the whole run including
  // the fx beat, which is what keeps __BATTLE.state().dialogue truthful (and what
  // lets the balance bots click straight through a scene transition).
  function startDialogue(beats, done) {
    dlgLines = (beats || []).filter(Boolean);
    dlgAt = 0; dlgDone = done; dlgFx = null;
    if (!dlgLines.length) { if (done) done(); return; }
    elDlg.classList.add('show');
    drawBeat();
  }
  let dlgSpeaker = null;                 // unit/actor the current line is anchored to
  function speakerUnit(who) {
    if (sceneName() === 'cliffs') {
      const actor = cliffActors.find(a => a.name === who);
      if (actor) return actor;
    }
    if (sceneName() === 'mine') {
      const actorName = who === 'Girl' ? 'Lenne' : who;
      const actor = mineActors.find(a => a.name === actorName);
      if (actor) return actor;
    }
    if (gateSpeakers[who]) return gateSpeakers[who];
    const byName = units.find(u => u.name === who);
    if (byName) return byName;
    // any other "...Guard": the front-most defender, whether or not he is still up
    if (/guard/i.test(who)) return units.filter(u => u.team === 'enemy').sort((a, b) => b.z - a.z)[0] || null;
    return null;
  }
  function drawBeat() {
    let b = dlgLines && dlgLines[dlgAt];
    if (!b) return;
    // staging-only beats (stage directions): fire their hooks, show nothing, move on
    while (b && b.skip) {
      if (b.onShow) b.onShow();
      dlgAt++;
      b = dlgLines[dlgAt];
      if (!b) { advanceDialogue(); return; }
    }
    elDlg.classList.toggle('narr', b.kind === 'narr');
    elDlg.classList.toggle('tbc', b.kind === 'tbc');
    elDlg.classList.toggle('blank', b.kind === 'fx');
    // A held beat cannot be clicked past (see advanceDialogue), so the card
    // drops its "CLICK OR SPACE" prompt and stops being translucent — a promise
    // the input no longer keeps, and a battlefield nothing should see through.
    elDlg.classList.toggle('held', !!b.hold);
    if (b.kind === 'fx') { runFx(b); return; }
    if (b.kind === 'narr' || b.kind === 'tbc') {
      dlgSpeaker = null; dlgPortraitKey = null;  // no portrait, no tail, nobody speaking
      elDlg.querySelector('.npanel .ntext').textContent = b.text || '';
      if (b.kind === 'tbc')
        elDlg.querySelector('.tbcard .w').textContent = b.text || 'To Be Continued';
      if (b.onShow) b.onShow();
      return;
    }
    elDlg.querySelector('.spk').textContent = b.who;
    elDlg.querySelector('.ln').textContent = b.text;
    dlgSpeaker = speakerUnit(b.who);   // camera stays fixed through dialogue — the bubble finds the speaker
    // Line-specific variants are expressions of a costume this speaker may have
    // left: once a form switch has repainted her, an acting portrait of the old
    // form would put it back for one line.
    const portraitRule = portraitOverrides[String(b.who).toLowerCase()]
      ? null : (dialoguePortraitFor(b) || defaultDialoguePortraitRule(b.who));
    const minePortraitKey = sceneName() === 'mine' && /^(Girl|Lenne)$/.test(b.who)
      ? 'mine:lenne.png' : null;
    dlgPortraitKey = portraitRule ? portraitRule.file : minePortraitKey;
    const face = (portraitRule && portraitRule.url) || portraitOf(b.who) ||
      (dlgSpeaker ? faceOf(dlgSpeaker) : placeholderFace('archer', 0xa8342c, 'enemy'));
    elDlgFace.src = face;
    applyDialoguePortraitFrame(b.who, portraitRule);
    placeDlgBubble();
    if (b.onShow) b.onShow();
  }
  // an fx beat owns the screen until it lands; clicking through it cuts it short
  // rather than queueing behind it
  function runFx(b) {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true; dlgFx = null;
      if (++dlgAt >= dlgLines.length) endDialogue(); else drawBeat();
    };
    // dlgFx is installed BEFORE the beat runs: a beat that finishes
    // synchronously must not have a stale dlgFx written over its successor,
    // and a beat that throws must advance rather than silently skipping a
    // non-skippable beat with its staging half-applied (2026-07-31 review).
    let handle = {};
    dlgFx = {
      skippable: b.skippable !== false,
      skip: () => {
        if (b.skippable === false) return;
        if (handle.skip) handle.skip();
        finish();
      },
    };
    try {
      handle = b.run(finish) || {};
    } catch (err) {
      console.error('fx beat failed:', err);
      finish();
    }
  }
  function clearDialogue() {
    dlgLines = null; dlgFx = null; dlgSpeaker = null; dlgPortraitKey = null;
    elDlg.classList.remove('show', 'narr', 'tbc', 'blank', 'held');
  }
  function endDialogue() {
    const d = dlgDone; dlgDone = null;
    clearDialogue();
    if (d) d();
  }
  // keep the bubble glued to the speaker through camera glides and rotation
  function placeDlgBubble() {
    if (!dlgLines || !dlgSpeaker) return;
    const panel = elDlgPanel, tail = panel.querySelector('.tail');
    const w = panel.offsetWidth || 420, h = panel.offsetHeight || 100;
    if (sceneName() === 'cliffs' || sceneName() === 'mine') {
      // These are composed establishing shots. A stable subtitle position keeps
      // the overlook town and the mine's raised sanctuary unobstructed.
      panel.style.left = Math.max(12, (innerWidth - w) / 2) + 'px';
      panel.style.top = Math.max(12, innerHeight - h - 24) + 'px';
      tail.style.display = 'none';
      return;
    }
    tail.style.display = '';
    placeBubblePanel(panel, dlgSpeaker);
  }
  function advanceDialogue() {
    if (!dlgLines) return;
    startMusic();                       // the first gesture is what browsers let us play on
    if (dlgFx) { dlgFx.skip(); return; }
    // A beat marked `hold` is the last thing the player sees: clicking it does
    // nothing. It exists because taking a "to be continued" card down reveals
    // the battlefield it was drawn over, which is not an ending (Jonah,
    // 2026-08-03) — the game has to stop somewhere, and this is where. Every
    // beat without the flag advances exactly as before.
    if (dlgLines[dlgAt] && dlgLines[dlgAt].hold) return;
    if (++dlgAt >= dlgLines.length) { endDialogue(); return; }
    drawBeat();
  }

  // Drop the completion callback and take the card down. The victory and
  // mine-entry test hooks do this so a dialogue interrupted mid-run cannot
  // fire its done() into a scene that has already moved on.
  function abandonDialogue() {
    dlgDone = null;
    clearDialogue();
  }

  return {
    // the loader the entry card waits on
    portraitsReady,
    // running a dialogue
    start: startDialogue, advance: advanceDialogue, redraw: drawBeat,
    reposition: placeDlgBubble, clear: clearDialogue, abandon: abandonDialogue,
    // what the rest of the page asks about a running one
    active: () => !!dlgLines,
    currentBeat: () => (dlgLines && dlgLines[dlgAt]) || null,
    fxSkippable: () => (dlgFx ? dlgFx.skippable : true),
    portraitKey: () => dlgPortraitKey,
    portraitFrame: () => elDlgFace.dataset.frame || null,
    // the portrait ladder, shared with the unit panel and the form switch
    speakerUnit, portraitOf,
    loadedPortrait: key => portraits[key],
    overridePortrait: (key, url) => { portraitOverrides[key] = url; },
    /**
     * Hand back the decoded portrait bytes. Every face is held as a blob URL,
     * which is a document-lifetime reference: the bytes behind it survive the
     * scene, the <img> and the module unless the URL is revoked by hand. Both
     * maps are module-private, so the release has to live here rather than in
     * the page's teardown. Called once, from the scene's resource ledger.
     */
    release() {
      for (const map of [portraits, portraitOverrides]) {
        for (const key of Object.keys(map)) {
          const url = map[key];
          if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
          delete map[key];
        }
      }
    },
    // inspection: shaped here because both arrays are module-private
    portraitRules: () => dialoguePortraitRules.map(rule => ({
      speaker: rule.speaker,
      contains: rule.contains,
      file: rule.file,
      frame: rule.frame || null,
      loaded: !!rule.url,
    })),
    portraitErrors: () => [...portraitLoadErrors],
  };
}
