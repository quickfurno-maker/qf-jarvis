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
import type {
  ConversationStateKey,
  WritableAuthoritativeConversationStatePort,
} from '../contracts/authoritative-state.js';

/**
 * One operator control command, explicitly tenant-scoped (QFJ-P08-B1, ADR-0076).
 *
 * The tenant sits BESIDE the pure command rather than inside it. `@qf-jarvis/conversation-control`
 * stays tenant-neutral and zod-only: its reducer operates on one already-addressed conversation, and
 * tenant isolation is an addressing concern belonging to this composition and to the future
 * persistence adapter. Putting `tenantId` into the command would also put it into the audit record,
 * duplicating a value the store already keys by.
 */
export interface JarvisConversationControlInput {
  readonly tenantId: string;
  readonly command: ConversationControlCommandInput;
}

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

/** An exact scope token: no wildcard, no `latest` -- the two strings that mean "any of them". */
function isExactScopeToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(value) &&
    !value.includes('*') &&
    value.toLowerCase() !== 'latest'
  );
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
 * Is the returned post-state actually the one this ACTION produces?
 *
 * The revision arithmetic alone is not enough. A faulty adapter can return `APPLIED` for
 * `TAKE_OWNERSHIP`, bump the revision, and hand back `humanTakeover: false / aiPaused: false` with an
 * audit record that agrees with those flags — internally consistent, arithmetically sound, and a
 * report that the stop switch was applied when its own evidence proves it was not. That is the one
 * failure this whole phase exists to prevent, so it is checked here rather than trusted.
 *
 * These are POSTCONDITIONS inferable from the decision itself (ADR-0074 §3). The composition does not
 * re-run the reducer and does not read state: an `APPLIED` `nextState` is post-state, so pre-state
 * cannot be reconstructed, and a second reducer call would be a second decision path. The adapter
 * remains responsible for evaluating the command against the real pre-state atomically; this only
 * refuses answers that cannot be true whatever the pre-state was.
 *
 * `revision-mismatch` is deliberately NOT action-checked: staleness is decided before the action
 * semantics ever run, so the flags carry no claim about the action. `human-takeover-active` is
 * checked at its own call site, where the exact `RESUME_AI` precondition already lives.
 */
function actionSemanticsMatch(
  action: ConversationControlCommand['action'],
  outcome: string,
  reason: string,
  nextState: ConversationControlSnapshot,
): boolean {
  const { humanTakeover, aiPaused } = nextState;

  if (outcome === 'APPLIED') {
    switch (action) {
      // Taking ownership ALWAYS forces the pause.
      case 'TAKE_OWNERSHIP':
        return humanTakeover && aiPaused;
      // Releasing ownership never resumes AI (ADR-0054 E).
      case 'RELEASE_OWNERSHIP':
        return !humanTakeover && aiPaused;
      // Pausing leaves ownership alone, so takeover may be either.
      case 'PAUSE_AI':
        return aiPaused;
      // The only action that may clear the pause, and only with no takeover.
      case 'RESUME_AI':
        return !humanTakeover && !aiPaused;
      default:
        return false;
    }
  }

  if (outcome === 'NO_CHANGE') {
    // "Already satisfied" means the state ALREADY meets what the action would have established.
    switch (action) {
      case 'TAKE_OWNERSHIP':
        return humanTakeover && aiPaused;
      // Nothing to release; the pause is not this action's business either way.
      case 'RELEASE_OWNERSHIP':
        return !humanTakeover;
      case 'PAUSE_AI':
        return aiPaused;
      case 'RESUME_AI':
        return !humanTakeover && !aiPaused;
      default:
        return false;
    }
  }

  if (reason === 'revision-exhausted') {
    // Exhaustion is only reachable when the action would REQUIRE a change. If the state already
    // satisfies it, the reducer would have answered NO_CHANGE (or, for RESUME_AI under a takeover,
    // `human-takeover-active`) long before the counter mattered.
    switch (action) {
      case 'TAKE_OWNERSHIP':
        return !(humanTakeover && aiPaused);
      case 'RELEASE_OWNERSHIP':
        return humanTakeover;
      case 'PAUSE_AI':
        return !aiPaused;
      case 'RESUME_AI':
        return !humanTakeover && aiPaused;
      default:
        return false;
    }
  }

  // `revision-mismatch` and `human-takeover-active` are decided elsewhere.
  return true;
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

  // The post-state each ACTION implies. Checked before the arithmetic because it is the stronger
  // claim: a decision can be arithmetically perfect and still report that a takeover was applied
  // while its own flags say otherwise.
  if (!actionSemanticsMatch(command.action, outcome, reason, nextState)) {
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
  input: JarvisConversationControlInput,
): Promise<JarvisConversationControlResult> {
  // The tenant is validated BEFORE the command, and before the source is touched: an unscoped or
  // wildcard tenant is not a command to be refused by the reducer, it is a request that must never
  // reach an authoritative store.
  if (!isPlainRecord(input) || !isExactScopeToken(input.tenantId)) {
    return failure('control-invalid-command');
  }

  let command: ConversationControlCommand;
  try {
    command = createConversationControlCommand(input.command);
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

  const key: ConversationStateKey = Object.freeze({
    tenantId: input.tenantId,
    conversationId: command.conversationId,
  });

  let raw: unknown;
  try {
    raw = await writable.applyControlCommand(key, command);
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
