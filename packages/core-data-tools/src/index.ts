import type { CoreRiyaIntakePort } from '@qf-jarvis/core-riya-intake';
import type { CoreServiceAvailabilityReader } from '@qf-jarvis/core-service-availability-read';

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
  readonly resultTrust: 'UNTRUSTED_UNTIL_PARSED';
  readonly parserRef: string;
}

export interface CoreDataToolInvocation {
  readonly descriptor: CoreDataToolDescriptor;
  readonly rawResult: unknown;
}

export interface CoreDataTools {
  readonly descriptors: readonly CoreDataToolDescriptor[];
  invoke(toolId: CoreDataToolId, context: CoreDataToolContext): Promise<CoreDataToolInvocation>;
}

const descriptors = Object.freeze([
  Object.freeze({
    toolId: 'CORE_SERVICE_AVAILABILITY_READ' as const,
    authority: 'QUICKFURNO_CORE' as const,
    effect: 'READ_ONLY' as const,
    resultTrust: 'UNTRUSTED_UNTIL_PARSED' as const,
    parserRef: 'parseCoreServiceAvailabilitySnapshotV1',
  }),
  Object.freeze({
    toolId: 'CORE_RIYA_INTAKE_STATE_READ' as const,
    authority: 'QUICKFURNO_CORE' as const,
    effect: 'READ_ONLY' as const,
    resultTrust: 'UNTRUSTED_UNTIL_PARSED' as const,
    parserRef: 'parseCoreRiyaIntakeStateV1',
  }),
  Object.freeze({
    toolId: 'CORE_RIYA_SUBMISSION_LOOKUP' as const,
    authority: 'QUICKFURNO_CORE' as const,
    effect: 'READ_ONLY' as const,
    resultTrust: 'UNTRUSTED_UNTIL_PARSED' as const,
    parserRef: 'parseCoreRiyaIntakeSubmissionResultV1',
  }),
]);

function requiredRef(value: string | undefined, code: string): string {
  if (value === undefined || !REF.test(value)) throw new TypeError(code);
  return value;
}

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
        return Object.freeze({
          descriptor: descriptors[0],
          rawResult: await input.availabilityReader.readCurrent({ tenantId }),
        });
      }

      const conversationId = requiredRef(
        context.conversationId,
        'core-data-tool-conversation-required',
      );

      if (toolId === 'CORE_RIYA_INTAKE_STATE_READ') {
        const subjectRef = requiredRef(context.subjectRef, 'core-data-tool-subject-required');
        return Object.freeze({
          descriptor: descriptors[1],
          rawResult: await input.riyaIntakePort.readCurrent({
            tenantId,
            conversationId,
            subjectRef,
          }),
        });
      }

      const idempotencyKey = requiredRef(
        context.idempotencyKey,
        'core-data-tool-idempotency-required',
      );
      return Object.freeze({
        descriptor: descriptors[2],
        rawResult: await input.riyaIntakePort.lookupSubmission({
          tenantId,
          conversationId,
          idempotencyKey,
        }),
      });
    },
  });
}
