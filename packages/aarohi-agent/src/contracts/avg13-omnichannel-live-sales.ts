import { z } from 'zod';

import {
  AAROHI_SALES_BRAIN_POSTURE,
  AAROHI_SALES_CONVERSATION_INTENTS,
  AAROHI_SALES_OBJECTION_KINDS,
  buildAarohiSalesReplyBrief,
  salesReplyBriefSchema,
  type AarohiSalesBrainPosture,
  type AarohiSalesConversationIntent,
  type AarohiSalesObjectionKind,
  type AarohiSalesReplyBrief,
} from './avg7-sales-brain.js';
import {
  coreEligibilityObservationSchema,
  evaluateAcquisitionEligibility,
} from './existing-vendor-gate.js';

export const AAROHI_OMNICHANNEL_LIVE_CONTRACT_VERSION = 1 as const;
export const AAROHI_OMNICHANNEL_CHANNELS = [
  'WHATSAPP',
  'INSTAGRAM',
  'FACEBOOK',
  'X',
  'WEBSITE',
] as const;

export type AarohiOmnichannelChannel = (typeof AAROHI_OMNICHANNEL_CHANNELS)[number];

const OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const UTC = z.string().datetime({ offset: false });

export const aarohiOmnichannelTurnSchema = z
  .object({
    contractVersion: z.literal(AAROHI_OMNICHANNEL_LIVE_CONTRACT_VERSION),
    prospectRef: OPAQUE_REF,
    channel: z.enum(AAROHI_OMNICHANNEL_CHANNELS),
    channelConversationRef: OPAQUE_REF,
    channelThreadRef: OPAQUE_REF,
    channelParticipantRef: OPAQUE_REF,
    channelMessageRef: OPAQUE_REF,
    observedAt: UTC,
  })
  .strict();

export interface AarohiOmnichannelTurn {
  readonly contractVersion: 1;
  readonly prospectRef: string;
  readonly channel: AarohiOmnichannelChannel;
  readonly channelConversationRef: string;
  readonly channelThreadRef: string;
  readonly channelParticipantRef: string;
  readonly channelMessageRef: string;
  readonly observedAt: string;
}

export const aarohiOmnichannelInterpretationSchema = z
  .object({
    contractVersion: z.literal(AAROHI_OMNICHANNEL_LIVE_CONTRACT_VERSION),
    interpretationRef: OPAQUE_REF,
    prospectRef: OPAQUE_REF,
    channel: z.enum(AAROHI_OMNICHANNEL_CHANNELS),
    channelConversationRef: OPAQUE_REF,
    channelThreadRef: OPAQUE_REF,
    channelParticipantRef: OPAQUE_REF,
    channelMessageRef: OPAQUE_REF,
    intent: z.enum(AAROHI_SALES_CONVERSATION_INTENTS),
    objectionKind: z.enum(AAROHI_SALES_OBJECTION_KINDS),
    interpretedAt: UTC,
    sourcePosture: z.literal('QUICKFURNO_STRUCTURED_LIVE_INTERPRETATION'),
  })
  .strict();

export interface AarohiOmnichannelInterpretation {
  readonly contractVersion: 1;
  readonly interpretationRef: string;
  readonly prospectRef: string;
  readonly channel: AarohiOmnichannelChannel;
  readonly channelConversationRef: string;
  readonly channelThreadRef: string;
  readonly channelParticipantRef: string;
  readonly channelMessageRef: string;
  readonly intent: AarohiSalesConversationIntent;
  readonly objectionKind: AarohiSalesObjectionKind;
  readonly interpretedAt: string;
  readonly sourcePosture: 'QUICKFURNO_STRUCTURED_LIVE_INTERPRETATION';
}

export const aarohiOmnichannelPlanSchema = z
  .object({
    contractVersion: z.literal(AAROHI_OMNICHANNEL_LIVE_CONTRACT_VERSION),
    planRef: OPAQUE_REF,
    prospectRef: OPAQUE_REF,
    channel: z.enum(AAROHI_OMNICHANNEL_CHANNELS),
    channelConversationRef: OPAQUE_REF,
    channelThreadRef: OPAQUE_REF,
    channelParticipantRef: OPAQUE_REF,
    channelMessageRef: OPAQUE_REF,
    interpretationRef: OPAQUE_REF,
    coreStatus: z.literal('NOT_REGISTERED'),
    coreLookupRef: OPAQUE_REF,
    plannedAt: UTC,
    brief: salesReplyBriefSchema,
    posture: z.custom<AarohiSalesBrainPosture>((value) => value === AAROHI_SALES_BRAIN_POSTURE),
  })
  .strict();

