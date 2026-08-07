/**
 * The canonical round trip (RWC-P2B, ADR-0095).
 *
 * INTERNAL, and the single most important module in this package. Every state crossing this adapter
 * -- in either direction -- passes through `createRiyaConversationContinuityState`, the RWC-P2A
 * constructor that is the authoritative definition of a state Riya could legitimately be in.
 *
 * ### Why validate on the way OUT as well as on the way IN
 *
 * "The CHECK constraints prevent that" is a claim about a schema this process has not verified it is
 * connected to. A partially applied migration, a restore from an older dump, a hand-corrected row,
 * or a row written by a future second writer all arrive here looking exactly like data. And the
 * database deliberately does NOT restate the NeedDiscovery rules, the provenance/value pairing or
 * the summary-readiness rule -- so there are real invariants no constraint is holding.
 *
 * A row that cannot pass the contract therefore becomes a REFUSAL. It is not defaulted, not
 * repaired, not partially returned and not deleted. Repairing durable evidence is how a lost update
 * becomes an invented conversation, and this adapter has no authority to decide what a corrupt row
 * was supposed to say.
 *
 * ### Why the state is REBUILT rather than passed through
 *
 * The constructor returns a frozen value built from parsed input, so what leaves this module is
 * never the caller's object and never the driver's row. Nothing downstream can mutate a stored state
 * by holding a reference to it, and no raw JSON escapes.
 */
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type {
  RiyaConversationContinuityStateInput,
  RiyaConversationContinuityStateV1,
} from '@qf-jarvis/riya-conversation-continuity';

import { PostgresRiyaContinuityStoreError } from '../contracts/errors.js';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `BIGINT` arrives as a STRING from `pg`, because a 64-bit integer does not fit a JS number.
 *
 * The round-trip check (`String(parsed) !== value`) is the point: a value that is too large to
 * represent exactly would otherwise parse to a nearby number and be silently accepted as a revision,
 * and a compare-and-set against a revision that is off by one is a lost update nobody can see.
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

/** `SMALLINT` fits a JS number, but the driver's type is still not this module's assumption. */
function parseVersion(value: unknown): 1 | undefined {
  if (value === 1) {
    return 1;
  }
  if (value === '1') {
    return 1;
  }
  return undefined;
}

/**
 * Rebuild one durable row into a canonical, frozen continuity state.
 *
 * Structural reading first, canonical proof second. The structural pass exists because the
 * constructor's input type promises a shape a row has not been proved to have -- `discovery` could
 * be an array, `phase` could be null, `continuity_revision` could be a string too large to
 * represent. Handing any of those straight to the constructor would either throw the wrong error or,
 * worse, be coerced into something plausible.
 */
export function canonicalizeRow(row: unknown): RiyaConversationContinuityStateV1 {
  if (!isPlainRecord(row)) {
    throw new PostgresRiyaContinuityStoreError('repository-invariant');
  }

  const version = parseVersion(row['version']);
  const continuityRevision = parseBigintRevision(row['continuity_revision']);
  const tenantId = row['tenant_id'];
  const conversationId = row['conversation_id'];
  const phase = row['phase'];
  const discovery = row['discovery'];
  const fieldProvenance = row['field_provenance'];
  const summaryConfirmed = row['summary_confirmed'];
  const completionEvidenceRef = row['completion_evidence_ref'];

  if (
    version === undefined ||
    continuityRevision === undefined ||
    typeof tenantId !== 'string' ||
    typeof conversationId !== 'string' ||
    typeof phase !== 'string' ||
    typeof summaryConfirmed !== 'boolean' ||
    !isPlainRecord(discovery) ||
    !isPlainRecord(fieldProvenance) ||
    // SQL NULL means "no completion evidence", which the contract expresses as an ABSENT key rather
    // than as `null`. Anything else present must be a string for the constructor to judge.
    (completionEvidenceRef !== null && typeof completionEvidenceRef !== 'string')
  ) {
    throw new PostgresRiyaContinuityStoreError('repository-invariant');
  }

  // Built as an input, then re-proved. `phase` is passed as an unvalidated string on purpose: the
  // constructor owns the closed vocabulary, and narrowing it here with a second copy of the nine
  // values is exactly the drift this package refuses to start.
  const input = {
    version,
    tenantId,
    conversationId,
    continuityRevision,
    phase,
    discovery,
    fieldProvenance,
    summaryConfirmed,
    ...(completionEvidenceRef === null ? {} : { completionEvidenceRef }),
    // Through `unknown` deliberately. This is a row, not a value anybody has proved is an input, and
    // the constructor safe-parses every field of it against the real schema — the same treatment its
    // own boundary gives a caller-supplied object.
  } as unknown as RiyaConversationContinuityStateInput;

  try {
    return createRiyaConversationContinuityState(input);
  } catch {
    // The contract's own error is discarded rather than wrapped: its code names the failing rule and
    // a caller of THIS package is owed a storage answer, not a continuity-contract diagnosis. What
    // matters to them is that the durable row is not trustworthy.
    throw new PostgresRiyaContinuityStoreError('repository-invariant');
  }
}

