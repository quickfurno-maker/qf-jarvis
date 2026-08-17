/**
 * The ONE staging credential acceptance rule (MVP-P2A.2 HF4-R5).
 *
 * ### Why this file exists
 *
 * It is the same rule the masked-TTY resolver has always applied, lifted out unchanged so a SECOND
 * ingress can share it rather than restate it. That distinction is the whole point: two ingresses that
 * each own a copy of "what a credential may look like" is two credential policies, and the moment they
 * disagree the narrower one becomes advisory. A value is now accepted by exactly one predicate, and
 * refused with exactly one classification, no matter which door it came through.
 *
 * Nothing about the rule moved. The bounds, the character class and the refusal ordering are
 * byte-for-byte what they were before this module existed, and the masked resolver re-exports the two
 * public constants from here so its own surface is unchanged too.
 *
 * ### It decides, it never reports
 *
 * No function here takes a recorder, a console, or a reference. They read a string and return a verdict
 * or a closed classification token, so nothing in this module can print, store or forward the value it
 * was asked about.
 */
import type { CredentialOutcome } from './diagnostic-telemetry.js';

/** The bounded shape an accepted staging credential must have. No provider prefix is asserted. */
export const MIN_CREDENTIAL_LENGTH = 20;
export const MAX_CREDENTIAL_LENGTH = 200;

const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** The acceptance predicate. Length bounds AND character class, exactly as the TTY ingress had it. */
export function isBoundedCredential(value: string): boolean {
  return (
    value.length >= MIN_CREDENTIAL_LENGTH &&
    value.length <= MAX_CREDENTIAL_LENGTH &&
    CREDENTIAL_PATTERN.test(value)
  );
}

/**
 * Name WHY a value that has ALREADY failed {@link isBoundedCredential} was refused.
 *
 * This decides nothing. Acceptance remains exactly `length >= MIN && length <= MAX && pattern`,
 * byte-for-byte the baseline rule; this only reports which clause of it was the one that said no.
 *
 * The returned token is a closed member of {@link CredentialOutcome}. It describes the SHAPE of the
 * rejected value — never its content, and never any part of it.
 */
export function classifyRejection(value: string): CredentialOutcome {
  if (value.length === 0) {
    return 'rejected-empty';
  }
  if (value.length < MIN_CREDENTIAL_LENGTH) {
    return 'rejected-too-short';
  }
  if (value.length > MAX_CREDENTIAL_LENGTH) {
    return 'rejected-too-long';
  }
  return 'rejected-charset';
}
