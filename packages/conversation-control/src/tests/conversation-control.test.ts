/**
 * QFJ-P08-A — the conversation control command foundation (ADR-0074).
 *
 * Three claims are under test. First, that the contracts are strict and content-free: an operator
 * command names references, never values, and there is no field through which a message body could
 * arrive. Second, that the reducer's action semantics are exactly the ones ADR-0054 E requires —
 * above all that `RELEASE_OWNERSHIP` never resumes AI, and that `RESUME_AI` is the only action that
 * can clear the pause. Third, that the whole thing is a pure function: no clock, no randomness, no
 * stored state, and no mutation of anything the caller still owns.
 *
 * There is deliberately NO cross-runtime test here ("take ownership, then the next turn refuses").
 * Nothing composes this reducer yet, so such a test would have to fake the composition it claims to
 * prove. It belongs to PR 2, where a writable authoritative-state adapter actually exists.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import {
  CONVERSATION_CONTROL_ACTIONS_FROZEN,
  CONVERSATION_CONTROL_ERROR_CODES,
  CONVERSATION_CONTROL_OUTCOMES_FROZEN,
  CONVERSATION_CONTROL_REASONS_FROZEN,
  CONVERSATION_CONTROL_VERSION,
  ConversationControlError,
  applyConversationControlCommand,
  createConversationControlCommand,
  createConversationControlSnapshot,
} from '../index.js';
import type {
  ConversationControlAction,
  ConversationControlCommand,
  ConversationControlCommandInput,
  ConversationControlSnapshot,
  ConversationControlSnapshotInput,
} from '../index.js';

const PKG_DIR = new URL('../../', import.meta.url);
const REPO_ROOT = new URL('../../../../', import.meta.url);

const ISSUED_AT = '2026-08-01T00:00:00.000Z';

function snapshotInput(
  over: Partial<ConversationControlSnapshotInput> = {},
): ConversationControlSnapshotInput {
  return { conversationId: 'conv.1', revision: 1, humanTakeover: false, aiPaused: false, ...over };
}
function snap(over: Partial<ConversationControlSnapshotInput> = {}): ConversationControlSnapshot {
  return createConversationControlSnapshot(snapshotInput(over));
}
function commandInput(
  over: Partial<ConversationControlCommandInput> = {},
): ConversationControlCommandInput {
  return {
    commandId: 'cmd.1',
    conversationId: 'conv.1',
    expectedRevision: 1,
    action: 'TAKE_OWNERSHIP',
    operatorRef: 'op.1',
    issuedAt: ISSUED_AT,
    ...over,
  };
}
function cmd(over: Partial<ConversationControlCommandInput> = {}): ConversationControlCommand {
  return createConversationControlCommand(commandInput(over));
}

/** Apply a command to a state, both built from the same defaults unless overridden. */
function run(
  state: Partial<ConversationControlSnapshotInput>,
  command: Partial<ConversationControlCommandInput> = {},
) {
  const s = snap(state);
  return applyConversationControlCommand(s, cmd({ expectedRevision: s.revision, ...command }));
}

// ---------------------------------------------------------------------------
// Command validation.
// ---------------------------------------------------------------------------

