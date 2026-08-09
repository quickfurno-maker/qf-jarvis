/**
 * RWC-P6A — the two governed advances (ADR-0101 §34).
 *
 * These functions are the last step of a decision Core already made, and the specs exist to pin the
 * two halves of that:
 *
 * - they cannot move without evidence — which is what turns "Core owns consent" from a sentence into
 *   a mechanism;
 * - they hold nothing about what the evidence proves, because a pure reducer that could reach Core
 *   would be a reducer that could decide.
 *
 * The one asymmetry is deliberate and worth reading twice: the CONTACT evidence is **required and
 * then discarded**, while the completion evidence is **required and then stored**. Continuity has a
 * field for the second and none for the first, and it must not acquire one.
 */
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { describe, expect, it } from 'vitest';

import {
  advanceRiyaAfterContactReady,
  completeRiyaAfterCoreSubmission,
  RiyaConversationCompletionError,
} from '../index.js';

const TENANT = 'tenant.a';
const CONVERSATION = 'conv.1';
const CONTACT_EVIDENCE = 'core.contact.evidence.1';
const COMPLETION_EVIDENCE = 'core.intake.evidence.1';

function confirmedAt(
  phase: 'CONTACT' | 'CONSENT' | 'COMPLETE',
  over: Partial<Parameters<typeof createRiyaConversationContinuityState>[0]> = {},
): RiyaConversationContinuityStateV1 {
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId: TENANT,
    conversationId: CONVERSATION,
    continuityRevision: 6,
    phase,
    discovery: {
      completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
      missingFields: [],
      serviceInterestRef: 'modular-kitchen',
      locationRef: 'loc.pune',
      budgetNote: 'around 8 lakh',
      timelineNote: 'next month',
    },
    fieldProvenance: {
      serviceInterest: 'user_confirmed',
      location: 'user_confirmed',
      budget: 'user_confirmed',
      timeline: 'user_confirmed',
    },
    summaryConfirmed: true,
    ...over,
  });
}

