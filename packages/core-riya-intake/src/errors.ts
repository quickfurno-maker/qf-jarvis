/**
 * The bounded error vocabulary for the Core Riya intake boundary (RWC-P6, ADR-0101).
 *
 * Four codes, four fixed messages. Everything this package parses arrives from OUTSIDE this
 * repository, and the values in question are the most sensitive in the whole journey — a contact
 * readiness, a consent outcome, a submission a business acted on. An error that quoted what it
 * received would be the one place that material leaked into a log.
 *
 * There is deliberately no transport code. A timeout, a refused connection or an unparseable HTTP
 * body are facts about a network, and this package has no network. The future adapter and the
 * composition that calls it own that vocabulary; inventing one here would imply this package could
 * tell the difference.
 */

const CORE_RIYA_INTAKE_ERROR_CODE_VALUES = [
  /** The value could not be proved to be a canonical Core intake state. */
  'invalid-intake-state',
  /** The value could not be proved to be a canonical submission request. */
  'invalid-submission-request',
  /** The value could not be proved to be a canonical submission result. */
  'invalid-submission-result',
  /** The value could not be proved to be a canonical submission lookup. */
  'invalid-lookup-result',
] as const;

export type CoreRiyaIntakeErrorCode = (typeof CORE_RIYA_INTAKE_ERROR_CODE_VALUES)[number];

export const CORE_RIYA_INTAKE_ERROR_CODES: readonly CoreRiyaIntakeErrorCode[] = Object.freeze([
  ...CORE_RIYA_INTAKE_ERROR_CODE_VALUES,
]);

const MESSAGES: Readonly<Record<CoreRiyaIntakeErrorCode, string>> = Object.freeze({
  'invalid-intake-state': 'A Core Riya intake state is invalid.',
  'invalid-submission-request': 'A Core Riya intake submission request is invalid.',
  'invalid-submission-result': 'A Core Riya intake submission result is invalid.',
  'invalid-lookup-result': 'A Core Riya intake submission lookup is invalid.',
});

export class CoreRiyaIntakeError extends Error {
  readonly code: CoreRiyaIntakeErrorCode;

  constructor(code: CoreRiyaIntakeErrorCode) {
    super(MESSAGES[code]);
    this.name = 'CoreRiyaIntakeError';
    this.code = code;
  }
}
