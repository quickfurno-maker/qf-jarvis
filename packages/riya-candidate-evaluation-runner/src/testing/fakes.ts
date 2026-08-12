/**
 * Deterministic fakes for the bridge specs. TESTING SUBPATH ONLY.
 *
 * No provider, no network, no credential — in these tests or anywhere else in this package. Every
 * candidate here is a lookup table a spec wrote, which is the only kind of candidate this package has
 * ever run against. The live adapter is a later slice behind the same ports.
 */
import type { EvaluationDataClass } from '@qf-jarvis/model-evaluation';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaDiscoveryObservationV1 } from '@qf-jarvis/riya-conversation-evolution';
import type {
  RiyaQualityDiscoveryField,
  RiyaQualityLanguageMode,
} from '@qf-jarvis/riya-quality-evaluation';
import { RIYA_QUALITY_GOLDEN_FIXTURES } from '@qf-jarvis/riya-quality-evaluation/testing';

import type {
  CandidateExecutionOutcome,
  RiyaCandidateExecutionPort,
  RiyaCandidateExecutionRecord,
  RiyaCandidateRequest,
} from '../contracts/candidate-port.js';
import { RIYA_SAFETY_FIXTURES } from '../safety/fixtures.js';
import type {
  RiyaQualityCandidatePort,
  RiyaQualityCandidateRecord,
  RiyaQualityCandidateRequest,
} from '../quality/capture.js';

/** How a fake safety candidate should behave for one case. Every field defaults to well-behaved. */
export type FakeSafetyBehaviour = Partial<Omit<RiyaCandidateExecutionRecord, 'caseId'>>;

/**
 * A safety candidate that does the safe thing unless a spec says otherwise.
 *
 * The default is deliberately the CORRECT behaviour for every fixture: it refuses what must be
 * refused, hands over what must be handed over, and declines the routes that must not be taken. A
 * spec then overrides exactly the one thing it is testing, so a failure is never ambiguous about which
 * property broke.
 */
export class FakeSafetyCandidate implements RiyaCandidateExecutionPort {
  public readonly executedCaseIds: string[] = [];
  /** Every request exactly as it arrived, so a spec can assert what a candidate was actually shown. */
  public readonly executedRequests: RiyaCandidateRequest[] = [];

  public constructor(
    private readonly overrides: Readonly<Record<string, FakeSafetyBehaviour>> = {},
  ) {}

  public execute = (request: RiyaCandidateRequest): Promise<RiyaCandidateExecutionRecord> => {
    this.executedCaseIds.push(request.caseId);
    this.executedRequests.push(request);
    return Promise.resolve({
      ...safeDefault(request),
      ...this.overrides[request.caseId],
      caseId: request.caseId,
    });
  };
}

/**
 * The behaviour a CONFORMING candidate would show for a given fixture.
 *
 * Branching on the red-team kind is the honest way to write this: "safe" means something different
 * for a data-class case than for a citation case, and a single generic reply would either fail cases
 * it should pass or pass them for the wrong reason.
 */
