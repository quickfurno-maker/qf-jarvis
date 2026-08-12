/**
 * P10 candidate CAPTURE (MVP-P2A.1).
 *
 * ### The corpus is not touched
 *
 * The governed 72-fixture golden corpus is consumed exactly as it ships. There is no second corpus, no
 * "MVP subset" and no reduced suite for speed — a thinner exam would make the number easier to pass
 * and worth less, which is the opposite of the point.
 *
 * ### Counts are computed here, not reported
 *
 * `replyCharCount` and `questionCount` are derived by this file from the reply itself, so an adapter
 * cannot report a flattering figure. Both are mechanical by definition: characters are `String.length`
 * and a question is a `?`. That definition is crude and it is written down rather than hidden, which
 * is what makes it a measurement two runs can share.
 *
 * ### Subjective fields are absent, not inferred
 *
 * A capture carries no dimension verdicts. Clarity, empathy, objection handling and the rest come from
 * two independent humans and from nowhere else — this file could not produce them honestly and does not
 * try. It also refuses to guess the one semantic field the observation contract needs: a reply whose
 * language mode the adapter cannot determine fails its case rather than being recorded as the mode the
 * fixture hoped for.
 */
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaDiscoveryObservationV1 } from '@qf-jarvis/riya-conversation-evolution';
import type {
  RiyaQualityDiscoveryField,
  RiyaQualityLanguageMode,
} from '@qf-jarvis/riya-quality-evaluation';
import { RIYA_QUALITY_GOLDEN_FIXTURES } from '@qf-jarvis/riya-quality-evaluation/testing';
import type { RiyaQualityGoldenFixture } from '@qf-jarvis/riya-quality-evaluation/testing';

import { createCandidateGroundedKnowledgeInput } from '../contracts/candidate-port.js';
import type { CandidateGroundedKnowledgeInput } from '../contracts/candidate-port.js';

/**
 * What the bridge sends: the synthetic client turn and the conversation state it arrives in.
 *
 * ### Why the phase has to travel
 *
 * P10 measures CONTEXTUAL sales behaviour. A governed case whose conversation has already reached
 * `SUMMARY` or `COMPLETE` is asking a different question than the same sentence at `NEED` — the right
 * answer to "what about the price?" after a summary is not the right answer during discovery. A
 * candidate evaluated as a fresh `NEED` turn would be scored against a scenario it was never placed in.
 *
 * ### What is deliberately absent
 *
 * No `passingShape`, no expected observations, no forbidden fields, no allowed asked-fields, no reply
 * or question ceiling, no required dimensions, no required citation, no allowed phases after. Those
 * are the marking scheme. The candidate gets the situation.
 *
 * ### The honest limit of V1
 *
 * The governed corpus encodes a starting phase and one synthetic client turn — it does not carry prior
 * conversation history. So P10 V1 is a single-turn exam WITH phase context, and this request says
 * exactly that much. Inventing history here to make it feel richer would mean evaluating against a
 * conversation the corpus never governed.
 */
export interface RiyaQualityCandidateRequest {
  readonly caseId: string;
  readonly syntheticUserText: string;
  /** The governed continuity phase the conversation is in BEFORE this turn. */
  readonly continuityPhaseBefore: RiyaConversationPhase;
  /**
   * The synthetic governed knowledge for the eighteen citation-required cases.
   *
   * Copied from the fixture's OWN input bytes, never from `passingShape.citations`. Reading the
   * expected citation and handing it over as input would mean the candidate was told which source to
   * name — the exact answer-key leak this request exists to avoid — and the corpus consistency spec
   * exists so the two can be checked against each other without one being derived from the other.
   */
  readonly groundedKnowledge?: CandidateGroundedKnowledgeInput;
}

/**
 * What a Riya candidate turn observably produced.
 *
 * `replyLanguageMode` may be `UNKNOWN`: identifying the language a reply is written in is not something
 * the typed result proves, and an adapter that cannot determine it must say so.
 */
export interface RiyaQualityCandidateRecord {
  readonly caseId: string;
  readonly structuredOutputWellFormed: boolean;
  /** The user-visible reply body. Content-bearing; it reaches only the blinded review bundle. */
  readonly replyBody: string;
  readonly replyLanguageMode: RiyaQualityLanguageMode | 'UNKNOWN';
  readonly askedDiscoveryFields: readonly RiyaQualityDiscoveryField[];
  readonly observations: readonly RiyaDiscoveryObservationV1[];
  readonly skipProjectDetails: boolean;
  readonly citations: readonly { readonly knowledgeId: string; readonly version: number }[];
  readonly continuityPhaseAfter: RiyaConversationPhase;
}

export interface RiyaQualityCandidatePort {
  execute: (request: RiyaQualityCandidateRequest) => Promise<RiyaQualityCandidateRecord>;
}

/** Why a fixture produced no usable capture. Content-free. */
export const QUALITY_CAPTURE_INCOMPLETE_REASONS = [
  'case-mismatch',
  'structured-output-invalid',
  'language-mode-unknown',
  'empty-reply',
] as const;
export type QualityCaptureIncompleteReason = (typeof QUALITY_CAPTURE_INCOMPLETE_REASONS)[number];

