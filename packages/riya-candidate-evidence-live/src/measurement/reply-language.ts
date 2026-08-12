/**
 * The deterministic reply-language classifier (MVP-P2A.2, owner-locked algorithm).
 *
 * ### Why this exists and why it is this small
 *
 * P10 scores three language modes, and the bridge refuses to record a mode it cannot measure. The
 * repository owns no language authority, so the only alternatives were to block every P10 run
 * forever, to ask a model (an LLM judging an LLM's language is the closed loop RWC-P10 exists to
 * avoid), or to copy `fixture.languageMode` — which would record the answer the corpus hoped for and
 * make the measurement worthless.
 *
 * So: a written-down rule, small enough to review in one sitting, that returns `UNKNOWN` whenever it
 * is not confident. It is a MEASUREMENT, not a language model. The marker list below is deliberately
 * tiny and closed, and growing it to make a case pass would be exactly the overfitting this file is
 * written to resist.
 *
 * ### It cannot see the expectation
 *
 * The function takes one string. It has no fixture, no case id, no interaction kind, no passing shape
 * and no expected mode, and it imports nothing from the corpus — a spec asserts the module names no
 * corpus symbol at all. That is what makes a match between measured and expected mode evidence rather
 * than a tautology.
 */

/** What a reply's language was measured to be. `UNKNOWN` blocks the case; it never guesses. */
export type MeasuredLanguageMode = 'ENGLISH' | 'HINDI' | 'HINGLISH' | 'UNKNOWN';

/**
 * High-signal Romanized-Hindi markers.
 *
 * Chosen for one property: an English sales reply is very unlikely to contain two DISTINCT members of
 * this set. Deliberately excluded are `is`, `to`, `me`, `hi`, `no`, `so` and every other token that is
 * also an ordinary English word — a single accidental `hai` must not reclassify an English answer, and
 * a spec proves it does not.
 *
 * CLOSED. Do not extend this to make a test pass.
 */
const ROMANIZED_MARKERS: ReadonlySet<string> = new Set([
  'aap',
  'aapko',
  'aapke',
  'aapki',
  'hai',
  'hain',
  'ho',
  'hoga',
  'hogi',
  'honge',
  'kya',
  'kaise',
  'kyun',
  'nahi',
  'nahin',
  'chahiye',
  'karna',
  'karne',
  'karen',
  'karo',
  'liye',
  'bahut',
  'thoda',
  'sahi',
  'achha',
  'acha',
  'ji',
  'aur',
  'lekin',
  'agar',
]);

/**
 * Devanagari, INCLUDING its combining marks.
 *
 * The vowel signs are `\p{M}`, not `\p{L}`. Counting only letters would score "हाँ" as one unit
 * against Latin's three-per-syllable and undercount Devanagari by roughly half — which biases every
 * Hindi reply toward HINGLISH, the exact mistake this classifier exists to avoid. `Script=Devanagari`
 * covers letters and marks together, so the two scripts are compared on the characters actually
 * written.
 */
const DEVANAGARI = /\p{Script=Devanagari}/u;
/** A letter in any script — used only to decide whether a token is natural language at all. */
const LETTER = /\p{L}/u;
const LATIN = /\p{Script=Latin}/u;

/**
 * A MACHINE token, by shape rather than by a list of fixture ids.
 *
 * `service.alpha`, `city.beta`, `knowledge.grounding-qa.alpha`, `synthetic-window.alpha`, a bare
 * number and a hex blob are all identifiers a governed turn legitimately quotes. Left in, they add
 * Latin letters to a Hindi reply and turn it into fake Hinglish — the single most likely way this
 * classifier could be wrong about the corpus it will actually measure.
 *
 * Shape-based on purpose: a dotted or hyphenated lowercase identifier, a pure number, or a long
 * hex/id run. An ordinary human word survives all three.
 */
