/**
 * Deterministic, **test-only** Ed25519 key material.
 *
 * This file exists to let the tests sign fixtures and then verify them. It is:
 *
 * - **Deterministic** — derived from fixed 32-byte seeds, so every run and every
 *   machine produces byte-identical keys and signatures.
 * - **Test-only** — it lives under `src/tests/`, which the package's production
 *   `tsconfig.json` **excludes from the build**. Nothing here is emitted to `dist/`,
 *   and nothing here is re-exported from the package barrel. A consumer of
 *   `@qf-jarvis/event-ingestion` cannot import, resolve, or run any of it.
 *
 * There is no production private key anywhere in this package — Jarvis verifies with
 * public keys and never signs (ADR-0020 §1). These private keys are a testing device
 * for standing in as "Core" while Core's real emitter does not yet exist.
 */
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

// The fixed ASN.1/DER header for a PKCS#8 Ed25519 private key, immediately followed
// by the 32-byte seed. Prepending this to a seed yields a valid PKCS#8 encoding.
const ED25519_PKCS8_DER_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function privateKeyFromSeedHex(seedHex: string): KeyObject {
  const seed = Buffer.from(seedHex, 'hex');
  if (seed.length !== 32) {
    throw new Error('test Ed25519 seed must be exactly 32 bytes');
  }
  const pkcs8 = Buffer.concat([ED25519_PKCS8_DER_PREFIX, seed]);
  return createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
}

/** An obviously-synthetic fixed seed. TEST ONLY. */
export const TEST_KEY_SEED_HEX = '0101010101010101010101010101010101010101010101010101010101010101';

/** A second, distinct fixed seed, for "wrong key / forgery" tests. TEST ONLY. */
export const ALT_KEY_SEED_HEX = '0202020202020202020202020202020202020202020202020202020202020202';

export const testPrivateKey: KeyObject = privateKeyFromSeedHex(TEST_KEY_SEED_HEX);
export const testPublicKey: KeyObject = createPublicKey(testPrivateKey);

export const altPrivateKey: KeyObject = privateKeyFromSeedHex(ALT_KEY_SEED_HEX);
export const altPublicKey: KeyObject = createPublicKey(altPrivateKey);

/** The test public keys as canonical Base64 of their SPKI DER encoding — the registry input shape. */
export const TEST_PUBLIC_KEY_SPKI_B64: string = testPublicKey
  .export({ format: 'der', type: 'spki' })
  .toString('base64');
export const ALT_PUBLIC_KEY_SPKI_B64: string = altPublicKey
  .export({ format: 'der', type: 'spki' })
  .toString('base64');

/** The test PRIVATE key as PKCS#8 DER Base64 — used only to prove the registry rejects private keys. */
export const TEST_PRIVATE_KEY_PKCS8_B64: string = testPrivateKey
  .export({ format: 'der', type: 'pkcs8' })
  .toString('base64');
