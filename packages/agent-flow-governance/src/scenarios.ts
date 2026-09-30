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

const COMMON = Object.freeze(['zero-effects', 'core-authority-preserved', 'no-direct-provider-send']);

export const RIYA_PHASE2_REGRESSION_SCENARIOS: readonly AgentFlowRegressionScenarioDefinition[] =
  Object.freeze([
    scenario('riya.new-client', 'New client', 'IDENTITY', 'QUALIFY_CLIENT', { returning: false }, COMMON),
    scenario(
      'riya.returning-client',
      'Returning after one year',
      'IDENTITY',
      'LOAD_LIFETIME_CONTEXT',
      { returning: true, monthsSinceLastTurn: 12 },
      COMMON,
    ),
    scenario(
      'riya.known-property-new-service',
      'Known property, new service',
      'QUALIFICATION',
      'QUALIFY_NEW_REQUIREMENT',
      { knownProperty: true, newService: true },
      COMMON,
    ),
    scenario(
      'riya.incomplete-requirement',
      'Incomplete requirement',
      'QUALIFICATION',
      'ASK_MISSING_INFO',
      { requirementComplete: false },
      COMMON,
    ),
    scenario(
      'riya.explicit-three-vendors',
      'Explicit three-vendor request',
      'MATCHING',
      'REQUEST_CORE_MATCH',
      { explicitVendorCount: 3 },
      COMMON,
    ),
    scenario(
      'riya.vendor-two-no-contact',
      'Vendor 2 did not contact',
      'VENDOR_JOURNEY',
      'RECORD_VENDOR_FEEDBACK',
      { vendorOrdinal: 2, contacted: false },
      COMMON,
    ),
    scenario(
      'riya.all-three-contacted',
      'All three contacted',
      'VENDOR_JOURNEY',
      'CONTINUE_CLIENT_EVALUATION',
      { contactedVendorCount: 3 },
      COMMON,
    ),
    scenario(
      'riya.extra-vendor-request',
      'Extra vendor request',
      'MATCHING',
      'REQUEST_CORE_REVIEW',
      { extraVendorRequested: true },
      COMMON,
    ),
    scenario(
      'riya.complaint',
      'Client complaint',
      'RECOVERY',
      'START_RECOVERY_REVIEW',
      { complaint: true },
      [...COMMON, 'human-escalation-available'],
    ),
    scenario(
      'riya.replacement',
      'Replacement request',
      'RECOVERY',
      'REQUEST_REPLACEMENT_REVIEW',
      { replacementRequested: true },
      COMMON,
    ),
    scenario(
      'riya.multiple-categories',
      'Multiple categories',
      'QUALIFICATION',
      'QUALIFY_MULTIPLE_REQUIREMENTS',
      { categoryCount: 2 },
      COMMON,
    ),
    scenario(
      'riya.corrected-area',
      'Corrected area',
      'CONTEXT_CORRECTION',
      'REFRESH_REQUIREMENT_CONTEXT',
      { areaCorrected: true },
      COMMON,
    ),
    scenario(
      'riya.corrected-budget',
      'Corrected budget',
      'CONTEXT_CORRECTION',
      'REFRESH_REQUIREMENT_CONTEXT',
      { budgetCorrected: true },
      COMMON,
    ),
    scenario(
      'riya.core-timeout',
      'Core timeout',
      'DEPENDENCY_FAILURE',
      'FAIL_CLOSED_OR_RETRY_SAFE',
      { coreTimeout: true },
      [...COMMON, 'no-invented-core-result'],
    ),
    scenario(
      'riya.whatsapp-retry',
      'WhatsApp retry',
      'DEPENDENCY_FAILURE',
      'RETRY_CHANNEL_SAFELY',
      { channelRetry: true },
      [...COMMON, 'no-duplicate-send'],
    ),
    scenario(
      'riya.human-takeover',
      'Human takeover',
      'HUMAN_HANDOFF',
      'HANDOFF_TO_HUMAN',
      { humanTakeover: true },
      [...COMMON, 'agent-stops-effectful-actions'],
    ),
  ]);

export async function runRiyaAgentFlowRegression(input: {
  readonly candidate: DigitalTwinCandidate;
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
    scenarioCount: result.scenarioCount,
    passed: result.passed,
    failed: result.failed,
    zeroEffectGuaranteed: result.results.every((item) => item.reason !== 'EFFECT_OCCURRED'),
    failedScenarioIds: Object.freeze(
      result.results.filter((item) => !item.pass).map((item) => item.scenarioId),
    ),
  });
}
