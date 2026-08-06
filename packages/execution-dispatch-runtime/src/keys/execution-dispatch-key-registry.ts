import { createPublicKey, type KeyObject } from 'node:crypto';

import { ExecutionDispatchKeyRegistryError } from '../protocol/errors.js';
import {
  decodeCanonicalBase64,
  isValidKeyId,
  parseCanonicalTimestampMs,
} from '../protocol/field-formats.js';
import { EXECUTION_DISPATCH_KEY_PURPOSE } from '../protocol/limits.js';

/**
 * The execution-dispatch public key registry (QFJ-P09.02, ADR-0090).
 *
 * ### Why this is not `@qf-jarvis/event-ingestion`'s registry
 *
 * The most dangerous shortcut available in this phase would have been to import the B1 registry:
 * it already parses SPKI keys, already tracks validity windows, already works. Doing so would have
 * silently unified two trust purposes — a key trusted to sign events Jarvis merely RECORDS would
 * also have authorised dispatches n8n would ACT on. The algorithm being the same is precisely why
 * that is easy to miss.
 *
 * So this registry is separate, and every record must declare
 * `purpose: 'quickfurno-core-to-n8n-execution-dispatch'`. A record carrying any other purpose is a
 * construction error, and a key whose purpose does not match is refused at lookup with its own
 * reason code rather than silently working.
 *
 * ### Construction is strict; lookup is total
 *
 * A contradictory registry is a CALLER defect and throws at construction — an operator wiring keys
 * wrongly should find out immediately, not at the first dispatch. Lookup itself never throws: a
 * missing key is a refusal reason, because an unknown `keyId` is ordinary hostile input.
 *
 * No private key material is accepted, stored or exposed. Only SPKI DER public keys.
 */

/** One key record, as a caller supplies it. */
export interface ExecutionDispatchKeyRecordInput {
  /** Stable identifier the envelope names. */
  readonly keyId: string;
  /** What this key is trusted FOR. Must be the execution-dispatch purpose. */
  readonly purpose: string;
  /** The Ed25519 public key, SPKI DER, canonical Base64. Never a private key. */
  readonly publicKeySpkiBase64: string;
  /** Canonical UTC instant this key becomes valid, inclusive. */
  readonly validFrom: string;
  /** Canonical UTC instant this key stops being valid, exclusive. */
  readonly validUntil: string;
  /** `active` or `revoked`. A revoked key is kept so its past signatures stay explainable. */
  readonly status: 'active' | 'revoked';
}

/** The internal, resolved record. Not exported from the package barrel. */
export interface ExecutionDispatchKeyRecord {
  readonly keyId: string;
  readonly publicKey: KeyObject;
  readonly validFromMs: number;
  readonly validUntilMs: number;
  readonly status: 'active' | 'revoked';
}

export class ExecutionDispatchKeyRegistry {
  readonly #byKeyId: ReadonlyMap<string, ExecutionDispatchKeyRecord>;

  private constructor(byKeyId: ReadonlyMap<string, ExecutionDispatchKeyRecord>) {
    this.#byKeyId = byKeyId;
  }

  /**
   * Build a registry, validating every record.
   *
   * Throws `ExecutionDispatchKeyRegistryError` on any caller defect: a malformed id, a duplicate
   * id, a wrong purpose, an unparseable key, a non-Ed25519 key, a non-canonical instant, or a
   * validity window that is not strictly ordered.
   */
  public static fromRecords(
    records: readonly ExecutionDispatchKeyRecordInput[],
  ): ExecutionDispatchKeyRegistry {
    const resolved = new Map<string, ExecutionDispatchKeyRecord>();

    for (const record of records) {
      if (!isValidKeyId(record.keyId)) {
        throw new ExecutionDispatchKeyRegistryError('key record has an invalid keyId');
      }
      if (resolved.has(record.keyId)) {
        // Two records for one id means lookup is ambiguous, and an ambiguous trust decision is
        // not a trust decision.
        throw new ExecutionDispatchKeyRegistryError(`duplicate keyId: ${record.keyId}`);
      }
      if (record.purpose !== EXECUTION_DISPATCH_KEY_PURPOSE) {
        throw new ExecutionDispatchKeyRegistryError(
          `key ${record.keyId} does not declare the execution-dispatch purpose`,
        );
      }
      // Widened deliberately. The declared type is a two-member union, so TypeScript considers this
      // exhaustive -- but a registry is built from caller-supplied configuration that may have been
      // read from JSON, and an unrecognised status must be a construction error rather than
      // silently falling through as "not revoked".
      const status: string = record.status;
      if (status !== 'active' && status !== 'revoked') {
        throw new ExecutionDispatchKeyRegistryError(`key ${record.keyId} has an unknown status`);
      }

      const validFromMs = parseCanonicalTimestampMs(record.validFrom);
      const validUntilMs = parseCanonicalTimestampMs(record.validUntil);
      if (validFromMs === null || validUntilMs === null) {
        throw new ExecutionDispatchKeyRegistryError(
          `key ${record.keyId} has a non-canonical validity instant`,
        );
      }
      if (validFromMs >= validUntilMs) {
        throw new ExecutionDispatchKeyRegistryError(
          `key ${record.keyId} has a validity window that is not strictly ordered`,
        );
      }

      const der = decodeCanonicalBase64(record.publicKeySpkiBase64);
      if (der === null) {
        throw new ExecutionDispatchKeyRegistryError(
          `key ${record.keyId} public key is not canonical Base64`,
        );
      }

      let publicKey: KeyObject;
      try {
        publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
      } catch {
        // The thrown value may quote the supplied material; it is deliberately not surfaced.
        throw new ExecutionDispatchKeyRegistryError(
          `key ${record.keyId} is not a readable SPKI public key`,
        );
      }
      if (publicKey.asymmetricKeyType !== 'ed25519') {
        throw new ExecutionDispatchKeyRegistryError(`key ${record.keyId} is not an Ed25519 key`);
      }
      if (publicKey.type !== 'public') {
        // Belt and braces: SPKI cannot carry a private key, and this boundary must never hold one.
        throw new ExecutionDispatchKeyRegistryError(`key ${record.keyId} is not a public key`);
      }

      resolved.set(record.keyId, {
        keyId: record.keyId,
        publicKey,
        validFromMs,
        validUntilMs,
        status: record.status,
      });
    }

    return new ExecutionDispatchKeyRegistry(resolved);
  }

  /** Look a key up by id. Never by trial, and never throws: an unknown id is ordinary input. */
  public find(keyId: string): ExecutionDispatchKeyRecord | undefined {
    return this.#byKeyId.get(keyId);
  }

  /** How many keys this registry holds. Useful for a caller asserting its own wiring. */
  public get size(): number {
    return this.#byKeyId.size;
  }
}
