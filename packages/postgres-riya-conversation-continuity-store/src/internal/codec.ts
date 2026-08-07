/**
 * The persistence codec (RWC-P2B, ADR-0095).
 *
 * INTERNAL, and the reason this package stores a JSONB envelope rather than the raw runtime object.
 *
 * ### Why a codec exists at all
 *
 * The tempting design -- `JSON.stringify` the constructed state, `JSON.parse` it back, hand it to the
 * constructor -- does NOT round-trip. `createNeedDiscovery` returns a value carrying
 * `behaviourVersion: 1` and an explicit `undefined` for every value that was not discovered, and
 * `NeedDiscoveryInput` is `.strict()` and declares no `behaviourVersion`. So the OUTPUT of the P2A
 * constructor is not a valid INPUT to it: feeding one straight back is refused, and storing the output
 * shape would produce durable rows that no later read could ever accept.
 *
 * The codec is the explicit boundary that fixes this. `encodeContinuityState` projects a canonical
 * state back to the INPUT shape the contract accepts -- dropping `behaviourVersion` and every
 * `undefined`-valued key -- and that projection is what is stored. `decodeContinuityState` parses the
 * stored envelope and rebuilds a canonical state by passing it through the SAME
 * `createRiyaConversationContinuityState`, so "every durable row passed the RWC-P2A contract" stays a
 * property this package holds rather than one it assumes.
 *
 * ### It is storage plumbing, not a second validator
 *
 * The codec decides nothing about legitimacy. It changes SHAPE (output projection to input
 * projection) and never CONTENT: it invents no field, defaults nothing, and drops only the two things
 * the input schema itself refuses. Every judgement about whether a state is one Riya could legitimately
 * be in stays with the constructor, on both boundary crossings.
 */
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type {
  RiyaConversationContinuityStateInput,
  RiyaConversationContinuityStateV1,
} from '@qf-jarvis/riya-conversation-continuity';

import { PostgresRiyaContinuityStoreError } from '../contracts/errors.js';

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Project a constructed `NeedDiscovery` back to the `NeedDiscoveryInput` shape it came from.
 *
 * `behaviourVersion` is dropped because it is a contract artefact the constructor re-stamps on every
 * construction, and the strict input schema refuses it. `undefined`-valued keys are OMITTED rather
 * than written as null: the input expresses "not discovered" as an ABSENT key, and `JSON.stringify`
 * drops them anyway, so doing it here keeps what is validated and what is stored identical.
 */
function toDiscoveryInput(discovery: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(discovery)) {
    if (key === 'behaviourVersion') {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    input[key] = value;
  }
  return input;
}

/**
 * ENCODE: a canonical (or caller-supplied) state to the INPUT-shaped object stored in `state_json`.
 *
 * Every key is copied verbatim apart from the discovery projection and an `undefined`
 * `completionEvidenceRef`, so an extra property a caller invented -- `consentGiven`, `leadId`,
 * `canSubmit` -- still reaches the constructor's `.strict()` envelope and is still refused.
 * Normalising must not become laundering: the encoder changes shape, it does not sanitise content.
 *
 * The result is a plain object. It becomes `state_json` only after the caller has re-proved it through
 * `createRiyaConversationContinuityState` (see `toStateParameters`), so what is serialised is always a
 * projection of a value the contract has just accepted.
 */
export function encodeContinuityState(state: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    // The state type carries `completionEvidenceRef: string | undefined` as an OWN property; the input
    // declares it optional. An explicit `undefined` is the same statement as absence.
    if (key === 'completionEvidenceRef' && value === undefined) {
      continue;
    }
    input[key] = value;
  }
  const discovery = state['discovery'];
  if (isPlainRecord(discovery)) {
    input['discovery'] = toDiscoveryInput(discovery);
  }
  return input;
}

/** What a decode is handed: the envelope, plus the three key/revision columns to cross-check against. */
export interface DecodeInput {
  readonly stateJson: unknown;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly continuityRevision: number;
}

/**
 * DECODE: a stored envelope (plus its key columns) back to a canonical, frozen continuity state.
 *
 * The envelope is passed to the SAME constructor a caller's state is, so a partially applied
 * migration, a restore from an older dump or a hand-corrected row are all judged by the one
 * authoritative rule set. A row that cannot pass is a `repository-invariant` REFUSAL -- never a
 * default, a repair, a partial result or a delete.
 *
 * The three cross-checks are the other half. The CHECK constraints tie the envelope to the columns at
 * write time, but this process has not verified it is connected to a database that has them; a row
 * whose indexed identity or compared revision disagrees with the state the constructor rebuilds is a
 * contradiction the adapter must refuse rather than silently prefer one side of.
 */
export function decodeContinuityState(input: DecodeInput): RiyaConversationContinuityStateV1 {
  // `pg` parses a JSONB column to a JS value before this module sees it, so a well-formed envelope
  // arrives as an object. Anything else -- a string, a number, an array, a null -- is a row this
  // adapter cannot trust, and it is refused rather than re-parsed. (No `JSON.parse` here on purpose:
  // the driver owns the parse, and a second one would be a second, divergent notion of the envelope.)
  const envelope = input.stateJson;
  if (!isPlainRecord(envelope)) {
    throw new PostgresRiyaContinuityStoreError('repository-invariant');
  }

  let canonical: RiyaConversationContinuityStateV1;
  try {
    // Through `unknown` deliberately: this is a stored document, not a value anyone has proved is an
    // input, and the constructor safe-parses every field of it against the real schema.
    canonical = createRiyaConversationContinuityState(
      envelope as unknown as RiyaConversationContinuityStateInput,
    );
  } catch {
    // The contract's own error is discarded rather than wrapped: a caller of THIS package is owed a
    // storage answer, not a continuity-contract diagnosis. What matters is that the row is not
    // trustworthy.
    throw new PostgresRiyaContinuityStoreError('repository-invariant');
  }

  if (
    canonical.tenantId !== input.tenantId ||
    canonical.conversationId !== input.conversationId ||
    canonical.continuityRevision !== input.continuityRevision
  ) {
    throw new PostgresRiyaContinuityStoreError('repository-invariant');
  }
  return canonical;
}
