import { createAosOwnerAttentionObservation } from '@qf-jarvis/aos-intelligence';
import { describe, expect, it } from 'vitest';

import { controlPlane } from './index';
import { agentCockpit, agentOperationalMetrics } from './agent-live';
import { decisionLineage } from './decision-lineage';
import { proactiveNowBrief, runtimeCapabilities } from './proactive';
import { operationalAttention } from './operational-attention';
import { operatorBootstrap } from '../../server/operator/bootstrap';

describe('Jarvis OS intelligence surfaces', () => {
  it('keeps unavailable per-agent operational counts unknown instead of inventing zero', async () => {
    const plane = await controlPlane();
    const metrics = agentOperationalMetrics(plane, 'riya');
    const cockpit = agentCockpit(plane, 'riya');

    expect(metrics?.availability).toBe('NOT_CONNECTED');
    expect(metrics?.items).toStrictEqual([]);
    expect(cockpit.signals.map((signal) => signal.value)).toStrictEqual(['—', '—', '—', '—']);
  });

  it('marks shared dependencies as shared rather than attributing them to one agent', async () => {
    const cockpit = agentCockpit(await controlPlane(), 'anisha');
    const model = cockpit.dependencies.find((dependency) => dependency.id === 'anisha-model');
    const evaluation = cockpit.dependencies.find(
      (dependency) => dependency.id === 'anisha-evaluation',
    );

    expect(model?.scope).toBe('SHARED');
    expect(evaluation?.scope).toBe('SHARED');
    expect(model?.detail).toContain('shared infrastructure');
  });

  it('refuses to reconstruct a per-event decision trace when correlation is not exposed', async () => {
    const stages = decisionLineage(await controlPlane());
    expect(stages.map((stage) => stage.id)).toStrictEqual([
      'conversation',
      'recommendation',
      'authority',
      'execution',
      'delivery',
    ]);

    const recommendation = stages.find((stage) => stage.id === 'recommendation');
    expect(recommendation?.state).toBe('NOT_CONNECTED');
    expect(recommendation?.detail).toContain('No trace is inferred');

    const delivery = stages.find((stage) => stage.id === 'delivery');
    expect(delivery?.state).toBe('ROLLOUT_OFF');
  });

  it('builds a proactive brief from evidence and never grants execution authority', async () => {
    const brief = proactiveNowBrief(await controlPlane());
    expect(brief.executionAuthority).toBe('NONE');
    expect(brief.businessEffect).toBe(false);
    expect(
      brief.findings.some((finding) => finding.id === 'correlation-coverage-unavailable'),
    ).toBe(true);
  });

  it('resolves effective capability state from runtime/command evidence rather than stale declaration text', async () => {
    const plane = await controlPlane();
    const capabilities = runtimeCapabilities(plane, operatorBootstrap());
    const approvalWrite = capabilities.find((entry) => entry.id === 'approval.submit');
    const rollout = capabilities.find((entry) => entry.id === 'communication.live-send');

    expect(approvalWrite?.source).toBe('COMMAND_AUTHORITY');
    expect(['AVAILABLE', 'NOT_CONNECTED']).toContain(approvalWrite?.effective);
    expect(rollout).toMatchObject({
      declaration: 'ROLLOUT_OFF',
      effective: 'ROLLOUT_OFF',
      source: 'GOVERNED_DECLARATION',
    });
  });

  it('merges content-minimized AOS shadow findings into the shared owner attention center', async () => {
    const observation = createAosOwnerAttentionObservation({
      cycleId: 'aos.proactive.cycle.ui-test',
      emittedAt: '2026-10-01T10:00:00.000Z',
      items: [
        {
          caseId: 'case.aos.ui-test',
          priority: 'P1',
          lane: 'SOON',
          attentionScore: 62,
          reasonCodes: ['PRIORITY_P1', 'OWNER_REVIEW_REQUIRED'],
          requiresOwnerReview: true,
          recommendationAction: 'REQUEST_REPLACEMENT_BATCH',
          executionAuthority: 'NONE',
          businessEffect: false,
        },
      ],
    });
    const items = operationalAttention(await controlPlane(), observation);
    const aos = items.find((item) => item.id === 'aos:case.aos.ui-test');
    expect(aos).toMatchObject({
      kind: 'escalation',
      severity: 'warning',
      href: '/aos',
    });
    expect(aos?.context).toContain('QuickFurno Core remains business authority');
  });

  it('promotes proactive findings into the shared attention center', async () => {
    const items = operationalAttention(await controlPlane());
    expect(items.some((item) => item.id.startsWith('proactive:'))).toBe(true);
    expect(items.some((item) => item.id === 'proactive:correlation-coverage-unavailable')).toBe(
      true,
    );
    expect(items.every((item) => item.href === undefined || item.href.startsWith('/'))).toBe(true);
  });
});
