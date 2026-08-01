/**
 * The operator control surface (QFJ-P08-A, ADR-0075).
 *
 * One programmatic method on the composition root: validate an operator's command input, hand it to
 * the SAME authoritative state source the inbound path reads, and canonicalize whatever comes back.
 *
 * It applies nothing itself. The writable source is the atomic application boundary — a future
 * persistent adapter must combine read + decide + write in one transaction — so calling the reducer
 * here as well would create a second application path and, worse, a second answer. This module
 * validates before the call and validates after it, and that is all.
 *
 * This is NOT an authenticated console. `operatorRef` is an attribution reference, not proof of
 * identity: there is no HTTP route, session, RBAC, API key, OAuth or permission store here, and a
 * future operator API must authenticate and authorize BEFORE reaching this method.
 */
import {
  CONVERSATION_CONTROL_ACTIONS_FROZEN,
  createConversationControlCommand,
  createConversationControlSnapshot,
} from '@qf-jarvis/conversation-control';
import type {
  ConversationControlCommand,
  ConversationControlCommandInput,
  ConversationControlDecision,
  ConversationControlSnapshot,
} from '@qf-jarvis/conversation-control';

import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type { WritableAuthoritativeConversationStatePort } from '../contracts/authoritative-state.js';

/**
 * The outcome of one control attempt.
 *
 * Type-only: no new runtime reason array is introduced, because these four literals describe THIS
 * composition boundary rather than a governed runtime vocabulary. `ok: true` still carries a
 * `REFUSED` decision when the reducer refused — a refusal is a successful application of the rules,
 * not a failure of the surface.
 */
export type JarvisConversationControlResult =
  | { readonly ok: true; readonly decision: ConversationControlDecision }
  | {
      readonly ok: false;
      readonly reason:
        | 'control-invalid-command'
        | 'control-unavailable'
        | 'control-source-failure'
        | 'control-invalid-result';
    };

function failure(
  reason: Extract<JarvisConversationControlResult, { ok: false }>['reason'],
): JarvisConversationControlResult {
  return Object.freeze({ ok: false as const, reason });
}

/** A plain, non-array object with no inherited enumerable payload. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    return false;
  }
  const own = new Set(Object.keys(value));
  for (const key in value) {
    if (!own.has(key)) {
      return false;
    }
  }
  return true;
}

/**
 * Does this source implement the writable capability?
 *
 * A private structural check on the ONE configured object. It is not root-exported: a caller who
 * could ask "is this writable?" would be building a service locator, and the answer is already
 * expressed as a closed `control-unavailable` result. The source is never mutated.
 */
function asWritable(
  source: JarvisRuntimeConfig['authoritativeState'],
): WritableAuthoritativeConversationStatePort | undefined {
  const candidate = source as Partial<WritableAuthoritativeConversationStatePort>;
  return typeof candidate.applyControlCommand === 'function'
    ? (source as WritableAuthoritativeConversationStatePort)
    : undefined;
}

/** The exact outcome → reason pairings ADR-0074 permits. Any other pair is a malformed decision. */
const ALLOWED_REASONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  APPLIED: Object.freeze(['applied']),
  NO_CHANGE: Object.freeze(['already-satisfied']),
  REFUSED: Object.freeze(['revision-mismatch', 'human-takeover-active', 'revision-exhausted']),
});

/** The exact own keys a decision's audit record carries, `reasonRef` aside. */
const REQUIRED_AUDIT_KEYS = [
  'recordVersion',
  'commandId',
  'conversationId',
  'action',
  'operatorRef',
  'expectedRevision',
  'observedRevision',
  'outcome',
  'reason',
  'resultingRevision',
  'humanTakeover',
  'aiPaused',
  'issuedAt',
] as const;

function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Rebuild a foreign decision as a fresh, deeply frozen, internally consistent record.
 *
 * `WritableAuthoritativeConversationStatePort` is a STRUCTURAL interface any deployment may implement,
 * possibly outside this repository. Returning its object by identity would hand a caller something
 * this composition never checked — and something the source could still hold a reference to and
 * mutate afterwards. So every field is re-derived from the command and the validated next state, and
 * every claim the record makes about itself is cross-checked.
 *
 * The reducer is NOT re-run here. The adapter already applied it atomically; running it again would
 * produce a second decision, and if the two disagreed there would be no principled way to choose.
 * Instead the returned decision is checked for consistency with the command that produced it.
 *
 * Returns `undefined` when anything fails to line up. No raw value from the source escapes.
 */
