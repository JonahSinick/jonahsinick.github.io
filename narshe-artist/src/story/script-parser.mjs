/**
 * story/opening-scene.md is authoritative: the game parses it at runtime, so
 * a rewrite of the script is a rewrite of the game with no code change. The
 * format it has to honour is exactly the format the writer already uses —
 *   sections separated by a line of '---'
 *   '**Name:** text'            a spoken line
 *   '*...*' on its own          a stage direction (a narration card)
 *   '*[GAMEPLAY: ...]*'         the battle break
 *   '<!-- @stage name -->'      a non-visible engine staging directive
 * Everything else (the title, anything unparseable) is ignored.
 *
 * This module is a pure text -> beats transform: no fetch, no DOM, no battle
 * state. The page owns fetching `story/opening-scene.md`, deciding whether a
 * parse failure falls back to `FALLBACK_SCENES`, and threading `loadProgress`
 * — none of that belongs to what is fundamentally a parser.
 */

export const REQUIRED_STAGE_DIRECTIVES = [
  'post-end',
  'arrow-shot',
  'beast-react',
  'resonance-start',
  'resonance-climax',
  'whiteout',
  'mine-end',
];
const VALID_STAGE_DIRECTIVES = new Set(REQUIRED_STAGE_DIRECTIVES);

// markdown out, spoken words in: emphasis unwraps, an italic parenthetical is a
// direction to an actor and never reaches the bubble
function stripInline(s) {
  return String(s)
    .replace(/\*\([^)]*\)\*/g, '')          // *(To the girl.)*
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function parseScript(md) {
  const sections = md.split(/\r?\n\s*---\s*\r?\n/);
  const beats = [];                          // flat, each tagged with its section
  const directives = [];
  const errors = [];
  let gameplaySec = -1, gateSec = -1;
  sections.forEach((sec, si) => {
    for (const raw of sec.split(/\r?\n\s*\r?\n/)) {
      const p = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join(' ').trim();
      if (!p || p.startsWith('#')) continue;
      const directive = p.match(/^<!--\s*@stage\s+([a-z0-9-]+)\s*-->$/i);
      if (directive) {
        const name = directive[1].toLowerCase();
        directives.push(name);
        if (!VALID_STAGE_DIRECTIVES.has(name))
          errors.push(`unknown stage directive "${name}"`);
        beats.push({ kind: 'directive', name, sec: si });
        continue;
      }
      const spoken = p.match(/^\*\*(.+?):\*\*\s*(.*)$/);
      if (spoken) {
        const text = stripInline(spoken[2]);
        if (!text) continue;
        const who = stripInline(spoken[1]);
        if (gateSec < 0 && /guard/i.test(who)) gateSec = si;
        beats.push({ kind: 'line', who, text, sec: si });
        continue;
      }
      if (!(p.startsWith('*') && p.endsWith('*'))) continue;
      const inner = p.slice(1, -1).trim().replace(/^\[/, '').replace(/\]$/, '').trim();
      if (/^GAMEPLAY\b/i.test(inner)) { if (gameplaySec < 0) gameplaySec = si; continue; }
      const text = stripInline(inner);
      // stage directions are STAGING, not dialogue (Jonah 2026-07-27): the scene
      // itself depicts them — parse and discard so scene mapping keeps its indices.
      if (text) beats.push({ kind: 'narr', text, sec: si, skip: true });
    }
  });
  for (const name of REQUIRED_STAGE_DIRECTIVES) {
    const count = directives.filter(value => value === name).length;
    if (count !== 1)
      errors.push(`stage directive "${name}" must appear exactly once (found ${count})`);
  }
  if (gateSec < 0) gateSec = sections.length;
  if (gameplaySec < 0) gameplaySec = sections.length;
  const cliffs = beats.filter(b => b.sec < gateSec);
  const gate = beats.filter(b => b.sec >= gateSec && b.sec < gameplaySec);
  // The explicit boundary keeps script rewrites from silently moving dialogue
  // between the battlefield aftermath and the mine sanctuary.
  const post = [];
  let postEnd = -1;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (b.sec <= gameplaySec) continue;
    if (b.kind === 'directive' && b.name === 'post-end') {
      postEnd = i;
      break;
    }
    post.push(b);
  }
  const mine = postEnd >= 0 ? beats.slice(postEnd + 1) : [];
  if (postEnd < 0) errors.push('post-battle boundary was not found');
  return { cliffs, gate, post, mine, directives, errors };
}

// The script's canonical stand-in: if story/opening-scene.md is missing or
// yields no gate dialogue, the game plays exactly as it did before the
// script was wired up.
export const FALLBACK_SCENES = {
  cliffs: [
    { kind: 'narr', text: 'A snowy pass overlooks a mining town nestled in a mountain basin. Three imperial soldiers stand at the overlook.' },
    { kind: 'line', who: 'Cassien', text: 'Today we march toward Narshe to liberate the townspeople from a songbeast that has taken residence there.' },
    { kind: 'line', who: 'Cassien', text: "Let's head out. We'll settle this after the mission." },
  ],
  gate: [
    { kind: 'line', who: 'Town Guard', text: 'Imperial soldiers... what brings you here?' },
    { kind: 'line', who: 'Cassien', text: 'We’ve been told that a dangerous creature has taken residence here, and are here to protect you from it.' },
    { kind: 'line', who: 'Town Guard', text: 'Protection? We handle our own problems here. Leave at once.' },
    { kind: 'line', who: 'Cassien', text: 'We will proceed. In time, you will see that we acted in your interest.' },
    { kind: 'line', who: 'Town Guard', text: 'We will not let you pass.' },
  ],
  post: [
    { kind: 'line', who: 'Cassien', text: 'That’s enough! Stand down, Brecht.' },
    { kind: 'narr', text: 'The guards are on their knees.' },
    { kind: 'line', who: 'Cassien', text: 'I said enough. They’re down. Stay here. We’ll be gone shortly.' },
  ],
  mine: [
    { kind: 'line', who: 'Brecht', text: 'There it is.' },
    { kind: 'line', who: 'Cassien', text: 'With children. This area is under imperial authority. Children — step away from the creature.' },
    { kind: 'line', who: 'Lenne', text: 'No.' },
    { kind: 'line', who: 'Cassien', text: 'This isn’t a request. The creature is dangerous.' },
    { kind: 'line', who: 'Lenne', text: 'She’s not dangerous. She’s my friend.' },
    { kind: 'line', who: 'Seira', text: 'Cassien... something feels wrong.' },
  ],
};
