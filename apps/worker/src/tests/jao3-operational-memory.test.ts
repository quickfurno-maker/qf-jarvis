/**
 * JAO-3 operational memory, asserted as an AUTHORITY-CONTAINMENT proof (ADR-0117).
 *
 * Durability is proved against a real PostgreSQL in the integration suite; it cannot be proved
 * here, and this file does not pretend to. What it proves is the half that does not need a
 * database and must never be allowed to drift: that operational memory cannot express permission,
 * cannot hold a transcript, cannot widen its own budget, and cannot resume what has ended.
 *
 * The guards exercised below are the REAL production guards -- `policy.ts` is what the adapter
 * calls inside its transaction -- so these are not assertions about a re-implementation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DatabasePool } from '@qf-jarvis/event-backbone';
import { describe, expect, it } from 'vitest';

import * as jao3 from '../jao/operational-memory/index.js';
import {
  JAO3_BUDGET_LIMITS,
  JAO3_DEFAULT_BUDGET,
  JAO3_ERROR_CODES,
  JAO3_EVIDENCE_SOURCE_CLASSES,
  JAO3_INVESTIGATION_STATUSES,
  JAO3_MEMORY_BOUNDS,
  JAO3_STATUS_ACCEPTS_WRITES,
  JAO3_WORKFLOW_STATES,
  assertJao3CheckpointBudget,
  assertJao3CorrectionBudget,
  assertJao3EvidenceAndHypothesisBudget,
  assertJao3ExpectedRevision,
  assertJao3IdentityBinding,
  assertJao3ResumeBudget,
  assertJao3RootRunUnchanged,
  assertJao3SupersessionTarget,
  assertJao3Writable,
  jao3AppendCheckpointInputSchema,
  jao3AppendOwnerCorrectionInputSchema,
  jao3BudgetSchema,
  jao3CheckpointSchema,
  jao3CreateInvestigationInputSchema,
  jao3EvidenceRefSchema,
  jao3HasExpired,
  jao3HypothesisSchema,
  jao3InstantSchema,
  jao3InvestigationSchema,
  jao3OwnerCorrectionSchema,
  jao3SemanticDigest,
  jao3TelemetryEventSchema,
  createJao3PostgresStore,
  parseJao3InvestigationId,
  type Jao3Investigation,
  type Jao3InvestigationStatus,
} from '../jao/operational-memory/index.js';

const T0 = Date.parse('2026-08-25T09:00:00.000Z');

/**
 * A pool that refuses to be used, and counts the attempts.
 *
 * The single assertion is the point: `DatabasePool` is `pg.Pool`, a class with a large surface,
 * and constructing a real one would open sockets. What is under test is whether the adapter
 * borrows a connection at all, and `connect` is the only method it can borrow through.
 */
function explodingPool(): { readonly pool: DatabasePool; connects: () => number } {
  let connects = 0;
  const pool = {
    connect(): Promise<never> {
      connects += 1;
      return Promise.reject(new Error('SPY-POOL-MUST-NOT-BE-REACHED'));
    },
  };
  return { pool: pool as unknown as DatabasePool, connects: () => connects };
}

const exploding = explodingPool();

/**
 * Source with comments stripped.
 *
 * JAO-3 documents at length the paths it refuses to reach -- approval runtimes, execution
 * dispatch, chain-of-thought. Scanning raw text would report every one of those prohibitions as a
 * violation of itself, so the containment specs read CODE and the prose is left to be prose.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|--)/u.test(line))
    .join('\n');
}

function jao3Dir(): string {
  return path.resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '..',
    'jao',
    'operational-memory',
  );
}

function jao3Sources(): { readonly name: string; readonly code: string }[] {
  const root = jao3Dir();
  return fs
    .readdirSync(root)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => ({
      name: entry,
      code: codeOnly(fs.readFileSync(path.join(root, entry), 'utf8')),
    }));
}

/** A valid persisted investigation, so the guards are exercised on a real record. */
function investigation(over: Partial<Jao3Investigation> = {}): Jao3Investigation {
  return jao3InvestigationSchema.parse({
    investigationId: 'jao3.investigation.000001',
    rootRunId: 'jao3.run.root',
    currentRunId: 'jao3.run.root',
    revision: 3,
    status: 'OPEN',
    objective: 'Explain the projection lag.',
    workflowState: 'ANALYSIS',
    createdAt: '2026-08-25T09:00:00.000Z',
    updatedAt: '2026-08-25T09:10:00.000Z',
    expiresAt: '2026-08-25T15:00:00.000Z',
    supersededByInvestigationId: null,
    latestCheckpointId: 'jao3.checkpoint.1',
    checkpointCount: 1,
    ownerCorrectionCount: 0,
    resumeCount: 0,
    budget: { ...JAO3_DEFAULT_BUDGET },
    memoryClass: 'OPERATIONAL_NON_AUTHORITATIVE',
    ...over,
  });
}

