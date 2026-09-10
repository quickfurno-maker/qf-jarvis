/**
 * JF-3 matrix items 41–44 — language neutrality (ADR-0148 §6).
 *
 * The customers this system will eventually serve write in Hindi and in Hinglish, so "it works" has to
 * mean "it works in the scripts the business actually uses". Exact retrieval makes that easy to get
 * right and easy to get subtly wrong: nothing here normalises, transliterates, folds, collates or
 * length-counts text in a way that could treat one script differently from another.
 *
 * The content below is synthetic and says so in its own text. The record IDENTIFIERS stay ASCII
 * because the governed contract requires it; only the CONTENT varies by script, which is exactly the
 * split that matters — identity is machine-owned, content is business-owned.
 */
import { describe, expect, it } from 'vitest';

import { invokeRagRetrieval } from '../service/invoke-rag-retrieval.js';
import {
  activeProvisioner,
  digest,
  testBackend,
  testRecordInput,
  testRequest,
} from './knowledge-fixtures.js';

const HINDI_CONTENT = 'सिंथेटिक परीक्षण रिकॉर्ड। यह व्यावसायिक सत्य नहीं है।';
const HINGLISH_CONTENT =
  'SYNTHETIC test record. Yeh sirf ek spec ke liye banaya gaya hai, business truth nahi.';

const HINDI = testRecordInput({
  knowledgeId: 'kb.synthetic.hindi',
  topic: 'synthetic-hindi',
  content: HINDI_CONTENT,
  contentDigest: digest('1'),
});
const HINGLISH = testRecordInput({
  knowledgeId: 'kb.synthetic.hinglish',
  topic: 'synthetic-hinglish',
  content: HINGLISH_CONTENT,
  contentDigest: digest('2'),
});
const ASCII = testRecordInput();

describe('JF-3 language neutrality', () => {
  it('(JF3-41) a Hindi record round-trips unchanged, code point for code point', () => {
    const outcome = invokeRagRetrieval(
      activeProvisioner(testBackend([HINDI])),
      testRequest({ selectors: { topics: ['synthetic-hindi'] } }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const content = outcome.records[0]?.record.content;
    expect(content).toBe(HINDI_CONTENT);
    // Not normalised, not re-encoded, not stripped of combining marks. `===` on the string is the
    // whole assertion; the code-point check is here so a failure says WHY rather than printing two
    // strings that look identical in a terminal.
    expect(Array.from(content ?? '', (c) => c.codePointAt(0))).toEqual(
      Array.from(HINDI_CONTENT, (c) => c.codePointAt(0)),
    );
    // The character budget counts what JavaScript counts. No script gets a different ruler.
    expect(outcome.counters.augmentedCharacterCount).toBe(HINDI_CONTENT.length);
  });

  it('(JF3-42) a Hinglish record round-trips unchanged', () => {
    const outcome = invokeRagRetrieval(
      activeProvisioner(testBackend([HINGLISH])),
      testRequest({ selectors: { topics: ['synthetic-hinglish'] } }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.records[0]?.record.content).toBe(HINGLISH_CONTENT);
    expect(outcome.counters.augmentedCharacterCount).toBe(HINGLISH_CONTENT.length);
  });

  it('(JF3-43) citation identity is independent of the content language', () => {
    const outcome = invokeRagRetrieval(
      activeProvisioner(testBackend([HINDI, HINGLISH, ASCII])),
      testRequest({
        selectors: {
          ids: [
            { knowledgeId: HINDI.knowledgeId, version: 1 },
            { knowledgeId: HINGLISH.knowledgeId, version: 1 },
            { knowledgeId: ASCII.knowledgeId, version: 1 },
          ],
        },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    // Every citation is built from the same fields in the same way, whatever script the content is in.
    for (const entry of outcome.records) {
      expect(entry.citation.knowledgeId).toBe(entry.record.knowledgeId);
      expect(entry.citation.contentDigest).toBe(entry.record.contentDigest);
      expect(entry.citation.sourceRevision).toBe(entry.record.sourceRevision);
      expect(Object.keys(entry.citation).sort()).toEqual([
        'authorityTier',
        'contentDigest',
        'effectiveFrom',
        'expiresAt',
        'knowledgeId',
        'sourceRef',
        'sourceRevision',
        'version',
      ]);
    }
  });

  it('(JF3-44) ordering is deterministic and independent of language', () => {
    // Order follows the SELECTOR, not the text. A collation that sorted by content would put records
    // in different orders for different scripts -- and ordering is what a reader treats as priority.
    const provisioner = activeProvisioner(testBackend([HINDI, HINGLISH, ASCII]));
    const forward = testRequest({
      selectors: { topics: ['synthetic-hindi', 'synthetic-hinglish', 'synthetic-alpha'] },
    });
    const reversed = testRequest({
      selectors: { topics: ['synthetic-alpha', 'synthetic-hinglish', 'synthetic-hindi'] },
    });

    const a = invokeRagRetrieval(provisioner, forward);
    const b = invokeRagRetrieval(provisioner, reversed);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }
    expect(a.records.map((r) => r.record.topic)).toEqual([
      'synthetic-hindi',
      'synthetic-hinglish',
      'synthetic-alpha',
    ]);
    expect(b.records.map((r) => r.record.topic)).toEqual([
      'synthetic-alpha',
      'synthetic-hinglish',
      'synthetic-hindi',
    ]);
    // And repeating the same request gives byte-identical output, script mix included.
    expect(JSON.stringify(invokeRagRetrieval(provisioner, forward))).toBe(JSON.stringify(a));
  });
});
