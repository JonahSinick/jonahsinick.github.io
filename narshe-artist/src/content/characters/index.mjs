/**
 * The character registry: who exists, what they are made of, and what a battle
 * gets when it fields one.
 *
 * A character record owns identity (display name, role label, class, the
 * palette and plate set it wears, its portrait key), base stats, its kit, and
 * the forms it can switch into. A battle roster then REFERENCES a character and
 * says only what is true of that deployment — where the unit stands, what it
 * starts with, which forms are fielded. The trio's stat blocks used to be
 * written once per battle, which meant the same character could be silently
 * retuned in one encounter and not the other.
 *
 * Records are validated on import, the way `render/terrain-kit.mjs` validates a
 * map: a malformed record is a content bug that should fail loudly at the point
 * it is written rather than as a missing sprite three scenes later.
 */
import { brecht, cassien, seira } from './imperials.mjs';
import { alchemist, minerArcher } from './narshe-militia.mjs';
import { ragna, skarn } from './bonded-pair.mjs';

export const CHARACTERS = [cassien, brecht, seira, minerArcher, alchemist, ragna, skarn];

/** Stat fields every record carries, and the only fields a roster may tune. */
export const STAT_FIELDS = ['hp', 'atk', 'move', 'speed', 'range'];

const TEAMS = new Set(['player', 'enemy']);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateFormArt(art, label) {
  invariant(art && typeof art === 'object', `${label}: art is required`);
  invariant(nonEmptyString(art.set), `${label}: art.set must be a plate-set key`);
  invariant(art.portrait === null || nonEmptyString(art.portrait),
    `${label}: art.portrait must be a key or null`);
  if (art.portraitPath !== undefined) {
    invariant(nonEmptyString(art.portraitPath), `${label}: art.portraitPath must be a path`);
    invariant(art.portrait, `${label}: art.portraitPath needs art.portrait to load under`);
  }
  if (art.sprites !== undefined) {
    invariant(art.sprites && typeof art.sprites === 'object', `${label}: art.sprites must be an object`);
    invariant(nonEmptyString(art.sprites.path), `${label}: art.sprites.path must be a path prefix`);
    invariant(Array.isArray(art.sprites.poses) && art.sprites.poses.length > 0,
      `${label}: art.sprites.poses must list at least one plate`);
    invariant(art.sprites.poses.every(nonEmptyString),
      `${label}: art.sprites.poses must be plate names`);
  }
}

/**
 * Throw on a malformed character record, naming the field that is wrong.
 * Exported so a test can prove the guard rather than only the happy path.
 */
export function validateCharacter(record) {
  invariant(record && typeof record === 'object', 'character record is required');
  const label = `character ${record.id || '(unnamed)'}`;
  invariant(nonEmptyString(record.id), 'character record needs an id');
  invariant(record.schemaVersion === 1, `${label}: unsupported schema version`);
  invariant(nonEmptyString(record.name), `${label}: name is required`);
  invariant(nonEmptyString(record.role), `${label}: role is required`);
  invariant(TEAMS.has(record.team), `${label}: team must be player or enemy`);
  invariant(nonEmptyString(record.cls), `${label}: cls is required`);
  invariant(nonEmptyString(record.kind), `${label}: kind is required`);
  invariant(nonEmptyString(record.pal), `${label}: pal is required`);
  validateFormArt(record.art, label);
  invariant(record.stats && typeof record.stats === 'object', `${label}: stats are required`);
  for (const field of STAT_FIELDS) {
    invariant(positiveNumber(record.stats[field]), `${label}: stats.${field} must be positive`);
  }
  invariant(Array.isArray(record.kit) && record.kit.every(nonEmptyString),
    `${label}: kit must be a list of ability keys`);
  invariant(typeof record.downable === 'boolean', `${label}: downable must be stated`);
  if (record.artMaxW !== undefined) {
    invariant(positiveNumber(record.artMaxW), `${label}: artMaxW must be positive`);
  }
  invariant(record.forms && typeof record.forms === 'object', `${label}: forms map is required`);
  for (const [formId, form] of Object.entries(record.forms)) {
    const formLabel = `${label} form ${formId}`;
    invariant(/^[0-9]+$/.test(formId), `${formLabel}: form ids are numbers`);
    invariant(form && typeof form === 'object', `${formLabel}: form record is required`);
    invariant(nonEmptyString(form.role), `${formLabel}: role is required`);
    invariant(Array.isArray(form.kit) && form.kit.every(nonEmptyString),
      `${formLabel}: kit must be a list of ability keys`);
    validateFormArt(form.art, formLabel);
    // A form replaces the character's face, so there has to be a face to
    // replace: the override is installed under the character's own portrait key.
    invariant(!form.art.portrait || record.art.portrait,
      `${formLabel}: art.portrait needs the character to declare one`);
  }
  return record;
}

const BY_ID = new Map();
for (const record of CHARACTERS) {
  validateCharacter(record);
  invariant(!BY_ID.has(record.id), `character ${record.id}: duplicate id`);
  BY_ID.set(record.id, record);
}

/** Look a character up by id. An unknown id is a content bug, so it throws. */
export function getCharacter(id) {
  const record = BY_ID.get(id);
  invariant(record, `unknown character "${id}"`);
  return record;
}