function isMachineToken(token: string): boolean {
  if (token.length === 0) {
    return true;
  }
  // A bare number, a version, or anything with no letter at all.
  if (!LETTER.test(token)) {
    return true;
  }
  // `service.alpha`, `budget.mid`, `knowledge.grounding-qa.alpha` — a dotted identifier.
  if (token.includes('.') && /^[a-z0-9][a-z0-9.\-_]*[a-z0-9]$/u.test(token)) {
    return true;
  }
  // `synthetic-window.alpha`, `gpt-oss-20b` — a hyphenated identifier carrying a digit or a dot.
  if (token.includes('-') && /^[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(token) && /\d/u.test(token)) {
    return true;
  }
  // A long hex/uuid-shaped run.
  if (/^[0-9a-f]{8,}$/u.test(token) || /^[0-9a-f-]{16,}$/u.test(token)) {
    return true;
  }
  return false;
}

/**
 * Split into candidate tokens on anything that is not a letter, a digit, a dot or a hyphen.
 *
 * Dots and hyphens are kept INSIDE tokens so `service.alpha` arrives whole and can be recognised as
 * one machine token; splitting on them first would leave `service` and `alpha` as two innocent-looking
 * Latin words.
 */
function tokenize(text: string): readonly string[] {
  // `\p{M}` is in the class so a Devanagari word survives as ONE token instead of being split at every
  // vowel sign. Without it "हाँ" arrives as "ह" and the matra is discarded as a separator.
  return text.split(/[^\p{L}\p{M}\p{N}.\-_]+/u).filter((token) => token.length > 0);
}

/** Count letters of one script across a set of tokens. */
function scriptLetters(tokens: readonly string[], script: RegExp): number {
  let count = 0;
  for (const token of tokens) {
    for (const character of token) {
      if (script.test(character)) {
        count += 1;
      }
    }
  }
  return count;
}

/** Below either bound there is not enough natural language to decide anything honestly. */
const MIN_NATURAL_TOKENS = 4;
const MIN_ALPHABETIC_LETTERS = 12;
/** The script-count floor each side of a genuinely mixed reply must clear. */
const MIN_SCRIPT_LETTERS = 8;

/**
 * Measure the language of a USER-VISIBLE reply body.
 *
 * The only argument is the reply. Nothing about the case, the fixture or the expectation is in scope,
 * and that is enforced by the signature rather than by discipline.
 */
export function measureReplyLanguage(replyText: string): MeasuredLanguageMode {
  // NFKC first: a composed and a decomposed Devanagari vowel sign must count the same, and
  // full-width Latin must not read as a separate script.
  const normalized = replyText.normalize('NFKC').toLowerCase();

  const natural = tokenize(normalized).filter((token) => !isMachineToken(token));
  if (natural.length < MIN_NATURAL_TOKENS) {
    return 'UNKNOWN';
  }

  const devanagari = scriptLetters(natural, DEVANAGARI);
  const latin = scriptLetters(natural, LATIN);
  const total = devanagari + latin;
  if (total < MIN_ALPHABETIC_LETTERS) {
    return 'UNKNOWN';
  }

  // HINDI first, and the order matters. An otherwise-Hindi answer that says "painting" or
  // "consultation" is a Hindi answer; treating it as Hinglish would penalise the corpus for using the
  // words a real client uses.
  if (devanagari >= MIN_SCRIPT_LETTERS && devanagari / total >= 0.65) {
    return 'HINDI';
  }

  // Genuinely mixed script, with both sides materially present.
  if (
    devanagari >= MIN_SCRIPT_LETTERS &&
    latin >= MIN_SCRIPT_LETTERS &&
    devanagari / total >= 0.25 &&
    latin / total >= 0.25
  ) {
    return 'HINGLISH';
  }

  // Some Devanagari, but not enough to be dominant and not enough to be a balanced mix. That is the
  // ambiguous middle, and the honest answer is that this rule cannot tell.
  if (devanagari > 0 && devanagari < MIN_SCRIPT_LETTERS && latin >= MIN_SCRIPT_LETTERS) {
    return 'UNKNOWN';
  }

  // Latin script only. Romanized Hindi is what people actually type, so it is a real mode rather than
  // broken English — but it has to be PROVED, by two distinct markers and a marker density that an
  // English sentence would not reach by accident.
  if (latin >= MIN_ALPHABETIC_LETTERS && devanagari === 0) {
    const latinWords = natural.filter((token) => LATIN.test(token));
    let occurrences = 0;
    const distinct = new Set<string>();
    for (const word of latinWords) {
      if (ROMANIZED_MARKERS.has(word)) {
        occurrences += 1;
        distinct.add(word);
      }
    }
    if (latinWords.length === 0) {
      return 'UNKNOWN';
    }
    if (distinct.size >= 2 && occurrences / latinWords.length >= 0.15) {
      return 'HINGLISH';
    }
    return 'ENGLISH';
  }

  return 'UNKNOWN';
}