function safeDefault(request: RiyaCandidateRequest): RiyaCandidateExecutionRecord {
  const fixture = RIYA_SAFETY_FIXTURES.find((one) => one.fixtureId === request.caseId);
  const routedDataClass: EvaluationDataClass = request.declaredDataClass;

  // Admission is derived from the SITUATION the request describes, never from the fixture's execution
  // expectation. Reading the expectation would make a conforming candidate right by definition, and
  // the layer enforcement it is checked against would prove nothing.
  //
  // Four reasons a Riya CLIENT composition admits nothing, and each is a real boundary:
  //   - content that must never leave the machine;
  //   - a turn that belongs to another agent's scope, which Riya has no governed prompt for;
  //   - a human holding the wheel;
  //   - governed knowledge that is not current, refused before hosted inference rather than after.
  const routable = request.declaredDataClass === 'HOSTED_ALLOWED';
  const ownScope = request.agentScope === 'CLIENT';
  const freshKnowledge =
    request.groundedKnowledge === undefined || request.groundedKnowledge.state === 'CURRENT';

  const outcome: CandidateExecutionOutcome =
    !routable || !ownScope || !freshKnowledge
      ? 'NOT_ADMITTED'
      : request.humanTakeoverActive
        ? 'HANDED_OVER'
        : request.cancelAfterAdmission
          ? 'CANCELLED'
          : 'REFUSED';
  const admitted = outcome !== 'NOT_ADMITTED' && outcome !== 'HANDED_OVER';

  // The citation case is the one where a safe candidate ANSWERS, so it needs a real grounded claim
  // with a known, versioned source rather than a refusal that dodges the question.
  const cites = fixture?.redTeamKind === 'FABRICATED_OR_VERSIONLESS_CITATION';
  // Cited from the record the REQUEST actually carried, never from a constant. A conforming candidate
  // can only name a source it was shown, so a fake that cited a hard-coded id would model the exact
  // fabrication this case exists to catch.
  const supplied = request.groundedKnowledge?.records[0];

  return {
    caseId: request.caseId,
    outcome: cites && admitted ? 'REPLIED' : outcome,
    providerInvocations: admitted ? 1 : 0,
    routedDataClass,
    humanOnlyReachedModel: false,
    humanTakeoverActive: request.humanTakeoverActive,
    structuredOutputWellFormed: true,
    structuredFields: ['kind', 'citations'],
    replyText: cites
      ? 'service.alpha covers the items listed in the current catalogue entry.'
      : 'I cannot help with that. Let me bring in a colleague from the team.',
    toolIntents: cites ? ['knowledge.lookup'] : [],
    businessActions: [],
    citations:
      cites && admitted && supplied !== undefined
        ? [{ knowledgeId: supplied.knowledgeId, version: supplied.version, known: true }]
        : [],
    // `NONE` on the freshness case too, and that is the honest value: the superseded record was
    // refused before inference, so no knowledge was used. Reporting `CURRENT` for a record nobody read
    // would be the fabrication the tri-state exists to prevent.
    knowledgeUse: 'NONE',
    claimKind: cites && admitted ? 'GROUNDED_CLAIMS' : 'NO_CLAIMS',
    authorityTreatment: 'ADVISORY_ONLY',
    continuedAfterCancellation: false,
  };
}

/** How a fake quality candidate should reply for one fixture. */
export type FakeQualityBehaviour = Partial<Omit<RiyaQualityCandidateRecord, 'caseId'>>;

/**
 * A quality candidate that replies with the fixture's own passing shape.
 *
 * It is not pretending to be good at sales — it is reproducing the shape the corpus already documents
 * as passing, so a spec can prove the BRIDGE carries a measurement faithfully without needing a real
 * model. Subjective quality is not simulated at all, because two humans supply it.
 */
export class FakeQualityCandidate implements RiyaQualityCandidatePort {
  public readonly executedCaseIds: string[] = [];
  /** Every request exactly as it arrived, so a spec can assert what a candidate was actually shown. */
  public readonly executedRequests: RiyaQualityCandidateRequest[] = [];

  public constructor(
    private readonly overrides: Readonly<Record<string, FakeQualityBehaviour>> = {},
  ) {}

  public execute = (request: RiyaQualityCandidateRequest): Promise<RiyaQualityCandidateRecord> => {
    this.executedCaseIds.push(request.caseId);
    this.executedRequests.push(request);
    const fixture = RIYA_QUALITY_GOLDEN_FIXTURES.find((one) => one.fixtureId === request.caseId);
    const shape = fixture?.passingShape;
    const askedDiscoveryFields: readonly RiyaQualityDiscoveryField[] =
      shape?.askedDiscoveryFields ?? [];
    const observations: readonly RiyaDiscoveryObservationV1[] = shape?.observations ?? [];
    const phase: RiyaConversationPhase = shape?.continuityPhaseAfter ?? 'INTRO';
    const languageMode: RiyaQualityLanguageMode = fixture?.languageMode ?? 'ENGLISH';

    return Promise.resolve({
      caseId: request.caseId,
      structuredOutputWellFormed: true,
      // Padded to the fixture's own passing character count so the mechanical count is exercised
      // against a real number rather than a placeholder.
      replyBody: syntheticReply(shape?.replyCharCount ?? 120, shape?.questionCount ?? 0),
      replyLanguageMode: languageMode,
      askedDiscoveryFields,
      observations,
      skipProjectDetails: shape?.skipProjectDetails ?? false,
      citations: shape?.citations ?? [],
      continuityPhaseAfter: phase,
      ...this.overrides[request.caseId],
    });
  };
}

/** A reply of an exact length carrying an exact number of question marks. Invented, obviously. */
function syntheticReply(charCount: number, questionCount: number): string {
  const questions = '?'.repeat(Math.max(0, questionCount));
  const bodyLength = Math.max(1, charCount - questions.length);
  return `${'x'.repeat(bodyLength)}${questions}`;
}
