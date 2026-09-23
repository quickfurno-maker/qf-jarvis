import { describe, expect, it } from 'vitest';

import { assessKnowledgeCandidate, assessKnowledgeFreshness } from '../index.js';

const digest = (char: string): string => char.repeat(64);

const source = (
  sourceRef: string,
  sourceRevision: string,
  contentDigest: string,
  approvedForProduction = true,
) => ({
  sourceRef,
  sourceRevision,
  contentDigest,
  ownerRef: 'owner.knowledge',
  approvedForProduction,
});

describe('knowledge freshness', () => {
  it('does nothing when exact revisions and digests are unchanged', () => {
    const accepted = [source('policy.a', 'rev.1', digest('a'))];
    const report = assessKnowledgeFreshness(accepted, accepted);
    expect(report.requiresCandidateRelease).toBe(false);
    expect(assessKnowledgeCandidate({ freshness: report, observedSources: accepted, evaluationPassed: true }))
      .toEqual({ decision: 'NO_CHANGE', sourceCount: 1 });
  });

  it('detects changed, new and missing sources explicitly', () => {
    const report = assessKnowledgeFreshness(
      [source('policy.a', 'rev.1', digest('a')), source('policy.old', 'rev.1', digest('b'))],
      [source('policy.a', 'rev.2', digest('c')), source('policy.new', 'rev.1', digest('d'))],
    );

    expect(report.records.map((item) => [item.sourceRef, item.drift])).toEqual([
      ['policy.a', 'CHANGED'],
      ['policy.new', 'NEW'],
      ['policy.old', 'MISSING'],
    ]);
  });

  it('blocks a staging build when any observed source lacks production approval', () => {
    const accepted = [source('policy.a', 'rev.1', digest('a'))];
    const observed = [source('policy.a', 'rev.2', digest('b'), false)];
    const freshness = assessKnowledgeFreshness(accepted, observed);
    expect(
      assessKnowledgeCandidate({ freshness, observedSources: observed, evaluationPassed: true }),
    ).toEqual({ decision: 'BLOCKED_UNAPPROVED_SOURCE', sourceCount: 1 });
  });

  it('blocks source disappearance rather than silently shrinking the corpus', () => {
    const accepted = [source('policy.a', 'rev.1', digest('a'))];
    const freshness = assessKnowledgeFreshness(accepted, []);
    expect(
      assessKnowledgeCandidate({ freshness, observedSources: [], evaluationPassed: true }),
    ).toEqual({ decision: 'BLOCKED_MISSING_SOURCE', sourceCount: 0 });
  });

  it('requires evaluation evidence before a changed approved set is staging-eligible', () => {
    const accepted = [source('policy.a', 'rev.1', digest('a'))];
    const observed = [source('policy.a', 'rev.2', digest('b'))];
    const freshness = assessKnowledgeFreshness(accepted, observed);

    expect(
      assessKnowledgeCandidate({ freshness, observedSources: observed, evaluationPassed: false }),
    ).toEqual({ decision: 'BLOCKED_EVALUATION', sourceCount: 1 });
    expect(
      assessKnowledgeCandidate({ freshness, observedSources: observed, evaluationPassed: true }),
    ).toEqual({ decision: 'ELIGIBLE_FOR_STAGING_BUILD', sourceCount: 1 });
  });

  it('refuses ambiguous duplicate source identities', () => {
    const duplicate = [
      source('policy.a', 'rev.1', digest('a')),
      source('policy.a', 'rev.2', digest('b')),
    ];
    expect(() => assessKnowledgeFreshness([], duplicate)).toThrow(
      'knowledge-source-fingerprint-invalid',
    );
  });
});
