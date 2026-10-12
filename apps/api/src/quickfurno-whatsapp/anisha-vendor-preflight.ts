import type { QuickFurnoWhatsAppTurnMaterialV2 } from './contracts.js';

/**
 * Defense-in-depth before an Anisha model call.
 *
 * QuickFurno Core is still the source of all authority. This guard cannot
 * authenticate a WhatsApp number or make a vendor eligible; it only refuses
 * contradictory/incomplete already-signed Core turn material before tokens
 * are spent. The generic Jarvis runtime then re-reads fresh Core authority.
 */
const CORE_SUBJECT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AnishaWhatsAppPreflightCode =
  | 'ANISHA_TURN_READY'
  | 'ANISHA_WRONG_ACTOR_OR_SUBJECT'
  | 'ANISHA_VENDOR_IDENTITY_UNBOUND'
  | 'ANISHA_CONVERSATION_INACTIVE'
  | 'ANISHA_CORE_AUTHORITY_BLOCKED'
  | 'ANISHA_PRIVACY_OR_ERASURE_BLOCKED'
  | 'ANISHA_HOSTED_TEXT_UNAVAILABLE';

/** No personal content, phone or provider data in the result. */
export function assessAnishaWhatsAppPreflight(
  material: QuickFurnoWhatsAppTurnMaterialV2,
): AnishaWhatsAppPreflightCode {
  if (
    material.assignedActor !== 'ANISHA' ||
    material.subjectType !== 'vendor' ||
    material.partyType !== 'VENDOR'
  )
    return 'ANISHA_WRONG_ACTOR_OR_SUBJECT';

  if (typeof material.subjectRef !== 'string' || !CORE_SUBJECT_ID.test(material.subjectRef)) {
    return 'ANISHA_VENDOR_IDENTITY_UNBOUND';
  }

  if (material.conversationState !== 'OPEN') return 'ANISHA_CONVERSATION_INACTIVE';

  if (!material.jarvisAllowed || material.humanTakeover || material.aiPaused || material.cancelled)
    return 'ANISHA_CORE_AUTHORITY_BLOCKED';

  if (material.subjectStatus !== 'clear') return 'ANISHA_PRIVACY_OR_ERASURE_BLOCKED';

  if (
    material.dataClass !== 'HOSTED_ALLOWED' ||
    typeof material.normalizedText !== 'string' ||
    material.normalizedText.trim().length === 0
  )
    return 'ANISHA_HOSTED_TEXT_UNAVAILABLE';

  return 'ANISHA_TURN_READY';
}

/** Channel-neutral alias for the pure Core context reader. */
export { assessAnishaWhatsAppPreflight as assessAnishaCorePreflight };
