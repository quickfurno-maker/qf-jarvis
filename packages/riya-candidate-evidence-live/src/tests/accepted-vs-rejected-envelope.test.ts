/**
 * LANE R — the accepted-vs-rejected request-envelope differential, made EXECUTABLE.
 *
 * ### What this file is for
 *
 * OAD3's `O2` was ACCEPTED (HTTP 200, provider completed). NRA1, MD120B3 and RSP20B2 were all
 * REJECTED with HTTP 400 `JSON_VALIDATE_FAILED` — across two models and two output contracts.
 *
 * A prose comparison of those two request shapes is only true on the day it is written. This file
 * turns it into an assertion, so the day a held-constant field starts drifting the suite says so
 * instead of a future reader re-deriving the comparison by hand.
 *
 * ### Content discipline
 *
 * Lengths, digests, role names, counts and field-name sets only. No production prompt text, no user
 * text and no schema body is asserted, printed or embedded — a spec that pinned prompt bytes would
 * put the prompt in the repository twice and make every prompt revision a test edit.
 *
 * Digests are TRUNCATED SHA-256 over content the repository already holds, used to prove two paths
 * carry the SAME object rather than to reveal what it is.
 *
 * ### What it does NOT claim
 *
 * Nothing here reaches a provider. A variant constructed below is a REQUEST SHAPE, and the fact that
 * it can be built says nothing about what a provider would do with it. No assertion in this file
 * means "this reproduces JSON_VALIDATE_FAILED" — that would require a live call, and none is made.
 */
import { createHash } from 'node:crypto';

import { projectGroqStrictJsonSchema } from '@qf-jarvis/model-gateway';
import { RIYA_COMPLETION_BUDGET_TOKENS } from '@qf-jarvis/riya-model-interaction';
import { beforeAll, describe, expect, it } from 'vitest';

import { CANDIDATE_MAX_COMPLETION_TOKENS, CANDIDATE_MODEL_ID } from '../candidate-release.js';
import type { CapturedProductionRiyaRequest } from '../diagnostic-canary-materials.js';
import { SYNTHETIC_CANARY_MESSAGES } from '../diagnostic-canary-port.js';
import type { CanaryMessage } from '../diagnostic-canary-port.js';
import { OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET } from '../operational-acceptance-port.js';
import { captureNeutralClientRiyaRequest } from '../neutral-client-diagnostic-request.js';

const utf8Bytes = (value: string): number => Buffer.byteLength(value, 'utf8');
const digest = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);

interface MessageSurface {
  readonly messageCount: number;
  readonly roleSequence: readonly string[];
  readonly perMessageBytes: readonly number[];
  readonly totalMessageBytes: number;
}

function surfaceOf(messages: readonly CanaryMessage[]): MessageSurface {
  return {
    messageCount: messages.length,
    roleSequence: messages.map((one) => one.role),
    perMessageBytes: messages.map((one) => utf8Bytes(one.content)),
    totalMessageBytes: messages.reduce((sum, one) => sum + utf8Bytes(one.content), 0),
  };
}

let captured: CapturedProductionRiyaRequest;
let projectedSchemaJson: string;

beforeAll(async () => {
  captured = await captureNeutralClientRiyaRequest();
  const projection = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
  if (!projection.ok) {
    throw new Error('the production schema must project');
  }
  projectedSchemaJson = JSON.stringify(projection.schema);
});

describe('HELD CONSTANT — the accepted control and the rejected path agree here', () => {
  it('both carry the SAME projected schema, by digest and by length', () => {
    // O2 and the neutral probe are built from ONE projected object. If a future change gave them
    // different schemas, the whole differential would be measuring two variables instead of one.
    const reprojected = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
    expect(reprojected.ok).toBe(true);
    if (!reprojected.ok) {
      return;
    }
    expect(digest(JSON.stringify(reprojected.schema))).toBe(digest(projectedSchemaJson));
    // Pinned so a schema that silently grew or shrank fails here rather than at a provider.
    expect(utf8Bytes(projectedSchemaJson)).toBe(1951);
  });

  it('the model, output budget and capability ceiling did not move', () => {
    expect(CANDIDATE_MODEL_ID).toBe('openai/gpt-oss-20b');
    expect(OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET).toBe(RIYA_COMPLETION_BUDGET_TOKENS);
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBe(4096);
    expect(CANDIDATE_MAX_COMPLETION_TOKENS).toBe(65_536);
    // The budget and the ceiling are DIFFERENT numbers, and conflating them was the S11 defect.
    expect(RIYA_COMPLETION_BUDGET_TOKENS).not.toBe(CANDIDATE_MAX_COMPLETION_TOKENS);
  });

  it('the captured request carries the production timeout and a ZERO retry budget', () => {
    expect(captured.timeoutMs).toBe(30_000);
    expect(captured.retryBudget).toBe(0);
  });

  it('BOTH surfaces are two messages in the SAME role order', () => {
    // The structural fields that are identical. Whatever separates accepted from rejected, it is
    // not the message count and not the role sequence.
    const accepted = surfaceOf(SYNTHETIC_CANARY_MESSAGES);
    const rejected = surfaceOf(captured.messages);
    expect(accepted.messageCount).toBe(2);
    expect(rejected.messageCount).toBe(2);
    expect([...accepted.roleSequence]).toStrictEqual(['system', 'user']);
    expect([...rejected.roleSequence]).toStrictEqual([...accepted.roleSequence]);
  });
});