const EVIDENCE = {
  evidenceRef: 'control-plane.snapshot.2026-08-25T09',
  kind: 'projection-health',
  sourceClass: 'CONTROL_PLANE_SNAPSHOT',
  observedAt: '2026-08-25T09:05:00.000Z',
};

const HYPOTHESIS = {
  hypothesisId: 'jao3.hypothesis.1',
  statement: 'The lag is confined to one partition.',
  epistemicStatus: 'HYPOTHESIS',
  authority: 'NONE',
};

function checkpointInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    investigationId: 'jao3.investigation.000001',
    runId: 'jao3.run.root',
    expectedRevision: 3,
    operationId: 'jao3.op.1',
    checkpointId: 'jao3.checkpoint.2',
    workflowState: 'ANALYSIS',
    summary: 'One partition is behind; nothing was acted on.',
    evidenceRefs: [EVIDENCE],
    hypotheses: [HYPOTHESIS],
    nextObjective: null,
    ...over,
  };
}

function correctionInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    investigationId: 'jao3.investigation.000001',
    runId: 'jao3.run.root',
    expectedRevision: 3,
    operationId: 'jao3.op.correction.1',
    correctionId: 'jao3.correction.1',
    targetType: 'INVESTIGATION',
    targetId: 'jao3.investigation.000001',
    correctionStatement: 'Re-scope: the lag predates the deploy.',
    actor: 'FOUNDER',
    ...over,
  };
}

/**
 * Names that would turn remembered facts into current permission.
 *
 * The list the control-plane read contract already refuses (ADR-0086), because JAO-3 has exactly
 * the same problem: a surface an operator or a later agent reads must not carry a field that looks
 * like an answer to "may I".
 */
const AUTHORITY_FIELDS = [
  'isAuthorized',
  'canExecute',
  'canSend',
  'approvalGranted',
  'authorizationValid',
  'authorizedAction',
  'executionAllowed',
  'consentValid',
  'dispatchAllowed',
  'businessEffect',
  'approved',
];

/** Names that would turn bounded memory into a transcript store. */
const TRANSCRIPT_FIELDS = [
  'chainOfThought',
  'reasoning',
  'scratchpad',
  'transcript',
  'messages',
  'promptText',
  'completion',
  'rawResponse',
  'responseBody',
  'requestBody',
  'payload',
  'apiKey',
  'credential',
  'authorization',
];

