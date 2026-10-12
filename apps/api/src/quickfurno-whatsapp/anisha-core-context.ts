import type { AnishaCoreTurnMaterialV2 } from './contracts.js';
import { assessAnishaCorePreflight } from './anisha-vendor-preflight.js';

/**
 * AN-A3: only a signed, per-turn Core vendor context may support an
 * account-specific answer. NOT a new vendor read model or memory store.
 * The existing qfj.context.read v1 endpoint supplies these bands/counts.
 */
export const CORE_VENDOR_CONTEXT_PATH = '/api/internal/jarvis/context';
export const CORE_VENDOR_CONTEXT_PROTOCOL = 'qfj.context.read';
export const CORE_VENDOR_CONTEXT_SIGNING_DOMAIN = 'qfj.context.read.http.sig.v1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const READINESS = ['UNKNOWN', 'NOT_ACTIVE', 'NO_PACKAGE', 'LOW_CREDITS', 'READY'] as const;
const EXPIRY = ['UNKNOWN', 'EXPIRED', 'DUE_7D', 'DUE_30D', 'HEALTHY'] as const;
type Readiness = (typeof READINESS)[number];
type Expiry = (typeof EXPIRY)[number];

export interface AnishaCoreVendorSnapshot {
  readonly kind: 'vendor_profile';
  readonly vendorId: string;
  readonly packageReadinessBand: Readiness;
  readonly packageExpiryBand: Expiry;
  readonly vendorStatus: string | null;
  readonly locationVerificationStatus: string | null;
  readonly isActive: boolean;
  readonly activeLeadCount: number;
  readonly pendingBadLeadReportCount: number;
  readonly unreadNotificationCount: number;
}
export interface AnishaCoreVendorContextReader {
  readForTurn(material: AnishaCoreTurnMaterialV2): Promise<AnishaCoreVendorSnapshot>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(obj);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(obj, key));
}
function nullableText(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 240);
}
function safeCount(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
  );
}
const CORE_FIELDS = [
  'kind',
  'vendorId',
  'city',
  'serviceCategories',
  'vendorStatus',
  'isActive',
  'publicVisibility',
  'paidStatus',
  'packageReadinessBand',
  'packageExpiryBand',
  'locationVerificationStatus',
  'activeLeadCount',
  'deliveredUnacknowledgedCount',
  'pendingBadLeadReportCount',
  'unreadNotificationCount',
] as const;

/** Strict HTTPS response decoder: bind request and vendor identity; the response itself is NOT independently signed. */
export function parseBoundCoreVendorContextResponse(
  input: unknown,
  requestId: string,
  vendorId: string,
): AnishaCoreVendorSnapshot | null {
  if (
    !record(input) ||
    !exactKeys(input, ['protocol', 'version', 'requestId', 'entityType', 'entityId', 'context'])
  )
    return null;
  if (
    input['protocol'] !== CORE_VENDOR_CONTEXT_PROTOCOL ||
    input['version'] !== 1 ||
    input['requestId'] !== requestId ||
    input['entityType'] !== 'vendor' ||
    input['entityId'] !== vendorId ||
    !UUID.test(vendorId) ||
    !record(input['context'])
  )
    return null;
  const value = input['context'];
  if (
    !exactKeys(value, CORE_FIELDS) ||
    value['kind'] !== 'vendor_profile' ||
    value['vendorId'] !== vendorId ||
    !nullableText(value['city']) ||
    !Array.isArray(value['serviceCategories']) ||
    value['serviceCategories'].length > 16 ||
    !value['serviceCategories'].every(
      (item: unknown) => typeof item === 'string' && item.length <= 240,
    ) ||
    !nullableText(value['vendorStatus']) ||
    !nullableText(value['paidStatus']) ||
    !nullableText(value['locationVerificationStatus']) ||
    typeof value['isActive'] !== 'boolean' ||
    typeof value['publicVisibility'] !== 'boolean' ||
    !READINESS.includes(value['packageReadinessBand'] as Readiness) ||
    !EXPIRY.includes(value['packageExpiryBand'] as Expiry) ||
    !safeCount(value['activeLeadCount']) ||
    !safeCount(value['deliveredUnacknowledgedCount']) ||
    !safeCount(value['pendingBadLeadReportCount']) ||
    !safeCount(value['unreadNotificationCount'])
  )
    return null;
  // Only bounded, approved fields survive into the model context. Raw city,
  // categories, paidStatus, unacknowledged counters, names & addresses do not.
  return Object.freeze({
    kind: 'vendor_profile',
    vendorId,
    packageReadinessBand: value['packageReadinessBand'] as Readiness,
    packageExpiryBand: value['packageExpiryBand'] as Expiry,
    vendorStatus: value['vendorStatus'],
    locationVerificationStatus: value['locationVerificationStatus'],
    isActive: value['isActive'],
    activeLeadCount: value['activeLeadCount'],
    pendingBadLeadReportCount: value['pendingBadLeadReportCount'],
    unreadNotificationCount: value['unreadNotificationCount'],
  });
}

