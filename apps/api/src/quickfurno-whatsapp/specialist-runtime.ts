import { createInboundEnvelope } from '@qf-jarvis/agent-runtime';
import type {
  ProposedReplyJarvisRuntime,
  RiyaConversationEvolutionJarvisRuntime,
} from '@qf-jarvis/jarvis-runtime';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import { composeConversationAwareInput } from '@qf-jarvis/semantic-context-engine';
import { runCustomerTurnWorkflow } from '../riya-customer-orchestration/mastra-customer-turn-runner.js';
import type {
  QuickFurnoLeadQualificationMaterialV1,
  QuickFurnoQualificationProposal,
  QuickFurnoWhatsAppAgent,
  QuickFurnoWhatsAppConversationContextV1,
  QuickFurnoWhatsAppReplyProposal,
  QuickFurnoWhatsAppTurnMaterialV2,
  QuickFurnoWhatsAppWorkerMaterial,
  QuickFurnoWhatsAppWorkerProposal,
} from './contracts.js';
import type { ServiceBlueprintRegistry } from '@qf-jarvis/client-intelligence';
import { buildWhatsAppClientIntelligence } from './client-intelligence-adapter.js';

export interface QuickFurnoWhatsAppSpecialistRuntime {
  process(
    material: QuickFurnoWhatsAppWorkerMaterial,
    conversationContext?: QuickFurnoWhatsAppConversationContextV1,
  ): Promise<QuickFurnoWhatsAppWorkerProposal | null>;
}

type WhatsAppJarvisRuntime = ProposedReplyJarvisRuntime &
  Partial<
    Pick<RiyaConversationEvolutionJarvisRuntime, 'processInboundForRiyaConversationEvolution'>
  >;

export interface QuickFurnoWhatsAppSpecialistRuntimeConfig {
  readonly runtimeId: string;
  readonly jarvisRuntime: WhatsAppJarvisRuntime;
  /** Optional CI-05 registry. Absence preserves the current no-opportunity production behavior. */
  readonly serviceBlueprintRegistry?: ServiceBlueprintRegistry;
}

function isQualificationMaterial(
  material: QuickFurnoWhatsAppWorkerMaterial,
): material is QuickFurnoLeadQualificationMaterialV1 {
  return 'purpose' in material;
}

const expectedSubjectByActor: Readonly<
  Record<QuickFurnoWhatsAppAgent, QuickFurnoWhatsAppTurnMaterialV2['subjectType']>
> = Object.freeze({ RIYA: 'client', ANISHA: 'vendor', AAROHI: 'prospect' });

function riyaContinuityFromMaterial(material: QuickFurnoWhatsAppTurnMaterialV2) {
  const journey = material.clientJourney;
  if (journey === undefined || material.coreAvailability === undefined) return null;
  const requirement = journey.activeRequirement;
  const requiredMissing = [
    ...(requirement.serviceInterest === undefined ? (['serviceInterest'] as const) : []),
    ...(requirement.location === undefined ? (['location'] as const) : []),
    ...(requirement.budget === undefined ? (['budget'] as const) : []),
    ...(requirement.timeline === undefined ? (['timeline'] as const) : []),
  ];
  try {
    return createRiyaConversationContinuityState({
      version: 1,
      tenantId: material.tenantId,
      conversationId: material.conversationId,
      continuityRevision: requirement.revision,
      phase: requirement.phase,
      discovery: {
        ...(requirement.serviceInterest === undefined
          ? {}
          : { serviceInterestRef: requirement.serviceInterest }),
        ...(requirement.location === undefined ? {} : { locationRef: requirement.location }),
        ...(requirement.propertyType === undefined
          ? {}
          : { propertyTypeRef: requirement.propertyType }),
        ...(requirement.scope === undefined ? {} : { scopeSummary: requirement.scope }),
        ...(requirement.budget === undefined ? {} : { budgetNote: requirement.budget }),
        ...(requirement.timeline === undefined ? {} : { timelineNote: requirement.timeline }),
        ...(requirement.consultationPreference === undefined
          ? {}
          : { consultationPreferenceRef: requirement.consultationPreference }),
        completeness:
          requiredMissing.length === 0 ? 'SUFFICIENT_FOR_CORE_REVIEW' : 'MORE_DISCOVERY_REQUIRED',
        ...(requiredMissing.length === 0 ? {} : { missingFields: requiredMissing }),
      },
      fieldProvenance: requirement.provenance,
      summaryConfirmed: requirement.summaryConfirmed,
    });
  } catch {
    return null;
  }
}

