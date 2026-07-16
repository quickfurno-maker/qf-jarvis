/**
 * Test-only helpers for building the registry's configuration-record input.
 */
import {
  PublicKeyRegistry,
  type PublicKeyConfigRecord,
  type RegistryEnvironment,
} from '../../index.js';
import { TEST_PUBLIC_KEY_SPKI_B64 } from './test-keys.js';

export const TEST_KEY_ID = 'test-core-key-a';
export const ALT_KEY_ID = 'test-core-key-b';
export const VALID_FROM = '2026-01-01T00:00:00.000Z';
export const VALID_UNTIL = '2027-01-01T00:00:00.000Z';

/** A valid config record for the primary test key, with optional overrides. */
export function testConfigRecord(
  overrides: Partial<PublicKeyConfigRecord> = {},
): PublicKeyConfigRecord {
  return {
    keyId: TEST_KEY_ID,
    publicKeySpkiDerBase64: TEST_PUBLIC_KEY_SPKI_B64,
    status: 'active',
    purpose: 'core-to-jarvis-event',
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL,
    ...overrides,
  };
}

/** A registry holding the primary test key (with optional overrides), for the given environment. */
export function testRegistry(
  overrides: Partial<PublicKeyConfigRecord> = {},
  environment: RegistryEnvironment = 'test',
): PublicKeyRegistry {
  return new PublicKeyRegistry([testConfigRecord(overrides)], environment);
}
