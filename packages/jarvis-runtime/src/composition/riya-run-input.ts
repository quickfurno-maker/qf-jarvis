/**
 * Re-proving the three inputs every Riya-aware runtime method takes (RWC-P4B; RWC-P7, ADR-0103).
 *
 * Extracted when RWC-P7 added a second Riya method rather than copied into it. The checks below are
 * the ones that decide whether a model call may happen at all — a canonical envelope, a canonical
 * continuity, a canonical Core availability snapshot, and the same conversation in all three — and
 * two copies of that would not diverge on the day they were written; they would diverge on the day
 * one was corrected.
 *
 * Nothing here restates a schema. Each value goes through its own canonical constructor, so an extra
 * key, a malformed identifier, an unknown channel, a non-canonical instant, a half-applied store row
 * or a snapshot with duplicate references is refused HERE, before the gateway.
 */
import { createInboundEnvelope } from '@qf-jarvis/agent-runtime';
import type { InboundEnvelope, InboundEnvelopeInput } from '@qf-jarvis/agent-runtime';
import { parseCoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

/** A proved run input, or the identity to report a refusal under. */
export type ProvenRiyaRunInput =
  | {
      readonly ok: true;
      readonly envelope: InboundEnvelope;
      readonly current: RiyaConversationContinuityStateV1;
      readonly availabilitySnapshot: CoreServiceAvailabilitySnapshotV1;
    }
  | { readonly ok: false; readonly runId: string; readonly conversationId: string };

/**
 * Prove one Riya run input.
 *
 * Typed `unknown` at the boundary. The declared parameter promises three values, but this is a
 * package boundary: an untyped caller, or one that built the input from JSON, can hand over anything
 * — including an array, which `typeof` reports as an object.
 */
export function provenRiyaRunInput(input: unknown): ProvenRiyaRunInput {
  // Until canonicalization succeeds there is no identity worth reporting, so a refusal carries
  // content-free empty placeholders -- which are still STRINGS, as the public result types promise.
  const nothing = { ok: false as const, runId: '', conversationId: '' };

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return nothing;
  }
  const candidate = input as {
    readonly envelope?: unknown;
    readonly continuity?: unknown;
    readonly availabilitySnapshot?: unknown;
  };
  const envelopeValue = candidate.envelope;
  const continuityValue = candidate.continuity;
  if (
    typeof envelopeValue !== 'object' ||
    envelopeValue === null ||
    Array.isArray(envelopeValue) ||
    typeof continuityValue !== 'object' ||
    continuityValue === null
  ) {
    return nothing;
  }

  // The ENVELOPE, through its own canonical constructor. `{ envelope: {} }` would otherwise be cast
  // to `InboundEnvelope` and every field read off it -- including the identifiers a refusal reports
  // -- would be `undefined` at runtime.
  let envelope: InboundEnvelope;
  try {
    envelope = createInboundEnvelope(envelopeValue as InboundEnvelopeInput);
  } catch {
    return nothing;
  }
  const failed = {
    ok: false as const,
    runId: envelope.runtimeId,
    conversationId: envelope.conversationId,
  };
  const continuity = continuityValue as RiyaConversationContinuityStateV1;

  // The SNAPSHOT. It crossed a boundary from a system this repository does not compile, through a
  // port with no implementation here; its declared type is a claim about a shape, not evidence of one.
  let availabilitySnapshot: CoreServiceAvailabilitySnapshotV1;
  try {
    availabilitySnapshot = parseCoreServiceAvailabilitySnapshotV1(candidate.availabilitySnapshot);
  } catch {
    return failed;
  }

  // The CONTINUITY. A hand-assembled state, or a half-applied row a store returned, must not become
  // the context one model call reasons from.
  let current: RiyaConversationContinuityStateV1;
  try {
    current = createRiyaConversationContinuityState({
      version: 1,
      tenantId: continuity.tenantId,
      conversationId: continuity.conversationId,
      continuityRevision: continuity.continuityRevision,
      phase: continuity.phase,
      discovery: {
        ...(continuity.discovery.serviceInterestRef === undefined
          ? {}
          : { serviceInterestRef: continuity.discovery.serviceInterestRef }),
        ...(continuity.discovery.locationRef === undefined
          ? {}
          : { locationRef: continuity.discovery.locationRef }),
        ...(continuity.discovery.propertyTypeRef === undefined
          ? {}
          : { propertyTypeRef: continuity.discovery.propertyTypeRef }),
        ...(continuity.discovery.scopeSummary === undefined
          ? {}
          : { scopeSummary: continuity.discovery.scopeSummary }),
        ...(continuity.discovery.budgetNote === undefined
          ? {}
          : { budgetNote: continuity.discovery.budgetNote }),
        ...(continuity.discovery.timelineNote === undefined
          ? {}
          : { timelineNote: continuity.discovery.timelineNote }),
        ...(continuity.discovery.consultationPreferenceRef === undefined
          ? {}
          : { consultationPreferenceRef: continuity.discovery.consultationPreferenceRef }),
        completeness: continuity.discovery.completeness,
        ...(continuity.discovery.missingFields.length === 0
          ? {}
          : { missingFields: [...continuity.discovery.missingFields] }),
      },
      fieldProvenance: continuity.fieldProvenance,
      summaryConfirmed: continuity.summaryConfirmed,
      ...(continuity.completionEvidenceRef === undefined
        ? {}
        : { completionEvidenceRef: continuity.completionEvidenceRef }),
    });
  } catch {
    return failed;
  }

  // The state and the envelope must be about the SAME conversation. A mismatch is a wiring error,
  // not two conversations to serve, and it is never normalized.
  if (
    current.tenantId !== envelope.tenantId ||
    current.conversationId !== envelope.conversationId
  ) {
    return failed;
  }

  return { ok: true, envelope, current, availabilitySnapshot };
}
