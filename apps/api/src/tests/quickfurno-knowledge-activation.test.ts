import { describe, expect, it } from 'vitest';

import {
  activateQuickFurnoKnowledgeRelease,
  type QuickFurnoKnowledgeReleaseActivator,
} from '../knowledge-production/activate-quickfurno-knowledge.js';

const APPROVAL = Object.freeze({
  approvedBy: 'quickfurno.owner',
  approvedAt: '2026-10-01T00:00:00Z',
  approvalRef: 'owner.approval.quickfurno.knowledge.v1',
});

describe('QuickFurno knowledge activation boundary', () => {
  it('activates and proves only the revision derived from the approved corpus', async () => {
    const calls: string[] = [];
    const activator: QuickFurnoKnowledgeReleaseActivator = {
      activate(revision) {
        calls.push('activate:' + revision);
        return Promise.resolve();
      },
      assertReady(revision, model) {
        calls.push('ready:' + revision + ':' + model);
        return Promise.resolve();
      },
    };

    const revision = await activateQuickFurnoKnowledgeRelease({
      approval: APPROVAL,
      embeddingModelRef: 'text-embedding-3-small',
      activator,
    });

    expect(revision).toMatch(/^qfkb\.sha256\.[0-9a-f]{64}$/u);
    expect(calls).toEqual([
      'activate:' + revision,
      'ready:' + revision + ':text-embedding-3-small',
    ]);
  });

  it('never accepts a caller-selected revision', async () => {
    const activator: QuickFurnoKnowledgeReleaseActivator = {
      activate: () => Promise.resolve(),
      assertReady: () => Promise.resolve(),
    };
    const first = await activateQuickFurnoKnowledgeRelease({
      approval: APPROVAL,
      embeddingModelRef: 'text-embedding-3-small',
      activator,
    });
    const second = await activateQuickFurnoKnowledgeRelease({
      approval: { ...APPROVAL, approvalRef: 'owner.approval.quickfurno.knowledge.v1b' },
      embeddingModelRef: 'text-embedding-3-small',
      activator,
    });
    expect(second).not.toBe(first);
  });
});
