/**
 * Nara credential ingress, exercised against a fake terminal.
 *
 * ### Why this file exists
 *
 * A mutation control removed the caller's TTY check and nothing failed — the masked source's own
 * `isInteractive()` still refused, so the behaviour held by defence in depth while the rule went
 * unasserted. Defence in depth is the right design; an unasserted layer is not. So every refusal below
 * is checked at the layer that owns it.
 *
 * No terminal, no network and no real key: the source is a fake that records what it was asked for.
 */
import { NaraApiKey } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import {
  MAX_NARA_CREDENTIAL_LENGTH,
  MIN_NARA_CREDENTIAL_LENGTH,
  NARA_CREDENTIAL_PROMPT_LABEL,
  readNaraCredential,
} from '../index.js';
import type { MaskedSecretSource } from '../index.js';

/** A fake masked source. Records the label it was shown and how many times it was read. */
function fakeSource(
  value: string | Error,
  interactive = true,
): MaskedSecretSource & { readonly reads: () => number; readonly label: () => string | undefined } {
  const state = { reads: 0, label: undefined as string | undefined };
  return {
    reads: () => state.reads,
    label: () => state.label,
    isInteractive: () => interactive,
    readOnce: (label: string): Promise<string> => {
      state.reads += 1;
      state.label = label;
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    },
  };
}

const VALID = 'nara-abcdefghijklmnopqrstuvwxyz0123456789';

describe('JF-5B Nara credential ingress refuses at every layer that owns a rule', () => {
  it('refuses when the CALLER says it is not a terminal, without reading anything', async () => {
    const source = fakeSource(VALID);
    const result = await readNaraCredential(source, false);
    expect(result).toEqual({ ok: false, failure: 'nara-credential-not-a-tty' });
    // Not read at all: a refusal that had already read the secret would have had it in memory.
    expect(source.reads()).toBe(0);
  });

  it('refuses when the SOURCE says it is not a terminal, even if the caller thought otherwise', async () => {
    // The layer the mutation control found unasserted. Both checks exist and both are now proved.
    const source = fakeSource(VALID, false);
    const result = await readNaraCredential(source, true);
    expect(result).toEqual({ ok: false, failure: 'nara-credential-not-a-tty' });
    expect(source.reads()).toBe(0);
  });

  it('reads ONCE, with a label that names the provider and reveals nothing', async () => {
    const source = fakeSource(VALID);
    const result = await readNaraCredential(source, true);
    expect(result.ok).toBe(true);
    expect(source.reads()).toBe(1);
    expect(source.label()).toBe(NARA_CREDENTIAL_PROMPT_LABEL);
    expect(NARA_CREDENTIAL_PROMPT_LABEL).toContain('hidden');
    expect(NARA_CREDENTIAL_PROMPT_LABEL).not.toContain(VALID);
  });

  it('returns a REDACTING Nara holder, never the plain string', async () => {
    const result = await readNaraCredential(fakeSource(VALID), true);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.key).toBeInstanceOf(NaraApiKey);
    // Every route a secret usually escapes by: string coercion, JSON, and template interpolation.
    expect(String(result.key)).not.toContain(VALID);
    expect(JSON.stringify(result.key)).not.toContain(VALID);
    expect([result.key].join('')).not.toContain(VALID);
    expect(JSON.stringify({ nested: { key: result.key } })).not.toContain(VALID);
  });

  it('refuses empty, too short, too long and non-printable values', async () => {
    for (const [value, failure] of [
      ['', 'nara-credential-empty'],
      ['   ', 'nara-credential-empty'],
      ['short', 'nara-credential-too-short'],
      ['x'.repeat(MAX_NARA_CREDENTIAL_LENGTH + 1), 'nara-credential-too-long'],
      [
        `${'x'.repeat(MIN_NARA_CREDENTIAL_LENGTH)} with space`,
        'nara-credential-invalid-characters',
      ],
      // A control character, by code point. A literal NUL byte in source survives a test run and
      // then breaks the next tool that reads the file.
      [
        `${'x'.repeat(MIN_NARA_CREDENTIAL_LENGTH)}${String.fromCharCode(0)}`,
        'nara-credential-invalid-characters',
      ],
    ] as const) {
      const result = await readNaraCredential(fakeSource(value), true);
      expect(result, failure).toEqual({ ok: false, failure });
    }
  });

  it('discards the underlying error when the source fails, and never surfaces it', async () => {
    // A read error can carry a PARTIAL secret in its message. The failure code is fixed and the
    // original is dropped rather than wrapped.
    const result = await readNaraCredential(
      fakeSource(new Error(`failed while reading ${VALID}`)),
      true,
    );
    expect(result).toEqual({ ok: false, failure: 'nara-credential-source-failed' });
    expect(JSON.stringify(result)).not.toContain(VALID);
  });
});
