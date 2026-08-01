/**
 * The operator control command (QFJ-P08-A, ADR-0074).
 *
 * One human intent, expressed as a closed action against an exact conversation at an exact expected
 * revision, attributed to an opaque operator reference.
 *
 * Everything here is a REFERENCE, never a value. `operatorRef` is an opaque id, not a name, email or
 * phone number; `reasonRef` is an opaque code, not free text. That is what makes a control command
 * safe to write into audit evidence unredacted — and free text is the field through which message
 * content, customer detail and speculation would arrive.
 *
 * There is no message body, no recipient, no party data, no approval or Core outcome, no execution
 * field, no provider id, no credential, and no metadata bag. A metadata bag in particular is how a
 * content-free contract stops being content-free, so there is not one.
 */
import { z } from 'zod';

import { ConversationControlError } from './errors.js';
import { ACTION_VALUES, type ConversationControlAction } from './vocabularies.js';
import {
  CANONICAL_INSTANT_SCHEMA,
  EXACT_IDENTIFIER,
  REVISION,
  isPlainRecord,
} from '../internal/grammar.js';

/**
 * The control CONTRACT version. Not a conversation revision, not an operator's version, not a
 * rollout state. It stamps which command grammar produced a record.
 */
export const CONVERSATION_CONTROL_VERSION = 1 as const;
export type ConversationControlVersion = typeof CONVERSATION_CONTROL_VERSION;

/** What a caller may supply. `controlVersion` is deliberately absent — see below. */
export interface ConversationControlCommandInput {
  readonly commandId: string;
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly action: ConversationControlAction;
  readonly operatorRef: string;
  /** An opaque reason CODE, never free text. Optional: not every action needs a justification. */
  readonly reasonRef?: string;
  /** Caller-supplied canonical UTC millisecond instant. This package reads no clock. */
  readonly issuedAt: string;
}

/** One frozen, validated control command. */
export interface ConversationControlCommand {
  readonly controlVersion: ConversationControlVersion;
  readonly commandId: string;
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly action: ConversationControlAction;
  readonly operatorRef: string;
  readonly reasonRef?: string;
  readonly issuedAt: string;
}

const commandInputSchema = z
  .object({
    commandId: EXACT_IDENTIFIER,
    conversationId: EXACT_IDENTIFIER,
    expectedRevision: REVISION,
    action: z.enum(ACTION_VALUES),
    operatorRef: EXACT_IDENTIFIER,
    reasonRef: EXACT_IDENTIFIER.optional(),
    issuedAt: CANONICAL_INSTANT_SCHEMA,
  })
  .strict();

/** The exact own keys a materialized command carries when `reasonRef` is absent. */
export const MATERIALIZED_COMMAND_KEYS_REQUIRED = [
  'controlVersion',
  'commandId',
  'conversationId',
  'expectedRevision',
  'action',
  'operatorRef',
  'issuedAt',
] as const;

/**
 * Build a frozen, validated control command.
 *
 * Throws `ConversationControlError('invalid-command')` on any invalid or unknown field.
 *
 * A caller CANNOT supply `controlVersion`: it is not in the input type and, because the schema is
 * strict, supplying it anyway is rejected rather than ignored. A version a caller could set is a
 * version that says what the caller wished the grammar was.
 *
 * No `commandId` is generated and no `issuedAt` is defaulted. Both come from the caller, because both
 * are evidence about an operator — an id this package invented could not be correlated with the
 * request that produced it, and an instant it invented would be its own clock, not the operator's.
 *
 * `exactOptionalPropertyTypes`: an absent `reasonRef` is an ABSENT key, never an explicit `undefined`.
 */
export function createConversationControlCommand(
  input: ConversationControlCommandInput,
): ConversationControlCommand {
  if (!isPlainRecord(input)) {
    throw new ConversationControlError('invalid-command');
  }
  const parsed = commandInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConversationControlError('invalid-command');
  }
  const data = parsed.data;
  return Object.freeze({
    controlVersion: CONVERSATION_CONTROL_VERSION,
    commandId: data.commandId,
    conversationId: data.conversationId,
    expectedRevision: data.expectedRevision,
    action: data.action,
    operatorRef: data.operatorRef,
    ...(data.reasonRef === undefined ? {} : { reasonRef: data.reasonRef }),
    issuedAt: data.issuedAt,
  });
}

/**
 * Re-validate a value that CLAIMS to be a materialized command, returning the canonical record.
 *
 * INTERNAL. Same reasoning as the snapshot: the interface is structural, so a literal satisfies it
 * without having passed the constructor. Here it matters more — a forged command carries an
 * operator's identity, and the reducer must not act on one that never went through validation.
 */
export function revalidateCommand(value: unknown): ConversationControlCommand {
  if (!isPlainRecord(value)) {
    throw new ConversationControlError('invalid-command');
  }
  // `isPlainRecord` has already narrowed this to a record; no assertion is needed.
  const record = value;
  // The version must be the one THIS grammar stamps. A record claiming another version was built by
  // a different contract, and re-validating it under this one would misreport what produced it.
  if (record['controlVersion'] !== CONVERSATION_CONTROL_VERSION) {
    throw new ConversationControlError('invalid-command');
  }
  const keys = new Set(Object.keys(record));
  for (const required of MATERIALIZED_COMMAND_KEYS_REQUIRED) {
    if (!keys.has(required)) {
      throw new ConversationControlError('invalid-command');
    }
    keys.delete(required);
  }
  keys.delete('reasonRef');
  if (keys.size > 0) {
    throw new ConversationControlError('invalid-command');
  }
  const rebuilt: Record<string, unknown> = {
    commandId: record['commandId'],
    conversationId: record['conversationId'],
    expectedRevision: record['expectedRevision'],
    action: record['action'],
    operatorRef: record['operatorRef'],
    issuedAt: record['issuedAt'],
    ...(Object.prototype.hasOwnProperty.call(record, 'reasonRef')
      ? { reasonRef: record['reasonRef'] }
      : {}),
  };
  return createConversationControlCommand(rebuilt as unknown as ConversationControlCommandInput);
}