function riyaLifetimeContextFromMaterial(material: QuickFurnoWhatsAppTurnMaterialV2) {
  const journey = material.clientJourney;
  if (journey === undefined || journey.version !== 2) return undefined;

  const properties = [...journey.properties]
    .sort((left, right) => {
      if (left.relation === right.relation) return 0;
      return left.relation === 'current' ? -1 : 1;
    })
    .slice(0, 3)
    .map((property) =>
      Object.freeze({
        relation: property.relation,
        ...(property.area === undefined ? {} : { area: property.area }),
        ...(property.propertyType === undefined ? {} : { propertyType: property.propertyType }),
        ...(property.bhk === undefined ? {} : { bhk: property.bhk }),
        ...(property.projectStage === undefined ? {} : { projectStage: property.projectStage }),
      }),
    );

  const seenServices = new Set<string>();
  const pastServices = [];
  for (const requirement of journey.pastRequirements) {
    if (seenServices.has(requirement.categoryRef)) continue;
    seenServices.add(requirement.categoryRef);
    pastServices.push(
      Object.freeze({
        serviceRef: requirement.categoryRef,
        status: requirement.status,
      }),
    );
    if (pastServices.length >= 6) break;
  }

  return Object.freeze({
    version: 1 as const,
    authority: 'QUICKFURNO_CORE_CONTEXT' as const,
    isReturningClient: journey.isReturningClient,
    lastSeenAt: journey.lastSeenAt,
    properties: Object.freeze(properties),
    pastServices: Object.freeze(pastServices),
  });
}

function riyaConversationProposal(
  material: QuickFurnoWhatsAppTurnMaterialV2,
  current: NonNullable<ReturnType<typeof riyaContinuityFromMaterial>>,
  result: Awaited<
    ReturnType<
      NonNullable<
        RiyaConversationEvolutionJarvisRuntime['processInboundForRiyaConversationEvolution']
      >
    >
  >,
): QuickFurnoWhatsAppReplyProposal | null {
  const proposal = result.proposedReply;
  if (proposal === undefined || proposal.boundRevision !== material.revision) return null;
  if (proposal.replyBody.length < 1 || proposal.replyBody.length > 4096) return null;

  let journeyProposal: QuickFurnoWhatsAppReplyProposal['clientJourneyProposal'];
  if (result.observationBatch !== undefined || result.clientProfileObservation !== undefined) {
    let next;
    try {
      next =
        result.observationBatch === undefined
          ? { state: current }
          : evolveRiyaConversation({ current, batch: result.observationBatch });
    } catch {
      return null;
    }
    const batch = result.observationBatch;
    journeyProposal = Object.freeze({
      version: 1 as const,
      profileId: material.clientJourney!.profileId,
      profileRevision: material.clientJourney!.profileRevision,
      requirementId: material.clientJourney!.activeRequirement.requirementId,
      requirementRevision: material.clientJourney!.activeRequirement.revision,
      nextPhase: next.state.phase,
      summaryConfirmed: next.state.summaryConfirmed,
      ...(result.clientProfileObservation === undefined
        ? {}
        : {
            name: Object.freeze({
              value: result.clientProfileObservation.name,
              provenance: 'user_stated' as const,
            }),
          }),
      sets: Object.freeze(
        (batch?.observations ?? [])
          .filter((observation) => observation.operation === 'SET')
          .map((observation) =>
            Object.freeze({
              field: observation.field,
              value: observation.value!,
              provenance: observation.provenance as 'user_stated' | 'model_inferred',
            }),
          ),
      ),
      clears: Object.freeze(
        (batch?.observations ?? [])
          .filter((observation) => observation.operation === 'CLEAR')
          .map((observation) =>
            Object.freeze({
              field: observation.field,
              provenance: 'user_stated' as const,
            }),
          ),
      ),
    });
  }

  return Object.freeze({
    actor: 'RIYA' as const,
    proposalId: proposal.proposalId,
    boundRevision: proposal.boundRevision,
    body: proposal.replyBody,
    ...(journeyProposal === undefined ? {} : { clientJourneyProposal: journeyProposal }),
  });
}

function conversationProposal(
  material: QuickFurnoWhatsAppTurnMaterialV2,
  proposal:
    | {
        readonly proposalId: string;
        readonly boundRevision: number;
        readonly replyBody: string;
      }
    | undefined,
): QuickFurnoWhatsAppReplyProposal | null {
  if (proposal === undefined) return null;
  if (proposal.boundRevision !== material.revision) return null;
  if (proposal.replyBody.length < 1 || proposal.replyBody.length > 4096) return null;
  return Object.freeze({
    actor: material.assignedActor,
    proposalId: proposal.proposalId,
    boundRevision: proposal.boundRevision,
    body: proposal.replyBody,
  });
}

function qualificationResult(
  material: QuickFurnoLeadQualificationMaterialV1,
  proposal:
    | {
        readonly proposalId: string;
        readonly boundRevision: number;
        readonly replyBody: string;
      }
    | undefined,
): QuickFurnoQualificationProposal {
  const candidate =
    proposal?.boundRevision === material.revision ? proposal.replyBody.trim() : null;
  const exact =
    candidate !== null && material.qualification.allowedOptions.includes(candidate)
      ? candidate
      : null;
  return Object.freeze({
    actor: 'RIYA',
    proposalId:
      proposal?.proposalId ??
      `riya-qualification:${material.qualification.requestId}:${material.inboundMessageId}`,
    boundRevision: material.revision,
    qualificationRequestId: material.qualification.requestId,
    inboundMessageId: material.inboundMessageId,
    target: material.qualification.target,
    outcome: exact === null ? 'no_match' : 'matched',
    ...(exact === null ? {} : { value: exact }),
  });
}