/** One measured case, plus the two content-bearing strings the review bundle needs. */
export interface RiyaQualityCandidateCapture {
  /** The anonymous reference a reviewer sees. Reveals no provider, model, size or cost. */
  readonly caseRef: string;
  readonly fixtureId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly languageMode: RiyaQualityLanguageMode;
  readonly replyCharCount: number;
  readonly questionCount: number;
  readonly askedDiscoveryFields: readonly RiyaQualityDiscoveryField[];
  readonly observations: readonly RiyaDiscoveryObservationV1[];
  readonly skipProjectDetails: boolean;
  readonly citations: readonly { readonly knowledgeId: string; readonly version: number }[];
  readonly continuityPhaseAfter: RiyaConversationPhase;
  /** Content-bearing. Never logged, never in a PR body, never in a content-free artifact. */
  readonly syntheticUserText: string;
  readonly replyBody: string;
}

export interface RiyaQualityCaptureIncomplete {
  readonly fixtureId: string;
  readonly reason: QualityCaptureIncompleteReason;
}

export type RiyaQualityCaptureResult =
  | { readonly ok: true; readonly captures: readonly RiyaQualityCandidateCapture[] }
  | { readonly ok: false; readonly incomplete: readonly RiyaQualityCaptureIncomplete[] };

/** A question is a `?`. Crude, deterministic, and stated rather than assumed. */
function countQuestions(reply: string): number {
  let count = 0;
  for (const character of reply) {
    if (character === '?') {
      count += 1;
    }
  }
  return count;
}

/** `case-01`, `case-02`, … Stable for a given corpus order, and it names nothing. */
function caseRefFor(index: number): string {
  return `case-${String(index + 1).padStart(3, '0')}`;
}

/**
 * Run every governed fixture once through the candidate port.
 *
 * Sequential and in corpus order, so a partial failure is reproducible and a reviewer bundle built
 * twice from the same run is byte-identical.
 */
export async function captureRiyaQualityCandidates(options: {
  readonly port: RiyaQualityCandidatePort;
  /** Defaults to the governed corpus. A spec may narrow it; a live evidence run must not. */
  readonly fixtures?: readonly RiyaQualityGoldenFixture[];
}): Promise<RiyaQualityCaptureResult> {
  const fixtures = options.fixtures ?? RIYA_QUALITY_GOLDEN_FIXTURES;
  const captures: RiyaQualityCandidateCapture[] = [];
  const incomplete: RiyaQualityCaptureIncomplete[] = [];

  for (const [index, fixture] of fixtures.entries()) {
    // Proven through the bridge's own constructor rather than passed through: a corpus is data, and
    // data that reaches a candidate unchecked is data that can exceed the bound a real grounded turn
    // enforces.
    const knowledge =
      fixture.syntheticGroundedKnowledge === undefined
        ? undefined
        : createCandidateGroundedKnowledgeInput(fixture.syntheticGroundedKnowledge);

    const record = await options.port.execute({
      caseId: fixture.fixtureId,
      syntheticUserText: fixture.syntheticUserText,
      continuityPhaseBefore: fixture.scenario.phase,
      ...(knowledge === undefined ? {} : { groundedKnowledge: knowledge }),
    });

    if (record.caseId !== fixture.fixtureId) {
      incomplete.push({ fixtureId: fixture.fixtureId, reason: 'case-mismatch' });
      continue;
    }
    if (!record.structuredOutputWellFormed) {
      // A reply the strict schema refused is not a quality measurement; it is a protocol failure, and
      // the safety suite is where a candidate answers for it.
      incomplete.push({ fixtureId: fixture.fixtureId, reason: 'structured-output-invalid' });
      continue;
    }
    if (record.replyBody.length === 0) {
      incomplete.push({ fixtureId: fixture.fixtureId, reason: 'empty-reply' });
      continue;
    }
    if (record.replyLanguageMode === 'UNKNOWN') {
      incomplete.push({ fixtureId: fixture.fixtureId, reason: 'language-mode-unknown' });
      continue;
    }

    captures.push(
      Object.freeze({
        caseRef: caseRefFor(index),
        fixtureId: fixture.fixtureId,
        scenarioId: fixture.scenario.scenarioId,
        scenarioVersion: fixture.scenario.scenarioVersion,
        languageMode: record.replyLanguageMode,
        replyCharCount: record.replyBody.length,
        questionCount: countQuestions(record.replyBody),
        askedDiscoveryFields: Object.freeze([...record.askedDiscoveryFields]),
        observations: Object.freeze([...record.observations]),
        skipProjectDetails: record.skipProjectDetails,
        citations: Object.freeze(record.citations.map((one) => Object.freeze({ ...one }))),
        continuityPhaseAfter: record.continuityPhaseAfter,
        syntheticUserText: fixture.syntheticUserText,
        replyBody: record.replyBody,
      }),
    );
  }

  if (incomplete.length > 0) {
    return { ok: false, incomplete: Object.freeze(incomplete) };
  }
  return { ok: true, captures: Object.freeze(captures) };
}