describe('command validation', () => {
  it('accepts all four actions and nothing else', () => {
    for (const action of CONVERSATION_CONTROL_ACTIONS_FROZEN) {
      expect(cmd({ action }).action).toBe(action);
    }
    for (const action of ['ASSIGN', 'APPROVE', 'RESOLVE', 'SEND', 'take_ownership', '']) {
      expect(() => cmd({ action: action as ConversationControlAction })).toThrow(
        ConversationControlError,
      );
    }
  });

  it('rejects an unknown key rather than ignoring it', () => {
    // A metadata bag is how a content-free contract stops being content-free.
    expect(() =>
      createConversationControlCommand({
        ...commandInput(),
        note: 'the customer sounded upset',
      } as unknown as ConversationControlCommandInput),
    ).toThrow(ConversationControlError);
  });

  it('refuses a caller-supplied controlVersion instead of ignoring it', () => {
    // A version a caller could set is a version that says what the caller wished the grammar was.
    expect(() =>
      createConversationControlCommand({
        ...commandInput(),
        controlVersion: 1,
      } as unknown as ConversationControlCommandInput),
    ).toThrow(ConversationControlError);
    expect(cmd().controlVersion).toBe(CONVERSATION_CONTROL_VERSION);
  });

  it('rejects a primitive, null, array or prototype-carrying object', () => {
    for (const value of ['x', 7, true, null, undefined, [commandInput()], new Date()]) {
      expect(() =>
        createConversationControlCommand(value as unknown as ConversationControlCommandInput),
      ).toThrow(ConversationControlError);
    }
    const inherited = Object.create({ action: 'TAKE_OWNERSHIP' }) as Record<string, unknown>;
    Object.assign(inherited, commandInput());
    expect(() =>
      createConversationControlCommand(inherited as unknown as ConversationControlCommandInput),
    ).toThrow(ConversationControlError);
  });

  it('enforces the exact identifier grammar on every reference', () => {
    const fields = ['commandId', 'conversationId', 'operatorRef', 'reasonRef'];
    const bad = ['', 'a'.repeat(129), 'has space', 'has/slash', '*', 'latest', 'LATEST', 'Latest'];
    for (const field of fields) {
      for (const value of bad) {
        expect(() => cmd({ [field]: value })).toThrow(ConversationControlError);
      }
      // 128 is the boundary, and it is inclusive.
      expect(() => cmd({ [field]: 'a'.repeat(128) })).not.toThrow();
    }
  });

  it('treats reasonRef as optional, and as an ABSENT key when omitted', () => {
    const without = cmd();
    expect('reasonRef' in without).toBe(false);
    const withRef = cmd({ reasonRef: 'reason.escalation' });
    expect(withRef.reasonRef).toBe('reason.escalation');
    // An explicit `undefined` is NORMALIZED to an absent key rather than refused. A caller building
    // the input by spreading a partial writes that shape naturally, and the canonical command is
    // byte-identical either way -- so refusing it would cost a common idiom and buy no safety.
    const explicitUndefined = createConversationControlCommand({
      ...commandInput(),
      reasonRef: undefined,
    } as unknown as ConversationControlCommandInput);
    expect('reasonRef' in explicitUndefined).toBe(false);
    expect(explicitUndefined).toEqual(cmd());
  });

  it('requires a non-negative safe integer expectedRevision', () => {
    expect(cmd({ expectedRevision: 0 }).expectedRevision).toBe(0);
    expect(cmd({ expectedRevision: Number.MAX_SAFE_INTEGER }).expectedRevision).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    for (const value of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 2,
    ]) {
      expect(() => cmd({ expectedRevision: value })).toThrow(ConversationControlError);
    }
  });

  it('requires an exact canonical UTC millisecond instant and reads no clock', () => {
    expect(cmd({ issuedAt: ISSUED_AT }).issuedAt).toBe(ISSUED_AT);
    for (const value of [
      '2026-08-01T00:00:00Z', // second precision
      '2026-08-01T00:00:00.000+00:00', // offset form
      '2026-08-01T00:00:00.000', // no zone
      '2026-08-01 00:00:00.000Z', // space separator
      '2026-08-01T00:00:00.0000Z', // microseconds
      'not-an-instant',
      '',
    ]) {
      expect(() => cmd({ issuedAt: value })).toThrow(ConversationControlError);
    }
  });

  it('rejects a well-shaped instant that is not a real calendar time', () => {
    // These PARSE -- JavaScript rolls them forward -- and would then be recorded as a date the
    // operator never wrote. The round-trip comparison is what catches them.
    for (const value of [
      '2026-02-30T00:00:00.000Z',
      '2026-13-01T00:00:00.000Z',
      '2026-08-01T25:00:00.000Z',
      '2026-00-10T00:00:00.000Z',
    ]) {
      expect(() => cmd({ issuedAt: value })).toThrow(ConversationControlError);
    }
  });

  it('freezes the canonical command and leaves the caller input untouched', () => {
    const input = commandInput({ reasonRef: 'reason.x' });
    const built = cmd({ reasonRef: 'reason.x' });
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(input).toEqual(commandInput({ reasonRef: 'reason.x' }));
  });
});

// ---------------------------------------------------------------------------
// Snapshot validation.
// ---------------------------------------------------------------------------