const refuses = (run: () => unknown, code: string): void => {
  let thrown: unknown;
  try {
    run();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(RiyaConversationCompletionError);
  expect((thrown as RiyaConversationCompletionError).code).toBe(code);
};

// ---------------------------------------------------------------------------
// CONTACT -> CONSENT.
// ---------------------------------------------------------------------------

describe('CONTACT to CONSENT, once Core holds contact', () => {
  it('advances the phase and exactly one revision', () => {
    const current = confirmedAt('CONTACT');
    const result = advanceRiyaAfterContactReady({
      current,
      contactEvidenceRef: CONTACT_EVIDENCE,
    });
    expect(result.state.phase).toBe('CONSENT');
    expect(result.state.continuityRevision).toBe(current.continuityRevision + 1);
    expect(result.state.summaryConfirmed).toBe(true);
  });

  it('the contact evidence is NOT persisted anywhere', () => {
    // Required as proof the caller had a governed answer; discarded because continuity has no field
    // for it and must not acquire one -- a copy in Jarvis would be a second place the same fact lives,
    // with its own erasure obligation and its own chance to go stale.
    const result = advanceRiyaAfterContactReady({
      current: confirmedAt('CONTACT'),
      contactEvidenceRef: CONTACT_EVIDENCE,
    });
    expect(result.state.completionEvidenceRef).toBeUndefined();
    expect(JSON.stringify(result.state)).not.toContain(CONTACT_EVIDENCE);
  });

  it('discovery and provenance are carried through untouched', () => {
    // Nothing about what the client wants changes because their phone number reached Core.
    const current = confirmedAt('CONTACT');
    const result = advanceRiyaAfterContactReady({
      current,
      contactEvidenceRef: CONTACT_EVIDENCE,
    });
    expect(JSON.stringify(result.state.discovery)).toBe(JSON.stringify(current.discovery));
    expect(JSON.stringify(result.state.fieldProvenance)).toBe(
      JSON.stringify(current.fieldProvenance),
    );
  });

  it('requires the CONTACT phase', () => {
    for (const phase of ['CONSENT', 'COMPLETE'] as const) {
      const current =
        phase === 'COMPLETE'
          ? confirmedAt('COMPLETE', { completionEvidenceRef: COMPLETION_EVIDENCE })
          : confirmedAt(phase);
      refuses(
        () => advanceRiyaAfterContactReady({ current, contactEvidenceRef: CONTACT_EVIDENCE }),
        'action-not-permitted',
      );
    }
  });

  it('requires governed evidence, and refuses anything that is not an opaque reference', () => {
    for (const forged of [
      '',
      'client@example.com',
      '+919876543210',
      'the client gave their number',
      'a'.repeat(129),
      'https://example.com/contact',
    ]) {
      refuses(
        () =>
          advanceRiyaAfterContactReady({
            current: confirmedAt('CONTACT'),
            contactEvidenceRef: forged,
          }),
        'invalid-evidence-ref',
      );
    }
  });

  it('refuses a human-review conversation', () => {
    refuses(
      () =>
        advanceRiyaAfterContactReady({
          current: confirmedAt('CONTACT', {
            discovery: {
              completeness: 'HUMAN_REVIEW_REQUIRED',
              missingFields: [],
              serviceInterestRef: 'modular-kitchen',
              locationRef: 'loc.pune',
              budgetNote: 'around 8 lakh',
              timelineNote: 'next month',
            },
          }),
          contactEvidenceRef: CONTACT_EVIDENCE,
        }),
      'action-not-permitted',
    );
  });

  it('refuses at the revision ceiling', () => {
    refuses(
      () =>
        advanceRiyaAfterContactReady({
          current: confirmedAt('CONTACT', { continuityRevision: Number.MAX_SAFE_INTEGER }),
          contactEvidenceRef: CONTACT_EVIDENCE,
        }),
      'action-not-permitted',
    );
  });
});

// ---------------------------------------------------------------------------
// CONSENT -> COMPLETE.
// ---------------------------------------------------------------------------

describe('CONSENT to COMPLETE, once Core accepted the submission', () => {
  it('stores the Core evidence exactly, and advances one revision', () => {
    const current = confirmedAt('CONSENT');
    const result = completeRiyaAfterCoreSubmission({
      current,
      completionEvidenceRef: COMPLETION_EVIDENCE,
    });
    expect(result.state.phase).toBe('COMPLETE');
    expect(result.state.completionEvidenceRef).toBe(COMPLETION_EVIDENCE);
    expect(result.state.continuityRevision).toBe(current.continuityRevision + 1);
  });

  it('changes nothing else about the conversation', () => {
    const current = confirmedAt('CONSENT');
    const result = completeRiyaAfterCoreSubmission({
      current,
      completionEvidenceRef: COMPLETION_EVIDENCE,
    });
    expect(JSON.stringify(result.state.discovery)).toBe(JSON.stringify(current.discovery));
    expect(JSON.stringify(result.state.fieldProvenance)).toBe(
      JSON.stringify(current.fieldProvenance),
    );
    expect(result.state.summaryConfirmed).toBe(true);
  });

  it('requires the CONSENT phase', () => {
    for (const phase of ['CONTACT', 'COMPLETE'] as const) {
      const current =
        phase === 'COMPLETE'
          ? confirmedAt('COMPLETE', { completionEvidenceRef: COMPLETION_EVIDENCE })
          : confirmedAt(phase);
      refuses(
        () =>
          completeRiyaAfterCoreSubmission({
            current,
            completionEvidenceRef: COMPLETION_EVIDENCE,
          }),
        'action-not-permitted',
      );
    }
  });

  it('requires governed evidence', () => {
    for (const forged of ['', 'client@example.com', 'lead created', 'x'.repeat(129)]) {
      refuses(
        () =>
          completeRiyaAfterCoreSubmission({
            current: confirmedAt('CONSENT'),
            completionEvidenceRef: forged,
          }),
        'invalid-evidence-ref',
      );
    }
  });

  it('the evidence grammar matches what continuity itself accepts', () => {
    // A reference this layer accepted and the state constructor refused would be a contract that
    // fails at the very last step. The proof is that the constructed state exists at all.
    const maximal = `core.${'e'.repeat(123)}`;
    expect(maximal).toHaveLength(128);
    const result = completeRiyaAfterCoreSubmission({
      current: confirmedAt('CONSENT'),
      completionEvidenceRef: maximal,
    });
    expect(result.state.completionEvidenceRef).toBe(maximal);
  });

  it('refuses a human-review conversation', () => {
    refuses(
      () =>
        completeRiyaAfterCoreSubmission({
          current: confirmedAt('CONSENT', {
            discovery: {
              completeness: 'HUMAN_REVIEW_REQUIRED',
              missingFields: [],
              serviceInterestRef: 'modular-kitchen',
              locationRef: 'loc.pune',
              budgetNote: 'around 8 lakh',
              timelineNote: 'next month',
            },
          }),
          completionEvidenceRef: COMPLETION_EVIDENCE,
        }),
      'action-not-permitted',
    );
  });

  it('refuses at the revision ceiling', () => {
    refuses(
      () =>
        completeRiyaAfterCoreSubmission({
          current: confirmedAt('CONSENT', { continuityRevision: Number.MAX_SAFE_INTEGER }),
          completionEvidenceRef: COMPLETION_EVIDENCE,
        }),
      'action-not-permitted',
    );
  });

  it('the result re-proves through the real continuity constructor', () => {
    // Which is what makes COMPLETE-requires-evidence an enforced invariant rather than a convention
    // this package happens to follow.
    const result = completeRiyaAfterCoreSubmission({
      current: confirmedAt('CONSENT'),
      completionEvidenceRef: COMPLETION_EVIDENCE,
    });
    expect(() =>
      createRiyaConversationContinuityState({
        version: 1,
        tenantId: result.state.tenantId,
        conversationId: result.state.conversationId,
        continuityRevision: result.state.continuityRevision,
        phase: result.state.phase,
        discovery: {
          completeness: result.state.discovery.completeness,
          missingFields: [...result.state.discovery.missingFields],
          serviceInterestRef: 'modular-kitchen',
          locationRef: 'loc.pune',
          budgetNote: 'around 8 lakh',
          timelineNote: 'next month',
        },
        fieldProvenance: { ...result.state.fieldProvenance },
        summaryConfirmed: true,
        completionEvidenceRef: COMPLETION_EVIDENCE,
      }),
    ).not.toThrow();
  });

  it('does not mutate the caller state', () => {
    const current = confirmedAt('CONSENT');
    const before = JSON.stringify(current);
    completeRiyaAfterCoreSubmission({ current, completionEvidenceRef: COMPLETION_EVIDENCE });
    expect(JSON.stringify(current)).toBe(before);
  });
});
