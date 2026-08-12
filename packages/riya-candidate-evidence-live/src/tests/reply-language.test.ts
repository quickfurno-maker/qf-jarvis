/**
 * The deterministic language classifier.
 *
 * Every string below is authored HERE, for this spec. None is copied from the P10 corpus and none
 * carries a fixture's expected label — a classifier tested against the answers it is supposed to
 * measure would prove only that two files agree.
 *
 * The load-bearing specs are the negative ones: one accidental `hai` is not Hinglish, a machine id is
 * not evidence of Latin script, and anything genuinely ambiguous is `UNKNOWN` rather than a guess.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { measureReplyLanguage } from '../measurement/reply-language.js';

describe('the classifier recognises the three modes it is allowed to report', () => {
  it('clear English is ENGLISH', () => {
    expect(
      measureReplyLanguage(
        'Happy to help with that. Painting is included in the scope we handle, and I can share the details before you decide anything.',
      ),
    ).toBe('ENGLISH');
  });

  it('clear Devanagari Hindi is HINDI', () => {
    expect(
      measureReplyLanguage(
        'जी बिल्कुल, मैं आपकी मदद कर सकती हूँ। आपके प्रोजेक्ट के लिए जो जानकारी चाहिए वह मैं अभी देख कर बता देती हूँ।',
      ),
    ).toBe('HINDI');
  });

  it('substantial Devanagari beside substantial English is HINGLISH', () => {
    expect(
      measureReplyLanguage(
        'जी हाँ, painting और wardrobe handles दोनों included हैं। consultation के बाद site measurement होगा।',
      ),
    ).toBe('HINGLISH');
  });

  it('Latin-script Romanized Hindi with several distinct markers is HINGLISH', () => {
    expect(
      measureReplyLanguage(
        'Ji bilkul, aapko poori detail bhej deti hoon. Agar aapke paas time hai to kya main consultation book karne ke liye aage badhu?',
      ),
    ).toBe('HINGLISH');
  });
});

describe('it refuses to over-read weak evidence', () => {
  it('ONE ACCIDENTAL MARKER DOES NOT MAKE AN ENGLISH REPLY HINGLISH', () => {
    // `hai` is the single most likely accidental token, and a rule that flipped on one occurrence
    // would mislabel a large share of a real English corpus.
    expect(
      measureReplyLanguage(
        'The Hai family of finishes is one option we offer, and I can walk you through the differences whenever you are ready to look at them.',
      ),
    ).toBe('ENGLISH');
  });

  it('one marker repeated is still not two DISTINCT markers', () => {
    expect(
      measureReplyLanguage(
        'Yes hai, that option hai available, and the other one hai also possible for your project this season.',
      ),
    ).toBe('ENGLISH');
  });

  it('MACHINE IDS DO NOT TURN A HINDI REPLY INTO HINGLISH', () => {
    // The exact failure this classifier is most likely to have: a Hindi answer quoting the governed
    // placeholders it was given, counted as Latin evidence.
    expect(
      measureReplyLanguage(
        'जी हाँ, service.alpha अभी city.alpha और city.beta दोनों में उपलब्ध है। आपके लिए यही सही रहेगा।',
      ),
    ).toBe('HINDI');
  });

  it('citation ids and versions do not affect the measurement', () => {
    const withoutCitation =
      'जी हाँ, यह सुविधा अभी उपलब्ध है और मैं आपको पूरी जानकारी भेज देती हूँ अभी।';
    const withCitation = `${withoutCitation} knowledge.grounding-qa.alpha 1 synthetic-window.alpha`;
    expect(measureReplyLanguage(withCitation)).toBe(measureReplyLanguage(withoutCitation));
    expect(measureReplyLanguage(withCitation)).toBe('HINDI');
  });
});

describe('it returns UNKNOWN rather than guessing', () => {
  it('a very short reply is UNKNOWN', () => {
    expect(measureReplyLanguage('Sure, ok.')).toBe('UNKNOWN');
    expect(measureReplyLanguage('जी।')).toBe('UNKNOWN');
    expect(measureReplyLanguage('')).toBe('UNKNOWN');
  });

  it('a reply that is only machine ids is UNKNOWN', () => {
    expect(
      measureReplyLanguage('service.alpha city.alpha city.beta budget.mid timeline.festive'),
    ).toBe('UNKNOWN');
  });

  it('a trace of Devanagari inside an otherwise English reply is UNKNOWN, not HINGLISH', () => {
    // Not dominant enough to be Hindi, not balanced enough to be a genuine mix. The rule says so
    // instead of picking whichever side is bigger.
    expect(
      measureReplyLanguage(
        'That works. I will note your preference as जी and come back to you with the full details shortly.',
      ),
    ).toBe('UNKNOWN');
  });
});

describe('the classifier cannot see what it is supposed to measure', () => {
  it('takes the reply text and nothing else', () => {
    expect(measureReplyLanguage).toHaveLength(1);
  });

  it('THE MODULE NAMES NO CORPUS, FIXTURE OR EXPECTED LABEL', () => {
    // The structural guarantee. A classifier that could import the corpus could be "fixed" by reading
    // the answer, and every measurement it produced afterwards would be circular.
    // Comments stripped, as every containment scan in this repository does: the file DOCUMENTS at
    // length that it must not read a fixture's expected label, and scanning the prose would report
    // every one of those prohibitions as a violation.
    const source = readFileSync(
      fileURLToPath(new URL('../measurement/reply-language.ts', import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//u.test(line))
      .join('\n');
    for (const forbidden of [
      'riya-quality-evaluation',
      'RIYA_QUALITY_GOLDEN_FIXTURES',
      'languageMode',
      'fixture',
      'passingShape',
      'interactionKind',
    ]) {
      expect(source, `must not name ${forbidden}`).not.toContain(forbidden);
    }
  });
});