describe('snapshot validation', () => {
  it('accepts revision zero and the safe-integer ceiling', () => {
    expect(snap({ revision: 0 }).revision).toBe(0);
    expect(snap({ revision: Number.MAX_SAFE_INTEGER }).revision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects a negative, fractional or unsafe revision', () => {
    for (const revision of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => snap({ revision })).toThrow(ConversationControlError);
    }
  });

  it('rejects an unknown key, including one that would duplicate the full runtime state', () => {
    // This is a control FRAGMENT, not a copy of `jarvis-runtime`'s ConversationControlState. Those
    // fields are owned there, and a second definition of them would drift.
    for (const key of ['tenantId', 'partyType', 'dataClass', 'cancelled', 'subjectStatus']) {
      expect(() =>
        createConversationControlSnapshot({
          ...snapshotInput(),
          [key]: 'x',
        }),
      ).toThrow(ConversationControlError);
    }
  });

  it('rejects a primitive, null or array', () => {
    for (const value of ['x', 7, true, null, undefined, [snapshotInput()]]) {
      expect(() =>
        createConversationControlSnapshot(value as unknown as ConversationControlSnapshotInput),
      ).toThrow(ConversationControlError);
    }
  });

  it('accepts takeover-without-pause, which the reducer can repair', () => {
    // Not a state THIS reducer produces, but the authoritative source is owned elsewhere and may be
    // mid-migration or hand-corrected. Refusing to read it would fail closed toward leaving AI
    // running, which is the wrong direction.
    const accepted = snap({ humanTakeover: true, aiPaused: false });
    expect(accepted.humanTakeover).toBe(true);
    expect(accepted.aiPaused).toBe(false);
  });

  it('freezes the canonical snapshot and leaves the caller input untouched', () => {
    const input = snapshotInput();
    const built = createConversationControlSnapshot(input);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Action semantics.
// ---------------------------------------------------------------------------

describe('TAKE_OWNERSHIP', () => {
  const cases: readonly [boolean, boolean, string][] = [
    [false, false, 'idle'],
    [false, true, 'already paused'],
    [true, false, 'takeover without pause'],
  ];
  for (const [humanTakeover, aiPaused, label] of cases) {
    it(`applies from ${label} to takeover + paused`, () => {
      const d = run({ humanTakeover, aiPaused }, { action: 'TAKE_OWNERSHIP' });
      expect(d.outcome).toBe('APPLIED');
      expect(d.reason).toBe('applied');
      expect(d.nextState.humanTakeover).toBe(true);
      // Takeover ALWAYS forces the pause -- the launch gate is "human takeover stops AI = 100%".
      expect(d.nextState.aiPaused).toBe(true);
      expect(d.nextState.revision).toBe(2);
    });
  }

  it('is a no-op when already owned and paused', () => {
    const d = run({ humanTakeover: true, aiPaused: true }, { action: 'TAKE_OWNERSHIP' });
    expect(d.outcome).toBe('NO_CHANGE');
    expect(d.reason).toBe('already-satisfied');
    expect(d.nextState.revision).toBe(1);
  });
});

describe('RELEASE_OWNERSHIP', () => {
  it('exits takeover and LEAVES AI PAUSED', () => {
    const d = run({ humanTakeover: true, aiPaused: true }, { action: 'RELEASE_OWNERSHIP' });
    expect(d.outcome).toBe('APPLIED');
    expect(d.nextState.humanTakeover).toBe(false);
    // ADR-0054 E: there is no automatic release from human takeover.
    expect(d.nextState.aiPaused).toBe(true);
    expect(d.nextState.revision).toBe(2);
  });

  it('leaves AI paused even when the incoming state had takeover without pause', () => {
    const d = run({ humanTakeover: true, aiPaused: false }, { action: 'RELEASE_OWNERSHIP' });
    expect(d.outcome).toBe('APPLIED');
    expect(d.nextState.humanTakeover).toBe(false);
    expect(d.nextState.aiPaused).toBe(true);
  });

  it('is a no-op when no human holds the conversation', () => {
    for (const aiPaused of [false, true]) {
      const d = run({ humanTakeover: false, aiPaused }, { action: 'RELEASE_OWNERSHIP' });
      expect(d.outcome).toBe('NO_CHANGE');
      expect(d.nextState.aiPaused).toBe(aiPaused);
      expect(d.nextState.revision).toBe(1);
    }
  });
});

describe('PAUSE_AI', () => {
  it('pauses without touching ownership', () => {
    for (const humanTakeover of [false, true]) {
      const d = run({ humanTakeover, aiPaused: false }, { action: 'PAUSE_AI' });
      expect(d.outcome).toBe('APPLIED');
      expect(d.nextState.aiPaused).toBe(true);
      expect(d.nextState.humanTakeover).toBe(humanTakeover);
      expect(d.nextState.revision).toBe(2);
    }
  });

  it('is a no-op when already paused', () => {
    const d = run({ aiPaused: true }, { action: 'PAUSE_AI' });
    expect(d.outcome).toBe('NO_CHANGE');
    expect(d.nextState.revision).toBe(1);
  });
});

describe('RESUME_AI', () => {
  it('is REFUSED while a human holds the conversation', () => {
    for (const aiPaused of [false, true]) {
      const d = run({ humanTakeover: true, aiPaused }, { action: 'RESUME_AI' });
      expect(d.outcome).toBe('REFUSED');
      expect(d.reason).toBe('human-takeover-active');
      expect(d.nextState.humanTakeover).toBe(true);
      expect(d.nextState.aiPaused).toBe(aiPaused);
      expect(d.nextState.revision).toBe(1);
    }
  });

  it('resumes a paused conversation with no takeover', () => {
    const d = run({ humanTakeover: false, aiPaused: true }, { action: 'RESUME_AI' });
    expect(d.outcome).toBe('APPLIED');
    expect(d.nextState.humanTakeover).toBe(false);
    expect(d.nextState.aiPaused).toBe(false);
    expect(d.nextState.revision).toBe(2);
  });

  it('is a no-op when AI is already active', () => {
    const d = run({ humanTakeover: false, aiPaused: false }, { action: 'RESUME_AI' });
    expect(d.outcome).toBe('NO_CHANGE');
    expect(d.nextState.revision).toBe(1);
  });
});

describe('the return-to-AI invariant (ADR-0054 E)', () => {
  it('TAKE_OWNERSHIP then RELEASE_OWNERSHIP leaves AI PAUSED', () => {
    const start = snap({ revision: 1, humanTakeover: false, aiPaused: false });
    const taken = applyConversationControlCommand(
      start,
      cmd({ commandId: 'cmd.take', expectedRevision: 1, action: 'TAKE_OWNERSHIP' }),
    );
    expect(taken.nextState).toEqual({
      conversationId: 'conv.1',
      revision: 2,
      humanTakeover: true,
      aiPaused: true,
    });

    const released = applyConversationControlCommand(
      taken.nextState,
      cmd({ commandId: 'cmd.release', expectedRevision: 2, action: 'RELEASE_OWNERSHIP' }),
    );
    // The whole point: handing the conversation back is NOT the same decision as declaring it safe
    // for AI again. Collapsing the two would make every handoff silently re-arm automatic replies.
    expect(released.nextState).toEqual({
      conversationId: 'conv.1',
      revision: 3,
      humanTakeover: false,
      aiPaused: true,
    });

    const resumed = applyConversationControlCommand(
      released.nextState,
      cmd({ commandId: 'cmd.resume', expectedRevision: 3, action: 'RESUME_AI' }),
    );
    // Only an explicit, separately issued RESUME_AI reaches false/false.
    expect(resumed.nextState).toEqual({
      conversationId: 'conv.1',
      revision: 4,
      humanTakeover: false,
      aiPaused: false,
    });
  });

  it('RESUME_AI is the ONLY action that can clear the pause', () => {
    for (const action of CONVERSATION_CONTROL_ACTIONS_FROZEN) {
      for (const humanTakeover of [false, true]) {
        const d = run({ humanTakeover, aiPaused: true }, { action });
        const cleared = !d.nextState.aiPaused;
        expect(cleared).toBe(action === 'RESUME_AI' && !humanTakeover);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Revision contract.
// ---------------------------------------------------------------------------

describe('revision contract', () => {
  it('refuses a stale expected revision without changing anything', () => {
    const d = applyConversationControlCommand(
      snap({ revision: 5 }),
      cmd({ expectedRevision: 4, action: 'TAKE_OWNERSHIP' }),
    );
    expect(d.outcome).toBe('REFUSED');
    expect(d.reason).toBe('revision-mismatch');
    expect(d.nextState.revision).toBe(5);
    expect(d.nextState.humanTakeover).toBe(false);
  });

  it('refuses a FUTURE expected revision too', () => {
    const d = applyConversationControlCommand(
      snap({ revision: 5 }),
      cmd({ expectedRevision: 6, action: 'TAKE_OWNERSHIP' }),
    );
    expect(d.reason).toBe('revision-mismatch');
  });

  it('bumps by exactly one on APPLIED and not at all otherwise', () => {
    expect(run({ revision: 7 }, { action: 'TAKE_OWNERSHIP' }).nextState.revision).toBe(8);
    expect(
      run({ revision: 7, humanTakeover: true, aiPaused: true }, { action: 'TAKE_OWNERSHIP' })
        .nextState.revision,
    ).toBe(7);
    expect(
      run({ revision: 7, humanTakeover: true }, { action: 'RESUME_AI' }).nextState.revision,
    ).toBe(7);
  });

  it('refuses a change at the safe-integer ceiling rather than overflowing', () => {
    const d = run({ revision: Number.MAX_SAFE_INTEGER }, { action: 'TAKE_OWNERSHIP' });
    expect(d.outcome).toBe('REFUSED');
    expect(d.reason).toBe('revision-exhausted');
    expect(d.nextState.revision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('still allows a NO_CHANGE at the ceiling — nothing needs counting', () => {
    const d = run(
      { revision: Number.MAX_SAFE_INTEGER, humanTakeover: true, aiPaused: true },
      { action: 'TAKE_OWNERSHIP' },
    );
    expect(d.outcome).toBe('NO_CHANGE');
  });

  it('reports staleness in preference to exhaustion', () => {
    // The operator's problem is that they are looking at an old conversation; telling them the
    // counter is exhausted would send them to the wrong place.
    const d = applyConversationControlCommand(
      snap({ revision: Number.MAX_SAFE_INTEGER }),
      cmd({ expectedRevision: 3, action: 'TAKE_OWNERSHIP' }),
    );
    expect(d.reason).toBe('revision-mismatch');
  });
});

// ---------------------------------------------------------------------------
// Identity and re-validation.
// ---------------------------------------------------------------------------

describe('conversation identity', () => {
  it('throws invalid-application for a command aimed at another conversation', () => {
    // Not a refusal: a refusal would return a plausible decision for a conversation nobody asked
    // about. It is a wiring error.
    let thrown: unknown;
    try {
      applyConversationControlCommand(
        snap({ conversationId: 'conv.1' }),
        cmd({ conversationId: 'conv.2' }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConversationControlError);
    expect((thrown as ConversationControlError).code).toBe('invalid-application');
    // Neither conversation id appears in the message.
    const message = (thrown as Error).message;
    expect(message).not.toContain('conv.1');
    expect(message).not.toContain('conv.2');
  });

  it('re-validates a forged command that never passed the constructor', () => {
    const forged = {
      controlVersion: 1,
      commandId: 'cmd.1',
      conversationId: 'conv.1',
      expectedRevision: 1,
      action: 'ESCALATE',
      operatorRef: 'op.1',
      issuedAt: ISSUED_AT,
    } as unknown as ConversationControlCommand;
    expect(() => applyConversationControlCommand(snap(), forged)).toThrow(ConversationControlError);
  });

  it('re-validates a forged snapshot that never passed the constructor', () => {
    const forged = {
      conversationId: 'conv.1',
      revision: -1,
      humanTakeover: false,
      aiPaused: false,
    } as unknown as ConversationControlSnapshot;
    expect(() => applyConversationControlCommand(forged, cmd({ expectedRevision: -1 }))).toThrow(
      ConversationControlError,
    );
  });

  it('rejects a command record carrying an extra key or a foreign version', () => {
    const base = cmd();
    expect(() =>
      applyConversationControlCommand(snap(), {
        ...base,
        smuggled: 'content',
      } as unknown as ConversationControlCommand),
    ).toThrow(ConversationControlError);
    expect(() =>
      applyConversationControlCommand(snap(), {
        ...base,
        controlVersion: 2,
      } as unknown as ConversationControlCommand),
    ).toThrow(ConversationControlError);
  });

  it('does not mutate or freeze either argument', () => {
    const mutableState = { ...snapshotInput() };
    const mutableCommand = { ...cmd() };
    applyConversationControlCommand(mutableState, mutableCommand);
    expect(Object.isFrozen(mutableState)).toBe(false);
    expect(Object.isFrozen(mutableCommand)).toBe(false);
    expect(mutableState).toEqual(snapshotInput());
  });
});

// ---------------------------------------------------------------------------
// Audit evidence.
// ---------------------------------------------------------------------------

describe('audit evidence', () => {
  const EXPECTED_RECORD_KEYS = [
    'recordVersion',
    'commandId',
    'conversationId',
    'action',
    'operatorRef',
    'reasonRef',
    'expectedRevision',
    'observedRevision',
    'outcome',
    'reason',
    'resultingRevision',
    'humanTakeover',
    'aiPaused',
    'issuedAt',
  ].sort();

  it('exists for APPLIED, NO_CHANGE and REFUSED alike', () => {
    // A record that only existed on success would make refusals invisible to an operations review.
    const applied = run({}, { action: 'TAKE_OWNERSHIP' });
    const noChange = run({ humanTakeover: true, aiPaused: true }, { action: 'TAKE_OWNERSHIP' });
    const refused = run({ humanTakeover: true }, { action: 'RESUME_AI' });
    expect(applied.outcome).toBe('APPLIED');
    expect(noChange.outcome).toBe('NO_CHANGE');
    expect(refused.outcome).toBe('REFUSED');
    for (const d of [applied, noChange, refused]) {
      expect(d.auditRecord).toBeDefined();
      expect(d.auditRecord.outcome).toBe(d.outcome);
      expect(d.auditRecord.reason).toBe(d.reason);
    }
  });

  it('carries the exact command references and both revisions', () => {
    const d = applyConversationControlCommand(
      snap({ revision: 9 }),
      cmd({
        commandId: 'cmd.abc',
        operatorRef: 'op.zed',
        reasonRef: 'reason.q',
        expectedRevision: 8,
        action: 'PAUSE_AI',
      }),
    );
    const r = d.auditRecord;
    expect(r.commandId).toBe('cmd.abc');
    expect(r.conversationId).toBe('conv.1');
    expect(r.action).toBe('PAUSE_AI');
    expect(r.operatorRef).toBe('op.zed');
    expect(r.reasonRef).toBe('reason.q');
    expect(r.expectedRevision).toBe(8);
    expect(r.observedRevision).toBe(9);
    expect(r.outcome).toBe('REFUSED');
    expect(r.issuedAt).toBe(ISSUED_AT);
  });

  it('records booleans and resultingRevision that always match nextState', () => {
    for (const action of CONVERSATION_CONTROL_ACTIONS_FROZEN) {
      for (const humanTakeover of [false, true]) {
        for (const aiPaused of [false, true]) {
          const d = run({ humanTakeover, aiPaused }, { action });
          expect(d.auditRecord.humanTakeover).toBe(d.nextState.humanTakeover);
          expect(d.auditRecord.aiPaused).toBe(d.nextState.aiPaused);
          expect(d.auditRecord.resultingRevision).toBe(d.nextState.revision);
        }
      }
    }
  });

  it('omits reasonRef entirely when the command had none', () => {
    const r = run({}, { action: 'TAKE_OWNERSHIP' }).auditRecord;
    expect('reasonRef' in r).toBe(false);
    expect(Object.keys(r).sort()).toEqual(EXPECTED_RECORD_KEYS.filter((k) => k !== 'reasonRef'));
  });

  it('exposes exactly the closed key set and only scalar values', () => {
    const r = run({}, { action: 'TAKE_OWNERSHIP', reasonRef: 'reason.x' }).auditRecord;
    expect(Object.keys(r).sort()).toEqual(EXPECTED_RECORD_KEYS);
    for (const value of Object.values(r)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
  });

  it('is content-free: nothing resembling a message, party, provider or subject', () => {
    const serialized = JSON.stringify(
      run({}, { action: 'TAKE_OWNERSHIP', reasonRef: 'reason.x' }).auditRecord,
    ).toLowerCase();
    for (const forbidden of [
      'message',
      'body',
      'text',
      'prompt',
      'reply',
      'tenant',
      'party',
      'subject',
      'provider',
      'model',
      'email',
      'phone',
      'payment',
      'refund',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Immutability and determinism.
// ---------------------------------------------------------------------------

describe('immutability and determinism', () => {
  it('freezes the decision, its nextState and its auditRecord', () => {
    const d = run({}, { action: 'TAKE_OWNERSHIP' });
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.nextState)).toBe(true);
    expect(Object.isFrozen(d.auditRecord)).toBe(true);
  });

  it('produces a deep-equal decision for the same values every time', () => {
    for (const action of CONVERSATION_CONTROL_ACTIONS_FROZEN) {
      const a = run({ humanTakeover: true, aiPaused: false }, { action });
      const b = run({ humanTakeover: true, aiPaused: false }, { action });
      expect(a).toEqual(b);
    }
  });

  it('reads no clock, no randomness and no crypto in production source', () => {
    for (const file of productionFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/Date\.now|Math\.random|crypto|new Date\(\s*\)/);
      expect(code).not.toMatch(/process\.env/);
    }
  });

  it('holds no module-level mutable state', () => {
    for (const file of productionFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      // A top-level `let`/`var`, or a top-level collection, is how a pure reducer quietly acquires a
      // cache. Collections built INSIDE a function are locals and are fine -- the validators use one.
      expect(code).not.toMatch(/^(let|var)\s/m);
      const topLevel = code.split(String.fromCharCode(10)).filter((line) => /^[A-Za-z]/.test(line));
      expect(topLevel.some((line) => /=\s*new (Map|Set|WeakMap|WeakSet)/.test(line))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

describe('error contract', () => {
  it('exposes exactly three codes with fixed messages', () => {
    expect([...CONVERSATION_CONTROL_ERROR_CODES]).toEqual([
      'invalid-command',
      'invalid-state',
      'invalid-application',
    ]);
    expect(Object.isFrozen(CONVERSATION_CONTROL_ERROR_CODES)).toBe(true);
    expect(new ConversationControlError('invalid-command').message).toBe(
      'A conversation-control command is invalid.',
    );
    expect(new ConversationControlError('invalid-state').message).toBe(
      'A conversation-control snapshot is invalid.',
    );
    expect(new ConversationControlError('invalid-application').message).toBe(
      'A conversation-control command cannot be applied to this snapshot.',
    );
  });

  it('leaks no Zod detail, identifier or cause', () => {
    let thrown: unknown;
    try {
      cmd({ operatorRef: 'operator with spaces', commandId: 'cmd.secret' });
    } catch (error) {
      thrown = error;
    }
    const error = thrown as ConversationControlError;
    expect(error).toBeInstanceOf(ConversationControlError);
    expect(error.message).toBe('A conversation-control command is invalid.');
    expect(error.message).not.toContain('cmd.secret');
    expect(error.message).not.toContain('operator with spaces');
    expect(JSON.stringify(error.message)).not.toMatch(/zod|invalid_|issues|path/i);
    expect((error as unknown as { cause?: unknown }).cause).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Vocabulary, API surface and containment.
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}
const productionFiles = (): string[] =>
  walk(fileURLToPath(new URL('src', PKG_DIR))).filter(
    (f) => !f.replace(/\\/g, '/').includes('/tests/'),
  );

/** Comments legitimately NAME the forbidden terms, so a scan must read code only. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('vocabularies, API surface and containment', () => {
  it('exposes exactly the four actions, three outcomes and five reasons, frozen', () => {
    expect([...CONVERSATION_CONTROL_ACTIONS_FROZEN]).toEqual([
      'TAKE_OWNERSHIP',
      'RELEASE_OWNERSHIP',
      'PAUSE_AI',
      'RESUME_AI',
    ]);
    expect([...CONVERSATION_CONTROL_OUTCOMES_FROZEN]).toEqual(['APPLIED', 'NO_CHANGE', 'REFUSED']);
    expect([...CONVERSATION_CONTROL_REASONS_FROZEN]).toEqual([
      'applied',
      'already-satisfied',
      'revision-mismatch',
      'human-takeover-active',
      'revision-exhausted',
    ]);
    for (const frozen of [
      CONVERSATION_CONTROL_ACTIONS_FROZEN,
      CONVERSATION_CONTROL_OUTCOMES_FROZEN,
      CONVERSATION_CONTROL_REASONS_FROZEN,
    ]) {
      expect(Object.isFrozen(frozen)).toBe(true);
    }
  });

  it('names no business, assignment, send or execute action', () => {
    // This package moves two booleans. A vocabulary is the cheapest place to make that structural.
    const actions = [...CONVERSATION_CONTROL_ACTIONS_FROZEN].join(' ').toUpperCase();
    for (const forbidden of [
      'ASSIGN',
      'APPROVE',
      'REJECT',
      'RESOLVE',
      'SEND',
      'EXECUTE',
      'AUTHORIZE',
      'PAYMENT',
      'REFUND',
      'ACTIVATE',
      'VERIFY',
    ]) {
      expect(actions).not.toContain(forbidden);
    }
  });

  it('publishes exactly nine root runtime symbols and no default export', () => {
    const keys = Object.keys(barrel).sort();
    expect(keys).toEqual([
      'CONVERSATION_CONTROL_ACTIONS_FROZEN',
      'CONVERSATION_CONTROL_ERROR_CODES',
      'CONVERSATION_CONTROL_OUTCOMES_FROZEN',
      'CONVERSATION_CONTROL_REASONS_FROZEN',
      'CONVERSATION_CONTROL_VERSION',
      'ConversationControlError',
      'applyConversationControlCommand',
      'createConversationControlCommand',
      'createConversationControlSnapshot',
    ]);
    expect(keys).toHaveLength(9);
    expect('default' in barrel).toBe(false);
  });

  it('keeps every schema, regex, validator and record factory internal', () => {
    const exported = Object.keys(barrel).join(' ');
    for (const internal of [
      'Schema',
      'schema',
      'isCanonicalInstant',
      'isPlainRecord',
      'revalidate',
      'EXACT_IDENTIFIER',
      'REVISION',
      'auditRecord',
      'RECORD_VERSION',
      'MATERIALIZED',
    ]) {
      expect(exported).not.toContain(internal);
    }
  });

  it('locks the type-export count at eleven', () => {
    const source = readFileSync(fileURLToPath(new URL('src/index.ts', PKG_DIR)), 'utf8');
    // Every `export type { ... }` block, single-line or multi-line.
    const names = [...source.matchAll(/export type \{([\s\S]*?)\}/g)].flatMap((match) =>
      (match[1] ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );
    expect([...new Set(names)].sort()).toEqual([
      'ConversationControlAction',
      'ConversationControlAuditRecord',
      'ConversationControlCommand',
      'ConversationControlCommandInput',
      'ConversationControlDecision',
      'ConversationControlErrorCode',
      'ConversationControlOutcome',
      'ConversationControlReason',
      'ConversationControlSnapshot',
      'ConversationControlSnapshotInput',
      'ConversationControlVersion',
    ]);
    expect(new Set(names).size).toBe(11);
  });

  it('depends on zod alone, with no workspace runtime dependency', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['zod']);
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.dependencies?.['zod']).toBe('4.4.3');
  });

  it('imports no workspace package in production source', () => {
    for (const file of productionFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/from ['"]@qf-jarvis\//);
    }
  });

  it('performs no I/O, network, database, transport or provider work', () => {
    for (const file of productionFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|crypto|worker_threads)['"]/,
      );
      expect(code).not.toMatch(
        /from ['"](pg|groq-sdk|openai|@anthropic-ai\/sdk|ollama|axios|undici)['"]/,
      );
      expect(code).not.toMatch(/\b(supabase|postgres|redis|SELECT |INSERT |UPDATE |DELETE )/i);
      expect(code).not.toMatch(/\bn8n\b|whatsapp|groq/i);
    }
  });

  it('exposes no send, execute, authorize or business-mutation capability', () => {
    for (const file of productionFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/\b(send|execute|authorize|dispatch|deliver)\s*\(/);
      expect(code).not.toMatch(/\b(payment|refund|entitlement|verification|assignedActor)\b/i);
    }
  });

  it('duplicates no field of the jarvis-runtime conversation state', () => {
    // A second definition of what a conversation IS would drift the first time either changed.
    const snapshotSource = readFileSync(
      fileURLToPath(new URL('src/contracts/control-snapshot.ts', PKG_DIR)),
      'utf8',
    );
    const code = stripComments(snapshotSource);
    for (const owned of [
      'tenantId',
      'partyType',
      'dataClass',
      'cancelled',
      'subjectStatus',
      'subjectRef',
      'observedAt',
    ]) {
      expect(code).not.toContain(owned);
    }
  });

  it('adds no migration: 0001-0011 exactly, and no 0012', () => {
    const dir = fileURLToPath(
      new URL('packages/event-backbone/src/persistence/migrations/', REPO_ROOT),
    );
    expect(
      readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort(),
    ).toEqual([
      '0001_event_log.sql',
      '0002_event_runtime_grants.sql',
      '0003_ingestion_rejection_and_event_conflict.sql',
      '0004_projection_foundation.sql',
      '0005_projection_event_positions.sql',
      '0006_projection_failure_operations.sql',
      '0007_subject_activity_projection.sql',
      '0008_conversation_control_persistence.sql',
      '0009_durable_approval_queue.sql',
      '0010_execution_replay_claim.sql',
      '0011_riya_conversation_continuity.sql',
      // RWC-P8 (ADR-0104): the ONE authorized addition, repository and LOCAL/CI only.
      '0012_riya_logical_turn_idempotency.sql',
      '0013_communication_state_projection.sql',
    ]);
  });
});