describe('JAO-3 operational memory', () => {
  it('states its own class: operational, non-authoritative, and durable in PostgreSQL', () => {
    expect(JAO3_MEMORY_BOUNDS.memoryClass).toBe('OPERATIONAL_NON_AUTHORITATIVE');
    expect(JAO3_MEMORY_BOUNDS.durableStore).toBe('POSTGRES');
    expect(JAO3_MEMORY_BOUNDS.rememberedAuthorizationIsPermission).toBe(false);
    expect(JAO3_MEMORY_BOUNDS.modelCalls).toBe(0);
    expect(JAO3_MEMORY_BOUNDS.specialistCalls).toBe(0);
    expect(JAO3_MEMORY_BOUNDS.proposalsCreated).toBe(0);
    expect(JAO3_MEMORY_BOUNDS.approvalRequestsCreated).toBe(0);
    expect(JAO3_MEMORY_BOUNDS.executionIntentsCreated).toBe(0);
    expect(JAO3_MEMORY_BOUNDS.businessEffect).toBe(false);
    expect(JAO3_MEMORY_BOUNDS.backgroundResume).toBe(false);
    expect(JAO3_MEMORY_BOUNDS.scheduler).toBe(false);
    expect(JAO3_MEMORY_BOUNDS.mastraMemoryOrStorage).toBe(false);
    expect(JAO3_MEMORY_BOUNDS.managedMigrationAdopted).toBe(false);
    expect(JAO3_MEMORY_BOUNDS.chainOfThoughtStored).toBe(false);
    expect(JAO3_MEMORY_BOUNDS.evidencePayloadsStored).toBe(false);
  });

  it('enforces a strict creation contract and refuses anything unsupported', () => {
    const valid = {
      investigationId: 'jao3.investigation.000001',
      rootRunId: 'jao3.run.root',
      objective: 'Explain the projection lag.',
      workflowState: 'DISCOVERY',
      lifetimeMs: 3_600_000,
    };
    expect(jao3CreateInvestigationInputSchema.safeParse(valid).success).toBe(true);

    for (const bad of [
      {},
      { ...valid, investigationId: 'has space' },
      { ...valid, investigationId: '' },
      { ...valid, objective: '' },
      { ...valid, objective: 'x'.repeat(241) },
      { ...valid, workflowState: 'RUNNING' },
      { ...valid, lifetimeMs: 999 },
      // Beyond the lifetime ceiling: seven days plus one millisecond.
      { ...valid, lifetimeMs: JAO3_BUDGET_LIMITS.maxLifetimeMs + 1 },
      { ...valid, extra: true },
      { ...valid, status: 'OPEN' },
      { ...valid, revision: 5 },
    ]) {
      expect(jao3CreateInvestigationInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it('refuses every field that would make memory look like permission', () => {
    // The central JAO-3 rule, enforced by parsing rather than by review. Each of these is a field
    // a later caller might reasonably try to add, and every one of them is refused.
    for (const field of AUTHORITY_FIELDS) {
      expect(
        jao3CreateInvestigationInputSchema.safeParse({
          investigationId: 'jao3.investigation.000001',
          rootRunId: 'jao3.run.root',
          objective: 'Objective.',
          workflowState: 'DISCOVERY',
          lifetimeMs: 3_600_000,
          [field]: true,
        }).success,
        field,
      ).toBe(false);

      expect(
        jao3AppendCheckpointInputSchema.safeParse(checkpointInput({ [field]: true })).success,
        field,
      ).toBe(false);

      expect(
        jao3AppendOwnerCorrectionInputSchema.safeParse(correctionInput({ [field]: true })).success,
        field,
      ).toBe(false);
    }

    // And -- the half a mutation proof caught missing -- the PERSISTED record schemas refuse them
    // too. Checking only the input schemas left the contract itself free to grow an
    // `isAuthorized` field that nothing would have objected to, because a fixture that never sets
    // an optional field also never reveals that it exists.
    const record = investigation();
    const checkpoint = {
      checkpointId: 'jao3.checkpoint.1',
      investigationId: record.investigationId,
      revision: 2,
      runId: 'jao3.run.root',
      workflowState: 'ANALYSIS',
      summary: 'A finding.',
      evidenceRefs: [EVIDENCE],
      hypotheses: [HYPOTHESIS],
      nextObjective: null,
      createdAt: '2026-08-25T09:05:00.000Z',
    };
    const correction = {
      correctionId: 'jao3.correction.1',
      investigationId: record.investigationId,
      revision: 2,
      targetType: 'INVESTIGATION',
      targetId: record.investigationId,
      correctionStatement: 'Re-scope.',
      actor: 'FOUNDER',
      supersedesTarget: true,
      createdAt: '2026-08-25T09:05:00.000Z',
    };

    expect(jao3CheckpointSchema.safeParse(checkpoint).success).toBe(true);
    expect(jao3OwnerCorrectionSchema.safeParse(correction).success).toBe(true);

    for (const field of AUTHORITY_FIELDS) {
      expect(
        jao3InvestigationSchema.safeParse({ ...record, [field]: true }).success,
        `investigation.${field}`,
      ).toBe(false);
      expect(
        jao3CheckpointSchema.safeParse({ ...checkpoint, [field]: true }).success,
        `checkpoint.${field}`,
      ).toBe(false);
      expect(
        jao3OwnerCorrectionSchema.safeParse({ ...correction, [field]: true }).success,
        `correction.${field}`,
      ).toBe(false);
      expect(
        jao3EvidenceRefSchema.safeParse({ ...EVIDENCE, [field]: true }).success,
        `evidence.${field}`,
      ).toBe(false);
      expect(
        jao3HypothesisSchema.safeParse({ ...HYPOTHESIS, [field]: true }).success,
        `hypothesis.${field}`,
      ).toBe(false);
    }

    // Nor is any such key declared on the schemas at all -- an OPTIONAL authority field would be
    // absent from a fixture while being perfectly writable by a caller.
    for (const [label, keys] of [
      ['investigation', Object.keys(jao3InvestigationSchema.shape)],
      ['checkpoint', Object.keys(jao3CheckpointSchema.shape)],
      ['correction', Object.keys(jao3OwnerCorrectionSchema.shape)],
      ['evidence', Object.keys(jao3EvidenceRefSchema.shape)],
      ['hypothesis', Object.keys(jao3HypothesisSchema.shape)],
    ] as const) {
      for (const field of AUTHORITY_FIELDS) {
        expect(keys, `${label}.${field}`).not.toContain(field);
      }
    }
  });

  it('refuses every field that would turn bounded memory into a transcript store', () => {
    for (const field of TRANSCRIPT_FIELDS) {
      expect(
        jao3AppendCheckpointInputSchema.safeParse(checkpointInput({ [field]: 'anything' })).success,
        field,
      ).toBe(false);
      expect(
        jao3AppendOwnerCorrectionInputSchema.safeParse(correctionInput({ [field]: 'anything' }))
          .success,
        field,
      ).toBe(false);
      expect(
        jao3TelemetryEventSchema.safeParse({
          investigationId: 'jao3.investigation.000001',
          runId: 'jao3.run.root',
          operation: 'READ',
          revision: 1,
          status: 'OPEN',
          checkpointCount: 0,
          ownerCorrectionCount: 0,
          resumeCount: 0,
          durationMs: 1,
          outcome: 'COMPLETED',
          errorCode: null,
          memoryClass: 'OPERATIONAL_NON_AUTHORITATIVE',
          modelCalls: 0,
          specialistCalls: 0,
          businessEffect: false,
          [field]: 'anything',
        }).success,
        field,
      ).toBe(false);
    }
  });

  it('keeps evidence a REFERENCE, refusing anything that carries a payload', () => {
    expect(jao3EvidenceRefSchema.safeParse(EVIDENCE).success).toBe(true);

    for (const bad of [
      { ...EVIDENCE, body: 'the whole snapshot' },
      { ...EVIDENCE, content: '...' },
      { ...EVIDENCE, payload: {} },
      { ...EVIDENCE, raw: '...' },
      { ...EVIDENCE, responseBody: '...' },
      // An authority-bearing source class is not in the vocabulary and cannot be introduced.
      { ...EVIDENCE, sourceClass: 'APPROVAL_GRANT' },
      { ...EVIDENCE, sourceClass: 'AUTHORIZATION' },
      { ...EVIDENCE, evidenceRef: 'x'.repeat(129) },
      { ...EVIDENCE, evidenceRef: 'has space' },
      { ...EVIDENCE, observedAt: '2026-08-25T09:05:00Z' },
      { ...EVIDENCE, observedAt: '2026-02-31T09:05:00.000Z' },
    ]) {
      expect(jao3EvidenceRefSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }

    expect([...JAO3_EVIDENCE_SOURCE_CLASSES]).toStrictEqual([
      'CONTROL_PLANE_SNAPSHOT',
      'SPECIALIST_ADVISORY',
      'REPOSITORY_PROOF',
      'OPERATOR_NOTE',
      'TEST_FIXTURE',
    ]);
  });

  it('bounds a hypothesis and pins its authority to NONE', () => {
    expect(jao3HypothesisSchema.safeParse(HYPOTHESIS).success).toBe(true);

    for (const bad of [
      { ...HYPOTHESIS, authority: 'SOME' },
      { ...HYPOTHESIS, authority: 'BUSINESS_TRUTH' },
      { ...HYPOTHESIS, epistemicStatus: 'CONFIRMED_BUSINESS_TRUTH' },
      { ...HYPOTHESIS, epistemicStatus: 'AUTHORIZED' },
      { ...HYPOTHESIS, epistemicStatus: 'APPROVED_TO_EXECUTE' },
      { ...HYPOTHESIS, statement: '' },
      { ...HYPOTHESIS, statement: 'x'.repeat(241) },
      {
        hypothesisId: HYPOTHESIS.hypothesisId,
        statement: 'No authority field at all.',
        epistemicStatus: 'HYPOTHESIS',
      },
      // Unaddressable: a hypothesis a correction could not name, and therefore one whose owning
      // investigation could never be proved.
      { statement: 'No id at all.', epistemicStatus: 'HYPOTHESIS', authority: 'NONE' },
      { ...HYPOTHESIS, hypothesisId: 'has space' },
      { ...HYPOTHESIS, hypothesisId: '' },
    ]) {
      expect(jao3HypothesisSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('bounds a checkpoint, its arrays and its instants', () => {
    expect(jao3AppendCheckpointInputSchema.safeParse(checkpointInput()).success).toBe(true);

    for (const bad of [
      { summary: '' },
      { summary: 'x'.repeat(481) },
      { nextObjective: 'x'.repeat(241) },
      { workflowState: 'RUNNING' },
      { expectedRevision: 0 },
      { operationId: '' },
      { checkpointId: 'has space' },
      {
        evidenceRefs: Array.from(
          { length: JAO3_BUDGET_LIMITS.maxEvidenceRefsPerCheckpoint + 1 },
          () => EVIDENCE,
        ),
      },
      {
        hypotheses: Array.from(
          { length: JAO3_BUDGET_LIMITS.maxHypothesesPerCheckpoint + 1 },
          () => HYPOTHESIS,
        ),
      },
    ]) {
      expect(
        jao3AppendCheckpointInputSchema.safeParse(checkpointInput(bad)).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it('bounds an owner correction, and a correction can grant nothing', () => {
    expect(jao3AppendOwnerCorrectionInputSchema.safeParse(correctionInput()).success).toBe(true);

    for (const bad of [
      { actor: 'JARVIS' },
      { actor: 'SYSTEM' },
      { targetType: 'APPROVAL' },
      { targetType: 'EXECUTION' },
      { correctionStatement: '' },
      { correctionStatement: 'x'.repeat(241) },
      { grantsAuthority: true },
      { supersedesTarget: false },
      { authorizes: 'send' },
    ]) {
      expect(
        jao3AppendOwnerCorrectionInputSchema.safeParse(correctionInput(bad)).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it('caps every persisted budget at the ceiling, so a stored row cannot widen it', () => {
    expect(jao3BudgetSchema.safeParse({ ...JAO3_DEFAULT_BUDGET }).success).toBe(true);
    expect(JAO3_DEFAULT_BUDGET).toStrictEqual({ ...JAO3_BUDGET_LIMITS });

    for (const [field, ceiling] of Object.entries(JAO3_BUDGET_LIMITS)) {
      expect(
        jao3BudgetSchema.safeParse({ ...JAO3_DEFAULT_BUDGET, [field]: ceiling + 1 }).success,
        field,
      ).toBe(false);
    }

    // A persisted investigation carrying a widened budget is refused as corrupt rather than
    // honoured -- the restart reset these budgets exist to prevent.
    expect(
      jao3InvestigationSchema.safeParse({
        ...investigation(),
        budget: { ...JAO3_DEFAULT_BUDGET, maxCheckpoints: 9_999 },
      }).success,
    ).toBe(false);

    // Nor can a counter exceed what the budget allows.
    expect(
      jao3InvestigationSchema.safeParse({
        ...investigation(),
        checkpointCount: JAO3_BUDGET_LIMITS.maxCheckpoints + 1,
      }).success,
    ).toBe(false);
  });

  it('refuses a write once a persisted budget is reached', () => {
    expect(() => {
      assertJao3CheckpointBudget(investigation({ checkpointCount: 1 }));
    }).not.toThrow();

    for (const [guard, over] of [
      [assertJao3CheckpointBudget, { checkpointCount: JAO3_DEFAULT_BUDGET.maxCheckpoints }],
      [
        assertJao3CorrectionBudget,
        { ownerCorrectionCount: JAO3_DEFAULT_BUDGET.maxOwnerCorrections },
      ],
      [assertJao3ResumeBudget, { resumeCount: JAO3_DEFAULT_BUDGET.maxResumeCount }],
    ] as const) {
      expect(() => {
        guard(investigation(over));
      }).toThrow(expect.objectContaining({ code: 'BUDGET_EXHAUSTED' }));
    }

    expect(() => {
      assertJao3EvidenceAndHypothesisBudget(investigation(), {
        evidenceRefs: JAO3_DEFAULT_BUDGET.maxEvidenceRefsPerCheckpoint + 1,
        hypotheses: 0,
      });
    }).toThrow(expect.objectContaining({ code: 'BUDGET_EXHAUSTED' }));
    expect(() => {
      assertJao3EvidenceAndHypothesisBudget(investigation(), {
        evidenceRefs: 0,
        hypotheses: JAO3_DEFAULT_BUDGET.maxHypothesesPerCheckpoint + 1,
      });
    }).toThrow(expect.objectContaining({ code: 'BUDGET_EXHAUSTED' }));
  });

  it('decides which statuses accept work as a TOTAL map, with no RUNNING state', () => {
    expect(Object.keys(JAO3_STATUS_ACCEPTS_WRITES).sort()).toStrictEqual(
      [...JAO3_INVESTIGATION_STATUSES].sort(),
    );
    expect(JAO3_INVESTIGATION_STATUSES).not.toContain('RUNNING');
    expect(JAO3_WORKFLOW_STATES).not.toContain('RUNNING');

    const accepted: Jao3InvestigationStatus[] = [];
    for (const status of JAO3_INVESTIGATION_STATUSES) {
      if (JAO3_STATUS_ACCEPTS_WRITES[status]) {
        accepted.push(status);
      }
    }
    expect(accepted).toStrictEqual(['OPEN', 'PAUSED']);
  });

  it('refuses work on a COMPLETED, SUPERSEDED or EXPIRED investigation', () => {
    expect(() => {
      assertJao3Writable(investigation({ status: 'OPEN' }), T0);
    }).not.toThrow();
    expect(() => {
      assertJao3Writable(investigation({ status: 'PAUSED' }), T0);
    }).not.toThrow();

    expect(() => {
      assertJao3Writable(investigation({ status: 'COMPLETED' }), T0);
    }).toThrow(expect.objectContaining({ code: 'STATUS_NOT_RESUMABLE' }));

    expect(() => {
      assertJao3Writable(
        investigation({
          status: 'SUPERSEDED',
          supersededByInvestigationId: 'jao3.investigation.000002',
        }),
        T0,
      );
    }).toThrow(expect.objectContaining({ code: 'INVESTIGATION_SUPERSEDED' }));

    expect(() => {
      assertJao3Writable(investigation({ status: 'EXPIRED' }), T0);
    }).toThrow(expect.objectContaining({ code: 'INVESTIGATION_EXPIRED' }));
  });

  it('treats expiry as a fact about the clock, with the boundary closed', () => {
    const record = investigation({ expiresAt: '2026-08-25T15:00:00.000Z' });
    const expiresAtMs = Date.parse('2026-08-25T15:00:00.000Z');

    expect(jao3HasExpired(record, expiresAtMs - 1)).toBe(false);
    // At the instant of expiry, it is expired. An off-by-one here is a rule that does not hold at
    // the only moment anyone would test it.
    expect(jao3HasExpired(record, expiresAtMs)).toBe(true);
    expect(jao3HasExpired(record, expiresAtMs + 1)).toBe(true);

    // The status still says OPEN, and it is still refused: no sweeper rewrote the row, and none
    // needs to.
    expect(record.status).toBe('OPEN');
    expect(() => {
      assertJao3Writable(record, expiresAtMs);
    }).toThrow(expect.objectContaining({ code: 'INVESTIGATION_EXPIRED' }));
  });

  it('refuses a stale expectedRevision', () => {
    const record = investigation({ revision: 4 });
    expect(() => {
      assertJao3ExpectedRevision(record, 4);
    }).not.toThrow();
    for (const stale of [1, 3, 5, 0]) {
      expect(() => {
        assertJao3ExpectedRevision(record, stale);
      }, String(stale)).toThrow(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    }
  });

  it('binds identity: the loaded row, the current run, and a rootRunId that cannot drift', () => {
    const record = investigation({ currentRunId: 'jao3.run.second' });

    expect(() => {
      assertJao3IdentityBinding(record, {
        investigationId: record.investigationId,
        runId: 'jao3.run.second',
      });
    }).not.toThrow();

    // A run that was superseded by an explicit resume cannot keep appending.
    expect(() => {
      assertJao3IdentityBinding(record, {
        investigationId: record.investigationId,
        runId: 'jao3.run.root',
      });
    }).toThrow(expect.objectContaining({ code: 'RUN_ID_MISMATCH' }));

    // A row that is not the investigation that was asked for is corrupt, not a mismatch.
    expect(() => {
      assertJao3IdentityBinding(record, {
        investigationId: 'jao3.investigation.999999',
        runId: 'jao3.run.second',
      });
    }).toThrow(expect.objectContaining({ code: 'PERSISTED_STATE_INVALID' }));

    // The run that opened an investigation is a fact about it.
    expect(() => {
      assertJao3RootRunUnchanged(record, 'jao3.run.root');
    }).not.toThrow();
    expect(() => {
      assertJao3RootRunUnchanged(record, 'jao3.run.second');
    }).toThrow(expect.objectContaining({ code: 'RUN_ID_MISMATCH' }));
  });

  it('refuses a supersession that points at itself', () => {
    const record = investigation();
    expect(() => {
      assertJao3SupersessionTarget(record, 'jao3.investigation.000002');
    }).not.toThrow();
    expect(() => {
      assertJao3SupersessionTarget(record, record.investigationId);
    }).toThrow(expect.objectContaining({ code: 'SUPERSESSION_INVALID' }));
  });

  it('accepts only canonical UTC instants', () => {
    expect(jao3InstantSchema.safeParse('2026-08-25T09:00:00.000Z').success).toBe(true);
    for (const bad of [
      '2026-08-25T09:00:00Z',
      '2026-08-25T09:00:00.000+05:30',
      '2026-08-25 09:00:00.000Z',
      // JavaScript normalises impossible dates; the round-trip refuses what the regex allows.
      '2026-02-31T09:00:00.000Z',
      '2026-13-01T09:00:00.000Z',
    ]) {
      expect(jao3InstantSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('digests a retryable write by MEANING, not by how the caller assembled it', () => {
    expect(jao3SemanticDigest(['a', 'b'])).toBe(jao3SemanticDigest(['a', 'b']));
    expect(jao3SemanticDigest(['a', 'b'])).not.toBe(jao3SemanticDigest(['b', 'a']));
    // Length-prefixed, so two different splits of the same characters are different writes.
    expect(jao3SemanticDigest(['ab', 'c'])).not.toBe(jao3SemanticDigest(['a', 'bc']));
    expect(jao3SemanticDigest(['a'])).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('closes the error vocabulary and never builds a message from an input', () => {
    expect(JAO3_ERROR_CODES).toContain('DATABASE_UNAVAILABLE');
    expect(JAO3_ERROR_CODES).toContain('INVESTIGATION_NOT_FOUND');
    for (const code of JAO3_ERROR_CODES) {
      const error = new jao3.Jao3MemoryError(code);
      expect(error.code).toBe(code);
      expect(error.message.length).toBeGreaterThan(0);
      // No identifier, no SQL, no host, no path.
      expect(error.message).not.toContain('jao3.');
      expect(error.message).not.toContain('SELECT');
      expect(error.message).not.toContain('qf_jarvis');
      expect(error.message).not.toContain('postgres');
    }
  });

  it('reaches no business truth, no provider, no shell and no environment', () => {
    for (const { name, code } of jao3Sources()) {
      const specifiers = [...code.matchAll(/from '([^']+)'/gu)].map((match) => match[1] ?? '');
      for (const specifier of specifiers) {
        for (const forbidden of [
          'approval',
          'execution',
          'communication',
          'model-gateway',
          'riya',
          'governed-specialist-delegation',
          'mastra-supervisor',
          'jarvis-runtime',
          'postgres-conversation-state',
          'core-decision-adapter',
          'n8n',
          'whatsapp',
          'meta',
        ]) {
          expect(specifier.toLowerCase(), `${name} -> ${specifier}`).not.toContain(forbidden);
        }
        expect(specifier, name).not.toMatch(/^node:(fs|http|https|net|child_process|dns|tls)$/u);
        expect(specifier, name).not.toContain('@mastra/');
      }

      expect(code, name).not.toContain('process.env');
      expect(code, name).not.toMatch(/[^a-zA-Z.]fetch\s*\(/u);
      expect(code, name).not.toMatch(/setInterval\s*\(/u);
      expect(code, name).not.toMatch(/setTimeout\s*\(/u);
      expect(code, name).not.toMatch(/cron/iu);
    }
  });

  it('uses no Mastra at all, memory or otherwise', () => {
    // JAO-1 and JAO-2 use @mastra/core/workflows because sequencing is what they prove. JAO-3
    // proves durability, and Mastra in-process state is not durable -- removing Mastra entirely
    // must not damage the memory format, which is only true while the format lives in the schema.
    for (const { name, code } of jao3Sources()) {
      expect(code, name).not.toContain('@mastra');
      // Mastra's own surfaces by name, rather than the substring `Memory` -- which JAO-3 uses for
      // its own `Jao3MemoryError` and would therefore flag the slice for naming itself.
      for (const surface of [
        'MastraMemory',
        'MastraStorage',
        'new Memory(',
        'LibSQLStore',
        'PgStore',
        'createMemory',
        'memory:',
        'storage:',
      ]) {
        expect(code, `${name} -> ${surface}`).not.toContain(surface);
      }
    }
  });

  it('names only its own schema in SQL, and issues no UPDATE or DELETE against history', () => {
    const store = codeOnly(fs.readFileSync(path.join(jao3Dir(), 'postgres-store.ts'), 'utf8'));

    for (const table of [...store.matchAll(/(?:INTO|FROM|UPDATE)\s+([a-z_]+)\.([a-z_]+)/gu)]) {
      expect(table[1], table[0]).toBe('qf_jarvis_jao3');
    }
    // The managed event-backbone schema is never named.
    expect(store).not.toMatch(/qf_jarvis\.[a-z_]/u);

    // History is append-only: the only UPDATE target is the investigation header.
    for (const updated of [...store.matchAll(/UPDATE\s+qf_jarvis_jao3\.([a-z_]+)/gu)]) {
      expect(updated[1], updated[0]).toBe('investigation');
    }
    expect(store).not.toMatch(/DELETE\s+FROM/iu);
    expect(store).not.toMatch(/DROP\s+/iu);
    expect(store).not.toMatch(/TRUNCATE/iu);

    // Every statement is parameterized; no identifier or value is interpolated into SQL.
    const statements = [...store.matchAll(/`\s*\n\s*(?:SELECT|INSERT|UPDATE)[\s\S]*?`/gu)];
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      const text = statement[0];
      const interpolations = [...text.matchAll(/\$\{([A-Za-z0-9_]+)\}/gu)].map((one) => one[1]);
      for (const name of interpolations) {
        // Only the two column lists and the instant format, all module constants.
        expect(['INVESTIGATION_COLUMNS', 'CHECKPOINT_COLUMNS', 'INSTANT'], text).toContain(name);
      }
    }
  });

  it('exposes a surface that remembers and cannot permit', () => {
    const exported = Object.keys(jao3);
    for (const forbidden of [
      'authorize',
      'approve',
      'canExecute',
      'execute',
      'send',
      'dispatch',
      'activateVendor',
      'assignLead',
      'clearAll',
      'deleteAll',
      'reset',
      'prune',
      'pruneAll',
      'deleteInvestigation',
      'query',
      'rawQuery',
      'sql',
    ]) {
      expect(exported, forbidden).not.toContain(forbidden);
    }

    // The store port itself offers no destructive or authorising operation either.
    const port = codeOnly(fs.readFileSync(path.join(jao3Dir(), 'store-port.ts'), 'utf8'));
    for (const forbidden of [
      'clearAll(',
      'deleteAll(',
      'reset(',
      'execute(',
      'authorize(',
      'approve(',
      'send(',
      'query(',
    ]) {
      expect(port, forbidden).not.toContain(forbidden);
    }
  });

  it('keeps the schema asset out of managed migration history', () => {
    const schemaPath = path.join(jao3Dir(), 'schema', '001_jao_investigation_memory.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    // It lives with the code that uses it, NOT in the event-backbone migrations directory that
    // `pnpm db:migrate` applies to a real database.
    const managed = path.resolve(
      fileURLToPath(new URL('.', import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      'packages',
      'event-backbone',
      'src',
      'persistence',
      'migrations',
    );
    expect(fs.readdirSync(managed).some((entry) => entry.toLowerCase().includes('jao'))).toBe(
      false,
    );

    const code = codeOnly(sql);
    // Forward-only and self-contained: its own schema, no destructive statement, no CASCADE, no
    // trigger, no extension, no environment-specific value.
    expect(code).toContain('CREATE SCHEMA IF NOT EXISTS qf_jarvis_jao3');
    expect(code).not.toMatch(/DROP\s+/iu);
    expect(code).not.toMatch(/ALTER\s+TABLE/iu);
    expect(code).not.toMatch(/CASCADE/iu);
    expect(code).not.toMatch(/CREATE\s+TRIGGER/iu);
    expect(code).not.toMatch(/CREATE\s+EXTENSION/iu);
    expect(code).not.toMatch(/jsonb?/iu);
    expect(code).not.toMatch(/qf_jarvis\.[a-z_]/u);

    // No authority column exists to be written.
    for (const forbidden of [
      'is_authorized',
      'can_execute',
      'can_send',
      'approval_granted',
      'execution_allowed',
      'chain_of_thought',
      'transcript',
      'api_key',
      'credential',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('validates an investigation id BEFORE reaching the database', async () => {
    // Owner-review correction. The two read methods take an id rather than a request object, so
    // nothing parsed it: parameterized SQL made a malformed id SAFE, which is not the same as the
    // adapter having checked its own domain boundary.
    //
    // The pool throws if it is ever borrowed from, so "no query ran" is a measured fact rather
    // than an inference from a passing assertion.
    const store = createJao3PostgresStore(exploding.pool);

    for (const malformed of [
      '',
      '   ',
      'has space',
      'has/slash',
      'has;semicolon',
      "quote'injection",
      'x'.repeat(129),
      '\u0000null-byte',
      'unicode-\u00e9',
    ]) {
      await expect(store.readInvestigation(malformed), malformed).rejects.toMatchObject({
        code: 'INPUT_INVALID',
      });
      await expect(store.readInvestigationView(malformed), malformed).rejects.toMatchObject({
        code: 'INPUT_INVALID',
      });
    }

    // Both entry points share the parse, and neither reached the database even once.
    expect(exploding.connects()).toBe(0);

    // The same parser both methods use, exercised directly.
    expect(parseJao3InvestigationId('jao3.investigation.000001')).toBe('jao3.investigation.000001');
    for (const malformed of [undefined, null, 42, {}, [], '', 'has space', 'y'.repeat(129)]) {
      expect(() => parseJao3InvestigationId(malformed)).toThrow(
        expect.objectContaining({ code: 'INPUT_INVALID' }),
      );
    }

    // A well-formed id DOES reach the pool -- otherwise the proof above would hold for a store
    // that never queries at all.
    await expect(store.readInvestigation('jao3.investigation.000001')).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(exploding.connects()).toBe(1);
  });

  it('is imported and started by no production worker entry', () => {
    const appRoot = path.resolve(jao3Dir(), '..', '..');
    for (const entry of ['index.ts', 'worker-entry.ts']) {
      const code = codeOnly(fs.readFileSync(path.join(appRoot, entry), 'utf8'));
      expect(code, entry).not.toContain('operational-memory');
      expect(code, entry).not.toContain('jao3');
      expect(code, entry).not.toContain('Jao3');
    }

    // Nor does anything in the slice start itself. Matched as CALL shapes: `JAO3_MEMORY_BOUNDS`
    // declares `backgroundResume: false`, and a bare substring scan would read that declaration
    // that the thing is absent as evidence that it is present.
    for (const { name, code } of jao3Sources()) {
      expect(code, name).not.toMatch(
        /(autoResume|backgroundResume|startScheduler|pollForever|scheduleResume)\s*\(/u,
      );
      expect(code, name).not.toMatch(/\.unref\s*\(|setImmediate\s*\(|queueMicrotask\s*\(/u);
    }
  });

  it('reads no environment and no filesystem outside the excluded test harness', () => {
    // The harness is the only module that reads DATABASE_URL or a file, and
    // apps/worker/tsconfig.build.json excludes src/tests/** from the emitting build.
    for (const { name, code } of jao3Sources()) {
      expect(code, name).not.toContain('DATABASE_URL');
      expect(code, name).not.toContain('readFileSync');
      expect(code, name).not.toContain('node:fs');
    }
    const buildConfig = fs.readFileSync(
      path.resolve(jao3Dir(), '..', '..', '..', 'tsconfig.build.json'),
      'utf8',
    );
    expect(buildConfig).toContain('src/tests/**');
  });
});