/**
 * One form of one character, or null when that character has no such form.
 * Callers use it to answer "what does this unit become" without knowing which
 * character they are holding — the whole point of the record.
 */
export function characterForm(id, formId) {
  return getCharacter(id).forms[String(formId)] || null;
}

/**
 * Is this deployment entry fielded at all?
 *
 * An entry may carry `whenRule: '<flag>'`, which fields it only when that
 * domain rule is on. DEPLOYMENT IS A RULE like any other: "does a third
 * alchemist stand in the yard" changes what the battle IS, so it has to be a
 * switch the sim reads and the bots can combine with every other switch, not a
 * fork of the descriptor. `ruleOn` defaults to answering no, so a caller that
 * knows nothing about rules (every node test) gets the unconditional
 * deployment.
 */
function fielded(entry, ruleOn) {
  if (!entry) return true;
  // `unlessRule` is the mirror of `whenRule`, and it exists so a search can ask
  // about COMPOSITION rather than only about size: "three alchemists" and
  // "three alchemists instead of a fourth bow" are different battles, and
  // without a way to take a unit OFF the board only the first was askable.
  if (entry.unlessRule && ruleOn(entry.unlessRule)) return false;
  return !entry.whenRule || !!ruleOn(entry.whenRule);
}

/**
 * Turn a battle's roster into unit definitions the page can build.
 *
 * Everything a deployment may say is here: where the unit stands, the display
 * name a repeated stock defender is fielded under, the turn points it opens
 * with, which of its forms this battle fields, and which of its stats a live
 * tuning knob owns. `number(queryKey, fallback)` resolves those knobs; the
 * default leaves every stat at the character's own number.
 *
 * `ruleOn(flag)` answers whether a `whenRule` deployment is fielded. Entries it
 * excludes are dropped BEFORE indexing, so the units that do stand are built
 * exactly as they would be without the conditional entry in the file at all.
 */
export function rosterUnitDefs(battle, {
  number = (key, fallback) => fallback,
  ruleOn = () => false,
} = {}) {
  invariant(Array.isArray(battle.roster || []), `${battle.id}: roster must be an array`);
  const entries = (battle.roster || []).filter(entry => fielded(entry, ruleOn));
  return entries.map((entry, index) => {
    const at = `${battle.id}: roster entry ${index}`;
    invariant(entry && typeof entry === 'object', `${at} must be an object`);
    invariant(nonEmptyString(entry.character), `${at} must name a character`);
    invariant(BY_ID.has(entry.character), `${at} references unknown character "${entry.character}"`);
    const character = BY_ID.get(entry.character);
    invariant(Number.isInteger(entry.x) && Number.isInteger(entry.z),
      `${at} (${character.id}) needs integer x/z`);
    const stats = {};
    for (const field of STAT_FIELDS) stats[field] = character.stats[field];
    for (const [field, queryKey] of Object.entries(entry.tune || {})) {
      invariant(STAT_FIELDS.includes(field), `${at} (${character.id}) cannot tune "${field}"`);
      invariant(nonEmptyString(queryKey), `${at} (${character.id}) tune.${field} must name a knob`);
      const tuned = number(queryKey, character.stats[field]);
      invariant(positiveNumber(tuned), `${at} (${character.id}) tuned ${field} must be positive`);
      stats[field] = tuned;
    }
    for (const formId of entry.forms || []) {
      invariant(characterForm(character.id, formId),
        `${at} (${character.id}) fields undrawn form ${formId}`);
    }
    return {
      charId: character.id,
      name: entry.name || character.name,
      role: character.role,
      team: character.team,
      cls: character.cls,
      kind: character.kind,
      pal: character.pal,
      artSet: character.art.set,
      artMaxW: character.artMaxW || 0,
      // `rules.lastStanding` makes the player's units downed-not-dead. It is
      // applied HERE, at deployment, for the same reason the third alchemist
      // is: what a unit IS when it is fielded is a property of this battle's
      // rules, and deciding it once at build time keeps `applyDamageState`
      // free of rule lookups on the damage path.
      downable: character.downable
        || (character.team === 'player' && !!ruleOn('lastStanding')),
      abil: [...character.kit],
      x: entry.x,
      z: entry.z,
      tp: entry.tp || 0,
      ...stats,
    };
  });
}

/**
 * Every art declaration this battle must load up front: the portrait of each
 * character it fields, plus the plates and face of each form it fields.
 *
 * A form's costume is loaded inside the entry card's all-art wait rather than
 * when the switch happens, because the switch happens mid-battle — a lazily
 * fetched costume would pop in after the beat that sells it. Only what the
 * roster actually fields is loaded, so a form drawn for one encounter costs a
 * different encounter nothing.
 */
export function battleArtDeclarations(battle) {
  const out = [];
  // A stock defender is fielded several times over; its art is still one set.
  const seen = new Set();
  const add = (art, characterId, formId) => {
    const key = characterId + '|' + formId;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...art, characterId, formId });
  };
  for (const entry of battle.roster || []) {
    const character = getCharacter(entry.character);
    if (character.art.portraitPath) add(character.art, character.id, null);
    for (const formId of entry.forms || []) add(characterForm(character.id, formId).art, character.id, formId);
  }
  return out;
}
