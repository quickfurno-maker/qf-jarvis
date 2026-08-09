/**
 * The bounded error vocabulary for the Core service-availability read (RWC-P5, ADR-0100).
 *
 * Two codes, two fixed messages. A snapshot arrives from OUTSIDE this repository, so an error that
 * quoted what it received would be the one place an unvetted external payload leaked into a log.
 * The code names the kind of fault; the message carries no identifier, no ref, no label and no
 * fragment of the value.
 */

const CORE_SERVICE_AVAILABILITY_READ_ERROR_CODE_VALUES = [
  /** The value could not be proved to be a canonical Core service-availability snapshot. */
  'invalid-snapshot',
  /**
   * The injected reader could not be used at all — absent, or not the shape the port declares.
   *
   * Separate from `invalid-snapshot` because they fail differently: a bad snapshot means Core said
   * something unusable, and a bad reader means nobody asked Core anything.
   */
  'invalid-reader',
] as const;

export type CoreServiceAvailabilityReadErrorCode =
  (typeof CORE_SERVICE_AVAILABILITY_READ_ERROR_CODE_VALUES)[number];

export const CORE_SERVICE_AVAILABILITY_READ_ERROR_CODES: readonly CoreServiceAvailabilityReadErrorCode[] =
  Object.freeze([...CORE_SERVICE_AVAILABILITY_READ_ERROR_CODE_VALUES]);

const MESSAGES: Readonly<Record<CoreServiceAvailabilityReadErrorCode, string>> = Object.freeze({
  'invalid-snapshot': 'A Core service availability snapshot is invalid.',
  'invalid-reader': 'A Core service availability reader is invalid.',
});

export class CoreServiceAvailabilityReadError extends Error {
  readonly code: CoreServiceAvailabilityReadErrorCode;

  constructor(code: CoreServiceAvailabilityReadErrorCode) {
    super(MESSAGES[code]);
    this.name = 'CoreServiceAvailabilityReadError';
    this.code = code;
  }
}