/** Bounded intent detection avoids 5 Core DB reads on greetings/chit-chat. */
export function needsAnishaCoreVendorContext(text: string): boolean {
  return /\b(?:credit|credits|balance|recharge|wallet|package|plan|expiry|expire|subscription|payment|paid|onboard|onboarding|verify|verification|verified|location|address|office|approval|approved|approve|registration|account|login|lead|leads|notification|complaint|support|refund|status|vendor|profile|paisa|paise|bacha|bach[a-z]*|khatam|kab|renewal)\b|क्रेडिट|पैकेज|लीड|पेमेंट|शिकायत|रिचार्ज/iu.test(
    text,
  );
}

const STATUS = new Set([
  'approved',
  'pending',
  'pending_approval',
  'rejected',
  'suspended',
  'inactive',
]);
const LOCATION = new Set(['verified', 'pending', 'unverified', 'rejected', 'failed']);

/** No prices, exact credits, customer contacts or payment assertions. */
export function composeAnishaCoreVendorFacts(
  conversationInput: string,
  snapshot: AnishaCoreVendorSnapshot | null,
): string {
  const lines =
    snapshot === null
      ? [
          'Current QuickFurno vendor facts UNAVAILABLE. Do not assert any exact balance, price, payment, package activation, lead entitlement, approval, or location verification. Ask the vendor to check their dashboard or request human verification.',
        ]
      : [
          'Current Core vendor facts (read-only snapshot; never change these via AI):',
          'Package readiness band: ' + snapshot.packageReadinessBand,
          'Package expiry band: ' + snapshot.packageExpiryBand,
          'Account active: ' + (snapshot.isActive ? 'yes' : 'no'),
          'Vendor status: ' +
            (snapshot.vendorStatus && STATUS.has(snapshot.vendorStatus.toLowerCase())
              ? snapshot.vendorStatus.toLowerCase()
              : 'unknown'),
          'Office location verification: ' +
            (snapshot.locationVerificationStatus &&
            LOCATION.has(snapshot.locationVerificationStatus.toLowerCase())
              ? snapshot.locationVerificationStatus.toLowerCase()
              : 'unknown'),
          'Core-reported active lead count: ' + String(snapshot.activeLeadCount),
          'Pending bad-lead reports: ' + String(snapshot.pendingBadLeadReportCount),
          'Unread vendor notifications: ' + String(snapshot.unreadNotificationCount),
          'These are bounded Core-reported bands/counts, not wallet balance, a guaranteed new lead, delivery receipt or permission to charge/recharge. Do not invent exact prices, wallet credits, payment status or promise a refund. Direct uncertain claims to Core/dashboard/human.',
        ];
  // The agent inbound-envelope contract allows a bounded message, so trim
  // older conversational context if necessary rather than reject a valid
  // Core fact read or silently drop the verified factual guidance.
  const heading = 'Vendor conversation and recent non-authoritative context:';
  const facts = lines.join('\n');
  const fixedChars = heading.length + facts.length + 2;
  const remaining = Math.max(0, 4096 - fixedChars);
  return [heading, conversationInput.slice(-remaining), facts].join('\n');
}

export function isAuthorizedAnishaCoreContextTurn(material: AnishaCoreTurnMaterialV2): boolean {
  return (
    assessAnishaCorePreflight(material) === 'ANISHA_TURN_READY' &&
    typeof material.subjectRef === 'string' &&
    UUID.test(material.subjectRef)
  );
}