/**
 * Re-prove a caller-supplied state and project it to SQL parameters.
 *
 * The declared parameter type promises a valid state; an untyped caller, a state rebuilt from JSON,
 * or a state mutated after construction promises nothing. Re-proving is cheap and it is the only way
 * the invariant "every durable row passed the contract" is actually true rather than assumed.
 *
 * A failure here is `invalid-input`, NOT `repository-invariant`: nothing was stored, nothing durable
 * is in question, and the defect is the caller's.
 */
export interface StateParameters {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly version: number;
  readonly continuityRevision: number;
  readonly phase: string;
  readonly discoveryJson: string;
  readonly fieldProvenanceJson: string;
  readonly summaryConfirmed: boolean;
  readonly completionEvidenceRef: string | null;
}

/**
 * Project a constructed `NeedDiscovery` back to the `NeedDiscoveryInput` shape it came from.
 *
 * This is NOT a formality. `createNeedDiscovery` returns an object carrying `behaviourVersion: 1`
 * and an explicit `undefined` for every value that was not discovered -- and `needDiscoveryInput` is
 * `.strict()` and declares no `behaviourVersion`. So a constructed discovery is NOT a valid input to
 * the constructor that produced it, and feeding one straight back is refused.
 *
 * That matters twice over, because the same value has to survive a round trip through JSONB. Storing
 * the OUTPUT shape would put `behaviourVersion` in the column, and every subsequent read would fail
 * canonical validation -- a durable row that no reader could ever accept. So the INPUT projection is
 * what is stored: it is the shape the contract accepts, and `behaviourVersion` is a contract artefact
 * the contract re-stamps on every construction rather than data this table has any business keeping.
 *
 * Undefined-valued keys are OMITTED rather than written as null. `JSON.stringify` drops them anyway,
 * so doing it explicitly here keeps what is validated and what is stored identical.
 */
function toDiscoveryInput(discovery: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(discovery)) {
    // A contract artefact, not data. The constructor re-stamps it on every construction, and the
    // strict input schema refuses it, so carrying it forward would refuse the very value it came from.
    if (key === 'behaviourVersion') {
      continue;
    }
    // `undefined` means "not discovered", which the input expresses as an ABSENT key. `JSON.stringify`
    // drops these anyway; doing it here keeps what is validated and what is stored identical.
    if (value === undefined) {
      continue;
    }
    input[key] = value;
  }
  return input;
}

/**
 * Project any caller-supplied state into the INPUT shape the constructor accepts.
 *
 * Every key is copied verbatim apart from the two the OUTPUT shape adds, so an extra property a
 * caller invented -- `consentGiven`, `leadId`, `canSubmit` -- still reaches `.strict()` and is still
 * refused. Normalising must not become laundering.
 */
function toStateInput(state: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    // The state type carries `completionEvidenceRef: string | undefined` as an OWN property; the
    // input declares it optional. An explicit `undefined` is the same statement as absence.
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

export function toStateParameters(state: unknown): StateParameters {
  if (!isPlainRecord(state)) {
    throw new PostgresRiyaContinuityStoreError('invalid-input');
  }

  let canonical: RiyaConversationContinuityStateV1;
  try {
    canonical = createRiyaConversationContinuityState(
      toStateInput(state) as unknown as RiyaConversationContinuityStateInput,
    );
  } catch {
    throw new PostgresRiyaContinuityStoreError('invalid-input');
  }

  return {
    tenantId: canonical.tenantId,
    conversationId: canonical.conversationId,
    version: canonical.version,
    continuityRevision: canonical.continuityRevision,
    phase: canonical.phase,
    // Serialized from the CANONICAL value, never from the caller's object, and stored in the INPUT
    // projection so the column holds a shape a future read can hand straight back to the contract.
    // A state carrying an extra property would have been refused above, so one cannot reach the
    // column even if the constructor were ever loosened.
    discoveryJson: JSON.stringify(
      toDiscoveryInput(canonical.discovery as unknown as Record<string, unknown>),
    ),
    fieldProvenanceJson: JSON.stringify(canonical.fieldProvenance),
    summaryConfirmed: canonical.summaryConfirmed,
    completionEvidenceRef: canonical.completionEvidenceRef ?? null,
  };
}

/**
 * The bounded key check, run BEFORE a connection is taken.
 *
 * The grammar is RWC-P2A's, restated for the same reason the migration restates it: a caller whose
 * key is prose or an email address is a caller defect, and it must be reported as `invalid-input`
 * rather than sent to the server to come back as a constraint violation -- which would arrive here
 * as `repository-invariant` and blame the durable data for the caller's mistake.
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
