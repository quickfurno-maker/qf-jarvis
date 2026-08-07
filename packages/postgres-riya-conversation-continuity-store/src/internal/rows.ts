/**
 * Row parameters, row canonicalization, and caller-input validation (RWC-P2B, ADR-0095).
 *
 * INTERNAL. The persistence SHAPE change lives in `codec.ts`; this module is the adapter's boundary
 * with it: it turns a caller-supplied state into the four SQL parameters a write needs, turns a
 * durable row back into a canonical state, and refuses a malformed key or expected revision before a
 * connection is ever taken.
 *
 * Every state crossing this adapter -- in either direction -- passes through
 * `createRiyaConversationContinuityState`, the RWC-P2A constructor that is the authoritative
 * definition of a state Riya could legitimately be in. On the way in that happens here; on the way out
 * it happens in `decodeContinuityState`. Nothing downstream ever sees a raw row or raw JSON.
 */
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type {
  RiyaConversationContinuityStateInput,
  RiyaConversationContinuityStateV1,
} from '@qf-jarvis/riya-conversation-continuity';

import { PostgresRiyaContinuityStoreError } from '../contracts/errors.js';
import { decodeContinuityState, encodeContinuityState, isPlainRecord } from './codec.js';

/**
 * `BIGINT` arrives as a STRING from `pg`, because a 64-bit integer does not fit a JS number.
 *
 * The round-trip check (`String(parsed) !== value`) is the point: a value too large to represent
 * exactly would otherwise parse to a nearby number and be silently accepted as a revision, and a
 * compare-and-set against a revision that is off by one is a lost update nobody can see.
 */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function parseBigintRevision(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= MAX_SAFE ? value : undefined;
  }
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SAFE || String(parsed) !== value) {
    return undefined;
  }
  return parsed;
}

/**
 * Rebuild one durable row into a canonical, frozen continuity state.
 *
 * The row is expected to carry the three first-class columns plus the envelope. Structural reading
 * first: the columns are read and bounded here, and the envelope-to-state proof plus the
 * column/envelope cross-checks are `decodeContinuityState`'s job. A row missing a column, or carrying
 * a revision too large to represent, is a `repository-invariant` refusal.
 */
export function canonicalizeRow(row: unknown): RiyaConversationContinuityStateV1 {
  if (!isPlainRecord(row)) {
    throw new PostgresRiyaContinuityStoreError('repository-invariant');
  }
  const continuityRevision = parseBigintRevision(row['continuity_revision']);
  const tenantId = row['tenant_id'];
  const conversationId = row['conversation_id'];
  if (
    continuityRevision === undefined ||
    typeof tenantId !== 'string' ||
    typeof conversationId !== 'string'
  ) {
    throw new PostgresRiyaContinuityStoreError('repository-invariant');
  }
  return decodeContinuityState({
    stateJson: row['state_json'],
    tenantId,
    conversationId,
    continuityRevision,
  });
}

/**
 * Re-prove a caller-supplied state and project it to the four SQL parameters a write needs.
 *
 * The declared parameter type promises a valid state; an untyped caller, a state rebuilt from JSON, or
 * a state mutated after construction promises nothing. So the caller's state is projected to the input
 * shape (`encodeContinuityState`), re-proved through the canonical constructor, and only the CANONICAL
 * result is serialised -- never the caller's object. A failure here is `invalid-input`, NOT
 * `repository-invariant`: nothing was stored, nothing durable is in question, and the defect is the
 * caller's.
 */
export interface StateParameters {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly continuityRevision: number;
  readonly stateJson: string;
}

export function toStateParameters(state: unknown): StateParameters {
  if (!isPlainRecord(state)) {
    throw new PostgresRiyaContinuityStoreError('invalid-input');
  }

  let canonical: RiyaConversationContinuityStateV1;
  try {
    canonical = createRiyaConversationContinuityState(
      // The projection drops the constructor's own output artefacts (`behaviourVersion`, `undefined`s)
      // so a canonical state can be re-proved -- but it copies every OTHER key verbatim, so an invented
      // property still reaches `.strict()` and is still refused.
      encodeContinuityState(state) as unknown as RiyaConversationContinuityStateInput,
    );
  } catch {
    throw new PostgresRiyaContinuityStoreError('invalid-input');
  }

  return {
    tenantId: canonical.tenantId,
    conversationId: canonical.conversationId,
    continuityRevision: canonical.continuityRevision,
    // Serialised from the CANONICAL value, in the INPUT projection, so the column holds a shape a
    // future read can hand straight back to the contract. A state carrying an extra property was
    // refused above, so one cannot reach the column even if the constructor were ever loosened.
    stateJson: JSON.stringify(
      encodeContinuityState(canonical as unknown as Record<string, unknown>),
    ),
  };
}

/**
 * The bounded key check, run BEFORE a connection is taken.
 *
 * The grammar is RWC-P2A's, restated for the same reason the migration restates it: a caller whose key
 * is prose or an email address is a caller defect, and it must be reported as `invalid-input` rather
 * than sent to the server to come back as a constraint violation -- which would arrive here as
 * `repository-invariant` and blame the durable data for the caller's mistake.
 */
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;

export interface ValidatedKey {
  readonly tenantId: string;
  readonly conversationId: string;
}

export function validateKey(key: unknown): ValidatedKey {
  if (!isPlainRecord(key)) {
    throw new PostgresRiyaContinuityStoreError('invalid-input');
  }
  const tenantId: unknown = key['tenantId'];
  const conversationId: unknown = key['conversationId'];
  if (
    typeof tenantId !== 'string' ||
    typeof conversationId !== 'string' ||
    !IDENTIFIER.test(tenantId) ||
    !IDENTIFIER.test(conversationId)
  ) {
    throw new PostgresRiyaContinuityStoreError('invalid-input');
  }
  return { tenantId, conversationId };
}

/** A revision a compare-and-set may legitimately expect: the same bounds the state's own carries. */
export function validateExpectedRevision(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new PostgresRiyaContinuityStoreError('invalid-input');
  }
  return value;
}