export interface AarohiOmnichannelSalesPlan {
  readonly contractVersion: 1;
  readonly planRef: string;
  readonly prospectRef: string;
  readonly channel: AarohiOmnichannelChannel;
  readonly channelConversationRef: string;
  readonly channelThreadRef: string;
  readonly channelParticipantRef: string;
  readonly channelMessageRef: string;
  readonly interpretationRef: string;
  readonly coreStatus: 'NOT_REGISTERED';
  readonly coreLookupRef: string;
  readonly plannedAt: string;
  readonly brief: AarohiSalesReplyBrief;
  readonly posture: AarohiSalesBrainPosture;
}

export type AarohiOmnichannelSalesPlanResult =
  | { readonly ok: true; readonly plan: AarohiOmnichannelSalesPlan }
  | {
      readonly ok: false;
      readonly refusal:
        | 'INPUT_INVALID'
        | 'TURN_INVALID'
        | 'INTERPRETATION_INVALID'
        | 'BINDING_MISMATCH'
        | 'STALE_INTERPRETATION'
        | 'CORE_GATE_REFUSED'
        | 'PLAN_INVALID';
    };

export function evaluateAarohiOmnichannelSalesTurn(
  value: unknown,
): AarohiOmnichannelSalesPlanResult {
  const input = z
    .object({
      planRef: OPAQUE_REF,
      turn: z.unknown(),
      interpretation: z.unknown(),
      coreObservation: z.unknown(),
      plannedAt: UTC,
    })
    .strict()
    .safeParse(value);
  if (!input.success) {
    return Object.freeze({ ok: false as const, refusal: 'INPUT_INVALID' as const });
  }

  const turnParsed = aarohiOmnichannelTurnSchema.safeParse(input.data.turn);
  if (!turnParsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'TURN_INVALID' as const });
  }
  const interpretationParsed = aarohiOmnichannelInterpretationSchema.safeParse(
    input.data.interpretation,
  );
  if (!interpretationParsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'INTERPRETATION_INVALID' as const });
  }

  const turn = turnParsed.data;
  const interpretation = interpretationParsed.data;
  if (
    interpretation.prospectRef !== turn.prospectRef ||
    interpretation.channel !== turn.channel ||
    interpretation.channelConversationRef !== turn.channelConversationRef ||
    interpretation.channelThreadRef !== turn.channelThreadRef ||
    interpretation.channelParticipantRef !== turn.channelParticipantRef ||
    interpretation.channelMessageRef !== turn.channelMessageRef
  ) {
    return Object.freeze({ ok: false as const, refusal: 'BINDING_MISMATCH' as const });
  }

  if (
    Date.parse(interpretation.interpretedAt) < Date.parse(turn.observedAt) ||
    Date.parse(input.data.plannedAt) < Date.parse(interpretation.interpretedAt)
  ) {
    return Object.freeze({ ok: false as const, refusal: 'STALE_INTERPRETATION' as const });
  }

  const core = evaluateAcquisitionEligibility(turn.prospectRef, input.data.coreObservation);
  if (!core.eligible || core.status !== 'NOT_REGISTERED') {
    return Object.freeze({ ok: false as const, refusal: 'CORE_GATE_REFUSED' as const });
  }
  const observation = coreEligibilityObservationSchema.safeParse(input.data.coreObservation);
  if (!observation.success) {
    return Object.freeze({ ok: false as const, refusal: 'CORE_GATE_REFUSED' as const });
  }

  const plan = Object.freeze({
    contractVersion: AAROHI_OMNICHANNEL_LIVE_CONTRACT_VERSION,
    planRef: input.data.planRef,
    prospectRef: turn.prospectRef,
    channel: turn.channel,
    channelConversationRef: turn.channelConversationRef,
    channelThreadRef: turn.channelThreadRef,
    channelParticipantRef: turn.channelParticipantRef,
    channelMessageRef: turn.channelMessageRef,
    interpretationRef: interpretation.interpretationRef,
    coreStatus: 'NOT_REGISTERED' as const,
    coreLookupRef: observation.data.coreLookupRef,
    plannedAt: input.data.plannedAt,
    brief: buildAarohiSalesReplyBrief(interpretation.intent, interpretation.objectionKind),
    posture: AAROHI_SALES_BRAIN_POSTURE,
  });

  if (!aarohiOmnichannelPlanSchema.safeParse(plan).success) {
    return Object.freeze({ ok: false as const, refusal: 'PLAN_INVALID' as const });
  }
  return Object.freeze({ ok: true as const, plan });
}
