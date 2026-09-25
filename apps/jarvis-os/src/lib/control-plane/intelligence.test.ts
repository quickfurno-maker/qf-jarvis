import { describe, expect, it } from 'vitest';

import { controlPlane } from './index';
import { agentCockpit, agentOperationalMetrics } from './agent-live';
import { decisionLineage } from './decision-lineage';

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
});
