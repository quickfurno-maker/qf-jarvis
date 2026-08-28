/**
 * The demo control-plane provider (JOS-01A; contained in JOS-01B).
 *
 * A READ-ONLY adapter over a local fixture. It implements `ControlPlaneReadModel` and nothing
 * else — there is no writer, no fetch, no cache, no clock and no mutation path.
 *
 * ### It is no longer the default, and that is the point of JOS-01B
 *
 * In JOS-01A this was what every operator screen rendered. It was clearly labelled, and it was
 * still wrong: a control plane showing plausible conversation counts and a queue of waiting
 * approvals teaches an operator to believe numbers that describe nothing. The default is now the
 * repository baseline, and this fixture is reachable only from tests and visual fixtures.
 *
 * Its provenance says `DEMO_FIXTURE` with `liveOperationalData: false`, so any screenshot taken
 * from it carries that on its face and cannot be mistaken for the real surface.
 */
import {
  ACTIVITY_LOG,
  ACTIVITY_SERIES,
  AGENTS,
  AGENT_WORKLOAD,
  APPROVAL_BREAKDOWN,
  APPROVAL_QUEUE,
  ATTENTION,
  CONVERSATION_CONTROL,
  EVALUATIONS,
  HEADLINE_METRICS,
  KNOWLEDGE,
  LATENCY_SERIES,
  MODELS,
  OWNERSHIP,
  ROADMAP,
  SYSTEM_HEALTH,
  AAROHI_READINESS,
  VENDOR_GROWTH_FUNNEL,
  WORKERS,
} from '../demo-data/snapshot';
import type { AgentId, ControlPlaneReadModel, NamedSeries, Section, SeriesSection } from './types';

const FIXTURE_REASON = 'Synthetic fixture. Not operational data.';
const FIXTURE_SOURCE = 'A local demo fixture, used for tests and visual fixtures only.';

/** Wrap a fixture array as an AVAILABLE section, so the demo exercises the same code path. */
function fixtureSection<T>(items: readonly T[]): Section<T> {
  return Object.freeze({
    availability: 'AVAILABLE' as const,
    reason: FIXTURE_REASON,
    expectedSource: FIXTURE_SOURCE,
    items,
  });
}

function fixtureSeries(series: NamedSeries): SeriesSection {
  return Object.freeze({
    ...series,
    availability: 'AVAILABLE' as const,
    reason: FIXTURE_REASON,
    expectedSource: FIXTURE_SOURCE,
  });
}

/** Build the demo read model. Frozen, so a caller cannot substitute a method for a writer. */
export function createDemoControlPlane(): ControlPlaneReadModel {
  return Object.freeze({
    kind: 'demo' as const,
    provenance: () =>
      Object.freeze({
        kind: 'DEMO_FIXTURE' as const,
        // A fixture observes nothing, so its facts are as old as the file: BUILD_DECLARATION.
        // There is no NOT_CONNECTED freshness -- connectivity is a per-section fact.
        freshness: 'BUILD_DECLARATION' as const,
        liveOperationalData: false,
        // A fixed instant: a fixture that moved with the clock would make every snapshot test
        // non-deterministic for no benefit.
        generatedAt: '2026-01-01T00:00:00.000Z',
      }),
    systemHealth: () => SYSTEM_HEALTH,
    headlineMetrics: () => fixtureSection(HEADLINE_METRICS),
    activitySeries: () => fixtureSeries(ACTIVITY_SERIES),
    latencySeries: () => fixtureSeries(LATENCY_SERIES),
    agentWorkload: () => fixtureSection(AGENT_WORKLOAD),
    approvalBreakdown: () => fixtureSection(APPROVAL_BREAKDOWN),
    businessAnalytics: () => fixtureSection(AGENT_WORKLOAD),
    n8nExecution: () => fixtureSection(APPROVAL_BREAKDOWN),
    vendorGrowthFunnel: () => fixtureSection(VENDOR_GROWTH_FUNNEL),
    aarohiReadiness: () => fixtureSection(AAROHI_READINESS),
    attention: () => fixtureSection(ATTENTION),
    activity: () => fixtureSection(ACTIVITY_LOG),
    agents: () => AGENTS,
    agent: (id: AgentId) => AGENTS.find((entry) => entry.id === id),
    approvalQueue: () => fixtureSection(APPROVAL_QUEUE),
    conversationControl: () => fixtureSection(CONVERSATION_CONTROL),
    workers: () => fixtureSection(WORKERS),
    models: () => fixtureSection(MODELS),
    knowledge: () => fixtureSection(KNOWLEDGE),
    evaluations: () => fixtureSection(EVALUATIONS),
    ownership: () => fixtureSection(OWNERSHIP),
    roadmap: () => ROADMAP,
  });
}
