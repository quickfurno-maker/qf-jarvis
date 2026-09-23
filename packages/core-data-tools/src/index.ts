import {
  parseCoreRiyaIntakeStateV1,
  parseCoreRiyaIntakeSubmissionLookupV1,
} from '@qf-jarvis/core-riya-intake';
import type {
  CoreRiyaIntakePort,
  CoreRiyaIntakeStateV1,
  CoreRiyaIntakeSubmissionLookupV1,
} from '@qf-jarvis/core-riya-intake';
import { parseCoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import type {
  CoreServiceAvailabilityReader,
  CoreServiceAvailabilitySnapshotV1,
} from '@qf-jarvis/core-service-availability-read';

const REF = /^[A-Za-z0-9._:-]{1,128}$/u;

export const CORE_DATA_TOOL_IDS = Object.freeze([
  'CORE_SERVICE_AVAILABILITY_READ',
  'CORE_RIYA_INTAKE_STATE_READ',
  'CORE_RIYA_SUBMISSION_LOOKUP',
] as const);

export type CoreDataToolId = (typeof CORE_DATA_TOOL_IDS)[number];

export interface CoreDataToolContext {
  readonly tenantId: string;
  readonly conversationId?: string;
  readonly subjectRef?: string;
  readonly idempotencyKey?: string;
}

export interface CoreDataToolDescriptor {
  readonly toolId: CoreDataToolId;
  readonly authority: 'QUICKFURNO_CORE';
  readonly effect: 'READ_ONLY';
  readonly resultTrust: 'CANONICAL_PARSED';
  readonly parserRef: string;
}

export type CoreDataToolResult =
  CoreServiceAvailabilitySnapshotV1 | CoreRiyaIntakeStateV1 | CoreRiyaIntakeSubmissionLookupV1;

export interface CoreDataToolInvocation {
  readonly descriptor: CoreDataToolDescriptor;
  readonly result: CoreDataToolResult;
}

export interface CoreDataTools {
  readonly descriptors: readonly CoreDataToolDescriptor[];
  invoke(toolId: CoreDataToolId, context: CoreDataToolContext): Promise<CoreDataToolInvocation>;
}

const availabilityDescriptor: CoreDataToolDescriptor = Object.freeze({
  toolId: 'CORE_SERVICE_AVAILABILITY_READ',
  authority: 'QUICKFURNO_CORE',
  effect: 'READ_ONLY',
  resultTrust: 'CANONICAL_PARSED',
  parserRef: 'parseCoreServiceAvailabilitySnapshotV1',
});

const intakeStateDescriptor: CoreDataToolDescriptor = Object.freeze({
  toolId: 'CORE_RIYA_INTAKE_STATE_READ',
  authority: 'QUICKFURNO_CORE',
  effect: 'READ_ONLY',
  resultTrust: 'CANONICAL_PARSED',
  parserRef: 'parseCoreRiyaIntakeStateV1',
});

const submissionLookupDescriptor: CoreDataToolDescriptor = Object.freeze({
  toolId: 'CORE_RIYA_SUBMISSION_LOOKUP',
  authority: 'QUICKFURNO_CORE',
  effect: 'READ_ONLY',
  resultTrust: 'CANONICAL_PARSED',
  parserRef: 'parseCoreRiyaIntakeSubmissionLookupV1',
});

const descriptors = Object.freeze([
  availabilityDescriptor,
  intakeStateDescriptor,
  submissionLookupDescriptor,
]);

function requiredRef(value: string | undefined, code: string): string {
  if (value === undefined || !REF.test(value)) throw new TypeError(code);
  return value;
}

/**
 * Compose read-only Core tools from already-governed ports.
 *
 * No adapter is invented here: network/auth/endpoint choices remain owned by the integration slice.
 * The mutating intake submit operation is intentionally not exposed. Every boundary result is
 * re-proved by its canonical parser before it leaves the registry.
 */
export function createCoreDataTools(input: {
  readonly availabilityReader: CoreServiceAvailabilityReader;
  readonly riyaIntakePort: CoreRiyaIntakePort;
}): CoreDataTools {
  return Object.freeze({
    descriptors,
    async invoke(
      toolId: CoreDataToolId,
      context: CoreDataToolContext,
    ): Promise<CoreDataToolInvocation> {
      const tenantId = requiredRef(context.tenantId, 'core-data-tool-tenant-invalid');

      if (toolId === 'CORE_SERVICE_AVAILABILITY_READ') {
        const raw = await input.availabilityReader.readCurrent({ tenantId });
        return Object.freeze({
          descriptor: availabilityDescriptor,
          result: parseCoreServiceAvailabilitySnapshotV1(raw),
        });
      }

      const conversationId = requiredRef(
        context.conversationId,
        'core-data-tool-conversation-required',
      );

      if (toolId === 'CORE_RIYA_INTAKE_STATE_READ') {
        const subjectRef = requiredRef(context.subjectRef, 'core-data-tool-subject-required');
        const raw = await input.riyaIntakePort.readCurrent({
          tenantId,
          conversationId,
          subjectRef,
        });
        return Object.freeze({
          descriptor: intakeStateDescriptor,
          result: parseCoreRiyaIntakeStateV1(raw),
        });
      }

      const idempotencyKey = requiredRef(
        context.idempotencyKey,
        'core-data-tool-idempotency-required',
      );
      const raw = await input.riyaIntakePort.lookupSubmission({
        tenantId,
        conversationId,
        idempotencyKey,
      });
      return Object.freeze({
        descriptor: submissionLookupDescriptor,
        result: parseCoreRiyaIntakeSubmissionLookupV1(raw),
      });
    },
  });
}
