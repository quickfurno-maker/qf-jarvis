import type {
  QuickFurnoExplicitClientVendorFeedback,
  QuickFurnoWhatsAppTurnMaterialV2,
} from './contracts.js';

const ORDINAL_PATTERNS: readonly (readonly [RegExp, number])[] = [
  [/\b(?:vendor|vendors?)\s*(?:#\s*)?1\b|\b(?:first|1st)\s+vendor\b/iu, 1],
  [/\b(?:vendor|vendors?)\s*(?:#\s*)?2\b|\b(?:second|2nd)\s+vendor\b/iu, 2],
  [/\b(?:vendor|vendors?)\s*(?:#\s*)?3\b|\b(?:third|3rd)\s+vendor\b/iu, 3],
  [/\b(?:vendor|vendors?)\s*(?:#\s*)?4\b|\b(?:fourth|4th)\s+vendor\b/iu, 4],
  [/\b(?:vendor|vendors?)\s*(?:#\s*)?5\b|\b(?:fifth|5th)\s+vendor\b/iu, 5],
  [/\b(?:vendor|vendors?)\s*(?:#\s*)?6\b|\b(?:sixth|6th)\s+vendor\b/iu, 6],
];

function ordinalFrom(text: string): number | null {
  for (const [pattern, ordinal] of ORDINAL_PATTERNS) {
    if (pattern.test(text)) return ordinal;
  }
  return null;
}

export function detectExplicitClientVendorFeedback(
  raw: string | undefined,
): QuickFurnoExplicitClientVendorFeedback | null {
  const text = raw?.trim();
  if (!text || text.length > 4096) return null;
  const assignmentOrdinal = ordinalFrom(text);
  if (assignmentOrdinal === null) return null;

  const noContact =
    /\b(?:did\s*not|didn't|has\s*not|hasn't|never)\s+(?:call|contact|reach)\b|\b(?:not|no)\s+(?:called|contacted)\b|\b(?:call|contact)\s+(?:nahi|nahin)\b|\b(?:call|contact)\s+nahi\s+(?:kiya|aaya)\b/iu;
  const confirmedContact =
    /\b(?:called|contacted|reached)\s+(?:me|us)\b|\b(?:has|have)\s+(?:called|contacted|reached)\b|\b(?:call|contact)\s+(?:kiya|aaya)\b/iu;
  const complaint = /\bcomplaint\b|\bcomplain(?:t|ed|ing)?\b/iu;
  const dissatisfied =
    /\bnot\s+satisfied\b|\bnot\s+happy\b|\bunhappy\b|\bdissatisfied\b|\bacha\s+nahi\b|\btheek\s+nahi\b/iu;
  const satisfied =
    /\b(?:i\s*(?:am|'m)\s+)?satisfied\b|\bhappy\s+with\b|\bgood\s+vendor\b|\bacha\s+(?:hai|tha)\b/iu;
  const reassign =
    /\b(?:replace|change|remove|another)\b[\s\S]{0,32}\bvendor\b|\bvendor\b[\s\S]{0,32}\b(?:replace|change|remove)\b|\b(?:dusra|doosra)\s+vendor\b/iu;

  if (noContact.test(text)) {
    return Object.freeze({ assignmentOrdinal, eventType: 'client_reported_no_contact' as const });
  }
  if (reassign.test(text)) {
    return Object.freeze({ assignmentOrdinal, eventType: 'reassignment_requested' as const });
  }
  if (complaint.test(text)) {
    return Object.freeze({ assignmentOrdinal, eventType: 'client_complaint' as const });
  }
  if (dissatisfied.test(text)) {
    return Object.freeze({ assignmentOrdinal, eventType: 'client_dissatisfied' as const });
  }
  if (satisfied.test(text)) {
    return Object.freeze({ assignmentOrdinal, eventType: 'client_satisfied' as const });
  }
  if (confirmedContact.test(text)) {
    return Object.freeze({ assignmentOrdinal, eventType: 'client_confirmed_contact' as const });
  }
  return null;
}

export function feedbackForMaterial(
  material: QuickFurnoWhatsAppTurnMaterialV2,
): QuickFurnoExplicitClientVendorFeedback | null {
  if (
    material.assignedActor !== 'RIYA' ||
    material.subjectType !== 'client' ||
    material.clientJourney === undefined ||
    material.clientVendorJourney === undefined
  )
    return null;
  return detectExplicitClientVendorFeedback(material.normalizedText);
}
