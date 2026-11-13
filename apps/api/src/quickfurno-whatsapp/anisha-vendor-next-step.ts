import type { AnishaCoreVendorSnapshot } from './anisha-core-context.js';

/**
 * AN-TUNE-V2: one optional support suggestion from a validated, subject-bound Core snapshot.
 * This never creates a task, sends a message, changes Core, or reads a second data store.
 * Suggestions are guidance, not statements that QuickFurno has taken action.
 */
const REPORT =
  'Review your existing bad-lead report in the secure vendor dashboard; its outcome and any credit adjustment require Core review.';
const VERIFY =
  'Check your current registration and office-verification steps in the secure vendor dashboard; submit documents only through the authenticated upload flow.';
const ACCOUNT =
  'Check the account notice in your secure vendor dashboard and request authorized vendor support for a status review.';
const PACKAGE =
  'Review package and credit readiness in the official vendor dashboard; the exact balance, price and purchase status must be confirmed there.';
const EXPIRY =
  'Review package renewal information in your secure dashboard; this does not confirm a charge or a specific renewal date.';
const LEADS =
  'Review your active leads in the secure vendor dashboard. Contact a client only when Core shows an explicit contact entitlement for that assignment; the count alone does not grant access.';
const NOTICES =
  'Open your unread vendor notifications in the secure dashboard to see whether any action is required.';

export function selectAnishaVendorNextStep(
  conversationText: string,
  snapshot: AnishaCoreVendorSnapshot | null,
): string | null {
  if (!snapshot) return null;
  const text = conversationText.toLowerCase();
  const isComplaint =
    /\b(?:bad[ -]?lead|complaint|complain|report|refund|dispute|shikayat)\b/u.test(text);
  const isLeads = /\b(?:lead|leads|client|customer|contact|enquiry|enquiries)\b/u.test(text);
  const isVerification =
    /\b(?:verify|verification|verified|office|document|documents|onboard|onboarding|register|registration|profile|approval)\b/u.test(
      text,
    );
  const isPackage =
    /\b(?:package|plan|recharge|credit|credits|wallet|renew|renewal|expire|expiry|balance|paisa|paise)\b/u.test(
      text,
    );
  const isNotices = /\b(?:notification|notifications|notice|notices|message|messages)\b/u.test(
    text,
  );
  const isGeneral =
    /\b(?:status|update|updates|pending|next|help|account|problem|issue|anything)\b/u.test(text);

  const vendorStatus = snapshot.vendorStatus?.toLowerCase();
  const locationStatus = snapshot.locationVerificationStatus?.toLowerCase();
  const accountNeedsReview =
    vendorStatus === 'suspended' ||
    vendorStatus === 'rejected' ||
    vendorStatus === 'inactive' ||
    vendorStatus === undefined ||
    (vendorStatus === 'approved' && !snapshot.isActive) ||
    (vendorStatus !== 'approved' &&
      vendorStatus !== 'pending' &&
      vendorStatus !== 'pending_approval');
  // Unknown is not verified: fail closed when Core does not prove office readiness.
  const verificationNeedsAttention =
    vendorStatus === 'pending' ||
    vendorStatus === 'pending_approval' ||
    locationStatus !== 'verified';
  const packageNeedsAttention =
    snapshot.packageReadinessBand === 'NOT_ACTIVE' ||
    snapshot.packageReadinessBand === 'NO_PACKAGE' ||
    snapshot.packageReadinessBand === 'LOW_CREDITS';
  const expiryNeedsAttention =
    snapshot.packageExpiryBand === 'EXPIRED' || snapshot.packageExpiryBand === 'DUE_7D';

  // Answer in-topic first. Do not use an unrelated signal as a marketing nudge.
  if (isComplaint) return snapshot.pendingBadLeadReportCount > 0 ? REPORT : null;
  if (isLeads) {
    // Active-lead counts do not prove current approval or per-assignment contact rights.
    if (accountNeedsReview || vendorStatus !== 'approved' || !snapshot.isActive) return ACCOUNT;
    if (verificationNeedsAttention) return VERIFY;
    return snapshot.activeLeadCount > 0 ? LEADS : null;
  }
  if (isVerification)
    return accountNeedsReview ? ACCOUNT : verificationNeedsAttention ? VERIFY : null;
  if (isPackage) {
    // Don't upsell/recharge vendors whose approval and office status are unverified.
    if (accountNeedsReview || vendorStatus !== 'approved' || !snapshot.isActive) return ACCOUNT;
    if (verificationNeedsAttention) return VERIFY;
    return packageNeedsAttention ? PACKAGE : expiryNeedsAttention ? EXPIRY : null;
  }
  if (isNotices) return snapshot.unreadNotificationCount > 0 ? NOTICES : null;
  if (!isGeneral) return null;

  // For open-ended status requests, select the single highest-priority useful next step.
  if (accountNeedsReview) return ACCOUNT;
  if (vendorStatus !== 'approved' || !snapshot.isActive) return VERIFY;
  if (verificationNeedsAttention) return VERIFY;
  if (snapshot.pendingBadLeadReportCount > 0) return REPORT;
  if (packageNeedsAttention) return PACKAGE;
  if (expiryNeedsAttention) return EXPIRY;
  if (snapshot.activeLeadCount > 0) return LEADS;
  if (snapshot.unreadNotificationCount > 0) return NOTICES;
  return null;
}
