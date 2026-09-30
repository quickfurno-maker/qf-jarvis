import {
  planClientNextBestAction,
  type ClientNextBestActionInput,
} from '@qf-jarvis/client-intelligence';
import {
  runDigitalTwinSuite,
  type DigitalTwinCandidate,
  type DigitalTwinScenario,
} from '@qf-jarvis/digital-twin-simulation';

import type {
  AgentFlowRegressionScenarioDefinition,
  AgentFlowRegressionSummary,
} from './contracts.js';

function scenario(
  scenarioId: string,
  label: string,
  category: AgentFlowRegressionScenarioDefinition['category'],
  expectedDecision: string,
  syntheticInput: AgentFlowRegressionScenarioDefinition['syntheticInput'],
  protectedAssertions: readonly string[],
): AgentFlowRegressionScenarioDefinition {
  return Object.freeze({
    scenarioId,
    label,
    category,
    expectedDecision,
    syntheticInput: Object.freeze({ ...syntheticInput }),
    protectedAssertions: Object.freeze([...protectedAssertions]),
  });
}

const COMMON = Object.freeze([
  'zero-effects',
  'core-authority-preserved',
  'no-direct-provider-send',
]);

export const RIYA_CLIENT_INTELLIGENCE_REGRESSION_CANDIDATE_REF =
  'client-intelligence.planClientNextBestAction@c45bf5f43ae4d963e3031bdcdfd96ff5b57522b2';

function syntheticRecord(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('riya-regression-synthetic-input-invalid');
  }
  return input as Readonly<Record<string, unknown>>;
}

function regressionPlannerInput(input: unknown): ClientNextBestActionInput {
  const synthetic = syntheticRecord(input);
  const incomplete = synthetic['requirementComplete'] === false;
  const explicitVendorCount =
    typeof synthetic['explicitVendorCount'] === 'number' ? synthetic['explicitVendorCount'] : 0;
  const vendorNoContact = synthetic['contacted'] === false;
  const contactedVendorCount =
    typeof synthetic['contactedVendorCount'] === 'number' ? synthetic['contactedVendorCount'] : 0;

  return Object.freeze({
    clientQuestionPending: false,
    humanHandoffRequested: synthetic['humanTakeover'] === true,
    unresolvedServiceIssue: synthetic['complaint'] === true,
    explicitReassignmentRequested: synthetic['replacementRequested'] === true,
    extraVendorReviewRequested: synthetic['extraVendorRequested'] === true,
    matchRequested: incomplete || explicitVendorCount > 0 || synthetic['coreTimeout'] === true,
    matchReady: explicitVendorCount > 0 && synthetic['coreTimeout'] !== true,
    missingMandatoryFieldRefs: incomplete ? Object.freeze(['location']) : Object.freeze([]),
    vendorsReleased: vendorNoContact ? 3 : contactedVendorCount,
    vendorNoContactCount: vendorNoContact ? 1 : 0,
    allReleasedVendorsContacted: contactedVendorCount > 0,
    satisfactionKnown: false,
    followUpDue: false,
    opportunities: Object.freeze([]),
  });
}

export function createRiyaClientIntelligenceRegressionCandidate(): DigitalTwinCandidate {
  return Object.freeze({
    run(input: unknown) {
      const decision = planClientNextBestAction(regressionPlannerInput(input));
      return Promise.resolve(
        Object.freeze({
          decision: decision.action,
          artifact: decision,
          effects: Object.freeze({
            providerCalls: 0,
            coreMutations: 0,
            channelSends: 0,
            workflowStarts: 0,
            databaseWrites: 0,
          }),
        }),
      );
    },
  });
}