function canonicalizeDecision(
  command: ConversationControlCommand,
  value: unknown,
): ConversationControlDecision | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== 'auditRecord' ||
    keys[1] !== 'nextState' ||
    keys[2] !== 'outcome' ||
    keys[3] !== 'reason'
  ) {
    return undefined;
  }

  const outcome = value['outcome'];
  const reason = value['reason'];
  if (typeof outcome !== 'string' || typeof reason !== 'string') {
    return undefined;
  }
  if (!ALLOWED_REASONS[outcome]?.includes(reason)) {
    return undefined;
  }

  // The next state goes through the real constructor, so a malformed one cannot reach a caller.
  let nextState: ConversationControlSnapshot;
  try {
    nextState = createConversationControlSnapshot(
      value['nextState'] as Parameters<typeof createConversationControlSnapshot>[0],
    );
  } catch {
    return undefined;
  }
  if (nextState.conversationId !== command.conversationId) {
    return undefined;
  }

  const audit = value['auditRecord'];
  if (!isPlainRecord(audit)) {
    return undefined;
  }
  const auditKeys = new Set(Object.keys(audit));
  for (const required of REQUIRED_AUDIT_KEYS) {
    if (!auditKeys.has(required)) {
      return undefined;
    }
    auditKeys.delete(required);
  }
  auditKeys.delete('reasonRef');
  if (auditKeys.size > 0) {
    return undefined;
  }

  const observedRevision = audit['observedRevision'];
  if (!isSafeRevision(observedRevision)) {
    return undefined;
  }

  // Every correlation field must match the command this composition actually sent. A record naming a
  // different command, operator or instant is evidence about something else.
  const hasReasonRef = Object.prototype.hasOwnProperty.call(audit, 'reasonRef');
  if (
    audit['recordVersion'] !== 1 ||
    audit['commandId'] !== command.commandId ||
    audit['conversationId'] !== command.conversationId ||
    audit['action'] !== command.action ||
    audit['operatorRef'] !== command.operatorRef ||
    audit['expectedRevision'] !== command.expectedRevision ||
    audit['issuedAt'] !== command.issuedAt ||
    audit['outcome'] !== outcome ||
    audit['reason'] !== reason ||
    audit['resultingRevision'] !== nextState.revision ||
    audit['humanTakeover'] !== nextState.humanTakeover ||
    audit['aiPaused'] !== nextState.aiPaused ||
    hasReasonRef !== (command.reasonRef !== undefined) ||
    (hasReasonRef && audit['reasonRef'] !== command.reasonRef)
  ) {
    return undefined;
  }

  // The arithmetic each outcome implies. A decision that claims APPLIED without advancing the
  // revision, or claims a mismatch while the revisions agree, is describing something that did not
  // happen -- whatever the source meant, it is not safe to hand on.
  if (outcome === 'APPLIED') {
    if (
      command.expectedRevision !== observedRevision ||
      observedRevision >= Number.MAX_SAFE_INTEGER ||
      nextState.revision !== observedRevision + 1
    ) {
      return undefined;
    }
  } else if (outcome === 'NO_CHANGE') {
    if (command.expectedRevision !== observedRevision || nextState.revision !== observedRevision) {
      return undefined;
    }
  } else if (reason === 'revision-mismatch') {
    if (command.expectedRevision === observedRevision || nextState.revision !== observedRevision) {
      return undefined;
    }
  } else if (reason === 'human-takeover-active') {
    // The only semantic refusal, and only RESUME_AI can produce it under an active takeover.
    if (
      command.expectedRevision !== observedRevision ||
      command.action !== 'RESUME_AI' ||
      nextState.revision !== observedRevision ||
      !nextState.humanTakeover
    ) {
      return undefined;
    }
  } else {
    // revision-exhausted
    if (
      command.expectedRevision !== observedRevision ||
      observedRevision !== Number.MAX_SAFE_INTEGER ||
      nextState.revision !== observedRevision
    ) {
      return undefined;
    }
  }

  const canonicalAudit = Object.freeze({
    recordVersion: 1 as const,
    commandId: command.commandId,
    conversationId: command.conversationId,
    action: command.action,
    operatorRef: command.operatorRef,
    ...(command.reasonRef === undefined ? {} : { reasonRef: command.reasonRef }),
    expectedRevision: command.expectedRevision,
    observedRevision,
    outcome,
    reason,
    resultingRevision: nextState.revision,
    humanTakeover: nextState.humanTakeover,
    aiPaused: nextState.aiPaused,
    issuedAt: command.issuedAt,
  });
  return Object.freeze({
    outcome,
    reason,
    nextState,
    auditRecord: canonicalAudit,
  }) as ConversationControlDecision;
}

/**
 * Apply one operator control command through the configured authoritative source.
 *
 * Order: validate the input into a canonical command → detect the writable capability on the SAME
 * configured object → call it EXACTLY once → canonicalize the answer.
 *
 * The runtime takes INPUT rather than a pre-built command deliberately: the composition boundary
 * itself invokes `createConversationControlCommand`, so untrusted structural input cannot reach an
 * authoritative source having skipped validation. It generates nothing — no `commandId`, no
 * `operatorRef`, no `reasonRef`, no `issuedAt`. `config.clock()` is not consulted; the operator's own
 * instant is the evidence.
 *
 * No retry, no fallback, no second source, no second application.
 */
export async function applyControlCommandThroughSource(
  config: JarvisRuntimeConfig,
  input: ConversationControlCommandInput,
): Promise<JarvisConversationControlResult> {
  let command: ConversationControlCommand;
  try {
    command = createConversationControlCommand(input);
  } catch {
    // The thrown value is discarded: it comes from validating operator-supplied input, and echoing it
    // would put that input back in front of a caller. The reason code says which of the four things
    // went wrong, which is what a wiring fix needs.
    return failure('control-invalid-command');
  }
  if (!CONVERSATION_CONTROL_ACTIONS_FROZEN.includes(command.action)) {
    // Unreachable through the constructor; kept because the action drives the refusal arithmetic
    // below and a widened vocabulary must not silently acquire unchecked semantics here.
    return failure('control-invalid-command');
  }

  const writable = asWritable(config.authoritativeState);
  if (writable === undefined) {
    // A read-only source is still perfectly valid for the inbound path -- operator capability is
    // optional, not mandatory. Refusing closed beats inventing a control plane.
    return failure('control-unavailable');
  }

  let raw: unknown;
  try {
    raw = await writable.applyControlCommand(command);
  } catch {
    // Foreign code, possibly holding conversation detail. Discarded, never logged or re-emitted.
    return failure('control-source-failure');
  }

  const decision = canonicalizeDecision(command, raw);
  if (decision === undefined) {
    return failure('control-invalid-result');
  }
  return Object.freeze({ ok: true as const, decision });
}