describe('THE DIFFERENCE — message content volume, and nothing else structural', () => {
  it('the production surface is ~72x the accepted control, dominated by the system message', () => {
    const accepted = surfaceOf(SYNTHETIC_CANARY_MESSAGES);
    const rejected = surfaceOf(captured.messages);

    // Bounds rather than exact equality: the prompt is allowed to be revised, but a change of ORDER
    // OF MAGNITUDE is a different experiment and should fail here.
    expect(accepted.totalMessageBytes).toBeLessThan(500);
    expect(rejected.totalMessageBytes).toBeGreaterThan(5_000);
    expect(rejected.totalMessageBytes).toBeLessThan(20_000);

    // The system message is where the volume is: the user turns are within one order of magnitude
    // of each other, the system messages are not.
    const acceptedSystem = accepted.perMessageBytes[0] ?? 0;
    const rejectedSystem = rejected.perMessageBytes[0] ?? 0;
    expect(rejectedSystem / Math.max(1, acceptedSystem)).toBeGreaterThan(20);
    expect(rejectedSystem / rejected.totalMessageBytes).toBeGreaterThan(0.9);
  });

  it('the two surfaces are genuinely different content, not the same bytes twice', () => {
    const acceptedDigest = digest(JSON.stringify(SYNTHETIC_CANARY_MESSAGES.map((m) => m.content)));
    const rejectedDigest = digest(JSON.stringify(captured.messages.map((m) => m.content)));
    expect(rejectedDigest).not.toBe(acceptedDigest);
  });
});

describe('THE OFFLINE VARIANT LADDER — request shapes only, nothing is sent', () => {
  /**
   * Four variants over ONE axis: which side of the message pair carries production content.
   *
   * They exist to define a future one-variable experiment, not to predict its result. Constructing a
   * variant proves it is well-formed locally and says NOTHING about how a provider would answer it.
   */
  const ladder = (): readonly {
    readonly id: string;
    readonly messages: readonly CanaryMessage[];
  }[] => {
    const syntheticSystem = SYNTHETIC_CANARY_MESSAGES[0];
    const syntheticUser = SYNTHETIC_CANARY_MESSAGES[1];
    const productionSystem = captured.messages[0];
    const productionUser = captured.messages[1];
    if (
      syntheticSystem === undefined ||
      syntheticUser === undefined ||
      productionSystem === undefined ||
      productionUser === undefined
    ) {
      throw new Error('both surfaces must carry a system and a user message');
    }
    return [
      { id: 'V0_SYNTHETIC_SYSTEM_SYNTHETIC_USER', messages: [syntheticSystem, syntheticUser] },
      { id: 'V1_PRODUCTION_SYSTEM_SYNTHETIC_USER', messages: [productionSystem, syntheticUser] },
      { id: 'V2_SYNTHETIC_SYSTEM_PRODUCTION_USER', messages: [syntheticSystem, productionUser] },
      { id: 'V3_PRODUCTION_SYSTEM_PRODUCTION_USER', messages: [productionSystem, productionUser] },
    ];
  };

  it('every variant is two messages in the governed role order', () => {
    for (const variant of ladder()) {
      const surface = surfaceOf(variant.messages);
      expect(surface.messageCount, variant.id).toBe(2);
      expect([...surface.roleSequence], variant.id).toStrictEqual(['system', 'user']);
    }
  });

  it('the ladder is MONOTONIC in total bytes, so one axis moves at a time', () => {
    // V0 < V2 < V1 < V3 is the property that makes this a ladder rather than four unrelated shapes:
    // swapping the user turn moves the total a little, swapping the system message moves it a lot.
    const byId = new Map(
      ladder().map((one) => [one.id, surfaceOf(one.messages).totalMessageBytes]),
    );
    const v0 = byId.get('V0_SYNTHETIC_SYSTEM_SYNTHETIC_USER') ?? 0;
    const v1 = byId.get('V1_PRODUCTION_SYSTEM_SYNTHETIC_USER') ?? 0;
    const v2 = byId.get('V2_SYNTHETIC_SYSTEM_PRODUCTION_USER') ?? 0;
    const v3 = byId.get('V3_PRODUCTION_SYSTEM_PRODUCTION_USER') ?? 0;
    expect(v0).toBeLessThan(v2);
    expect(v2).toBeLessThan(v1);
    expect(v1).toBeLessThan(v3);
  });

  it('V0 and V3 are exactly the accepted control and the rejected production surface', () => {
    // The ladder's endpoints must BE the two historical requests, or it interpolates between
    // something else. Asserted by digest so no content is written into the spec.
    const found = new Map(ladder().map((one) => [one.id, one.messages]));
    const v0 = found.get('V0_SYNTHETIC_SYSTEM_SYNTHETIC_USER') ?? [];
    const v3 = found.get('V3_PRODUCTION_SYSTEM_PRODUCTION_USER') ?? [];
    expect(digest(JSON.stringify(v0.map((m) => m.content)))).toBe(
      digest(JSON.stringify(SYNTHETIC_CANARY_MESSAGES.map((m) => m.content))),
    );
    expect(digest(JSON.stringify(v3.map((m) => m.content)))).toBe(
      digest(JSON.stringify(captured.messages.map((m) => m.content))),
    );
  });

  it('constructing a variant reaches no provider and asserts no provider outcome', () => {
    // Stated as a test so the boundary is explicit: this describes SHAPES. The words "accepted" and
    // "rejected" above name what HISTORICALLY happened to two of them, never a prediction for the
    // two that have never been sent.
    for (const variant of ladder()) {
      expect(variant.messages.every((one) => typeof one.content === 'string')).toBe(true);
    }
  });
});