export const RIYA_PHASE2_REGRESSION_SCENARIOS: readonly AgentFlowRegressionScenarioDefinition[] =
  Object.freeze([
    scenario(
      'riya.new-client',
      'New client',
      'IDENTITY',
      'ANSWER_CLIENT',
      { returning: false },
      COMMON,
    ),
    scenario(
      'riya.returning-client',
      'Returning after one year',
      'IDENTITY',
      'ANSWER_CLIENT',
      { returning: true, monthsSinceLastTurn: 12 },
      COMMON,
    ),
    scenario(
      'riya.known-property-new-service',
      'Known property, new service',
      'QUALIFICATION',
      'ANSWER_CLIENT',
      { knownProperty: true, newService: true },
      COMMON,
    ),
    scenario(
      'riya.incomplete-requirement',
      'Incomplete requirement',
      'QUALIFICATION',
      'ASK_MISSING_FIELD',
      { requirementComplete: false },
      COMMON,
    ),
    scenario(
      'riya.explicit-three-vendors',
      'Explicit three-vendor request',
      'MATCHING',
      'REQUEST_MATCH',
      { explicitVendorCount: 3 },
      COMMON,
    ),
    scenario(
      'riya.vendor-two-no-contact',
      'Vendor 2 did not contact',
      'VENDOR_JOURNEY',
      'CHECK_VENDOR_CONTACT',
      { vendorOrdinal: 2, contacted: false },
      COMMON,
    ),
    scenario(
      'riya.all-three-contacted',
      'All three contacted',
      'VENDOR_JOURNEY',
      'ASK_SATISFACTION',
      { contactedVendorCount: 3 },
      COMMON,
    ),
    scenario(
      'riya.extra-vendor-request',
      'Extra vendor request',
      'MATCHING',
      'REQUEST_EXTRA_VENDOR_REVIEW',
      { extraVendorRequested: true },
      COMMON,
    ),
    scenario(
      'riya.complaint',
      'Client complaint',
      'RECOVERY',
      'SERVICE_RECOVERY',
      { complaint: true },
      [...COMMON, 'human-escalation-available'],
    ),
    scenario(
      'riya.replacement',
      'Replacement request',
      'RECOVERY',
      'REQUEST_REASSIGNMENT',
      { replacementRequested: true },
      COMMON,
    ),
    scenario(
      'riya.multiple-categories',
      'Multiple categories',
      'QUALIFICATION',
      'ANSWER_CLIENT',
      { categoryCount: 2 },
      COMMON,
    ),
    scenario(
      'riya.corrected-area',
      'Corrected area',
      'CONTEXT_CORRECTION',
      'ANSWER_CLIENT',
      { areaCorrected: true },
      COMMON,
    ),
    scenario(
      'riya.corrected-budget',
      'Corrected budget',
      'CONTEXT_CORRECTION',
      'ANSWER_CLIENT',
      { budgetCorrected: true },
      COMMON,
    ),
    scenario(
      'riya.core-timeout',
      'Core timeout',
      'DEPENDENCY_FAILURE',
      'CHECK_CORE_ELIGIBILITY',
      { coreTimeout: true },
      [...COMMON, 'no-invented-core-result'],
    ),
    scenario(
      'riya.whatsapp-retry',
      'WhatsApp retry',
      'DEPENDENCY_FAILURE',
      'ANSWER_CLIENT',
      { channelRetry: true },
      [...COMMON, 'no-duplicate-send'],
    ),
    scenario(
      'riya.human-takeover',
      'Human takeover',
      'HUMAN_HANDOFF',
      'HUMAN_HANDOFF',
      { humanTakeover: true },
      [...COMMON, 'agent-stops-effectful-actions'],
    ),
  ]);

export async function runRiyaAgentFlowRegression(input: {
  readonly candidate: DigitalTwinCandidate;
  readonly candidateRef: string;
  readonly reportId: string;
}): Promise<AgentFlowRegressionSummary> {
  const scenarios: readonly DigitalTwinScenario[] = RIYA_PHASE2_REGRESSION_SCENARIOS.map(
    (definition) =>
      Object.freeze({
        scenarioId: definition.scenarioId,
        input: definition.syntheticInput,
        expectedDecision: definition.expectedDecision,
      }),
  );
  const result = await runDigitalTwinSuite({ scenarios, candidate: input.candidate });
  return Object.freeze({
    reportId: input.reportId,
    protocol: 'qfj.agent-flow-regression.v1',
    candidateRef: input.candidateRef,
    scenarioCount: result.scenarioCount,
    passed: result.passed,
    failed: result.failed,
    zeroEffectGuaranteed: result.results.every((item) => item.reason !== 'EFFECT_OCCURRED'),
    failedScenarioIds: Object.freeze(
      result.results.filter((item) => !item.pass).map((item) => item.scenarioId),
    ),
  });
}