function qualificationPrompt(material: QuickFurnoLeadQualificationMaterialV1): string {
  return [
    'QuickFurno qualification interpretation.',
    `Question: ${material.qualification.questionText}`,
    `Client answer: ${material.qualification.answerText}`,
    `Allowed options: ${material.qualification.allowedOptions.join(' | ')}`,
    'Return EXACTLY one allowed option only when the client explicitly supports it.',
    'Otherwise return exactly __NO_MATCH__.',
    'Do not explain, infer, recommend, or add punctuation.',
  ].join('\n');
}

export function createQuickFurnoWhatsAppSpecialistRuntime(
  config: QuickFurnoWhatsAppSpecialistRuntimeConfig,
): QuickFurnoWhatsAppSpecialistRuntime {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(config.runtimeId)) {
    throw new TypeError('quickfurno-whatsapp-runtime-id-invalid');
  }

  return Object.freeze({
    async process(
      material: QuickFurnoWhatsAppWorkerMaterial,
      conversationContext?: QuickFurnoWhatsAppConversationContextV1,
    ) {
      if (isQualificationMaterial(material)) {
        const envelope = createInboundEnvelope({
          runtimeId: config.runtimeId,
          conversationId: material.conversationId,
          messageId: material.inboundMessageId,
          tenantId: material.tenantId,
          channel: 'WHATSAPP',
          partyType: 'CLIENT',
          direction: 'INBOUND',
          receivedAt: material.receivedAt,
          providerMessageRef: `qf.qualification:${material.inboundMessageId}`,
          dataClass: material.dataClass,
          normalizedText: qualificationPrompt(material),
        });
        try {
          const result = await runCustomerTurnWorkflow(
            () => config.jarvisRuntime.processInboundForProposedReply(envelope),
            'WHATSAPP',
            {},
          );
          return qualificationResult(material, result.proposedReply);
        } catch {
          // Qualification never retries the model after execution uncertainty.
          // Core receives no_match and deterministically re-asks the exact question.
          return qualificationResult(material, undefined);
        }
      }

      if (expectedSubjectByActor[material.assignedActor] !== material.subjectType) return null;
      if (material.dataClass !== 'HOSTED_ALLOWED' || material.normalizedText === undefined)
        return null;

      const envelope = createInboundEnvelope({
        runtimeId: config.runtimeId,
        conversationId: material.conversationId,
        messageId: material.inboundMessageId,
        tenantId: material.tenantId,
        channel: 'WHATSAPP',
        partyType:
          material.assignedActor === 'RIYA'
            ? 'CLIENT'
            : material.assignedActor === 'ANISHA'
              ? 'VENDOR'
              : 'PROSPECT',
        direction: 'INBOUND',
        receivedAt: material.receivedAt,
        providerMessageRef: `qf.inbound:${material.inboundMessageId}`,
        dataClass: material.dataClass,
        ...(material.subjectRef === undefined ? {} : { subjectRef: material.subjectRef }),
        normalizedText:
          material.assignedActor === 'RIYA' && material.clientJourney !== undefined
            ? material.normalizedText
            : conversationContext === undefined
              ? material.normalizedText
              : composeConversationAwareInput({
                  currentText: material.normalizedText,
                  summary: conversationContext,
                }),
      });

      if (
        material.assignedActor === 'RIYA' &&
        material.clientJourney !== undefined &&
        material.coreAvailability !== undefined
      ) {
        const processRiya = config.jarvisRuntime.processInboundForRiyaConversationEvolution;
        if (processRiya === undefined) return null;
        const continuity = riyaContinuityFromMaterial(material);
        if (continuity === null) return null;
        const profile = material.clientJourney;
        const clientLifetime = riyaLifetimeContextFromMaterial(material);
        const availabilitySnapshot = material.coreAvailability;
        const clientIntelligence = buildWhatsAppClientIntelligence(material, {
          ...(config.serviceBlueprintRegistry === undefined
            ? {}
            : { serviceBlueprintRegistry: config.serviceBlueprintRegistry }),
        });
        const result = await runCustomerTurnWorkflow(
          () =>
            processRiya({
              envelope,
              continuity,
              clientProfile: {
                version: 1,
                isFirstContact: profile.isFirstContact,
                ...(profile.name === undefined ? {} : { name: profile.name }),
                ...(profile.preferredLanguage === undefined
                  ? {}
                  : { preferredLanguage: profile.preferredLanguage }),
              },
              ...(clientIntelligence === undefined ? {} : { clientIntelligence }),
              ...(clientLifetime === undefined ? {} : { clientLifetime }),
              availabilitySnapshot,
            }),
          'WHATSAPP',
          {},
        );
        return riyaConversationProposal(material, continuity, result);
      }

      const result = await runCustomerTurnWorkflow(
        () => config.jarvisRuntime.processInboundForProposedReply(envelope),
        'WHATSAPP',
        {},
      );
      return conversationProposal(material, result.proposedReply);
    },
  });
}
