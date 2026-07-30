/**
 * The designated NON-SECRET JSON file adapters (QFJ-S2-E-B, ADR-0065).
 *
 * Two readers, one per artifact, sharing one bounded implementation but exposed as two distinct
 * factories so the containment spec can name each purpose separately:
 *
 *   - {@link createShadowConfigReader}   — the run configuration only;
 *   - {@link createShadowEvidenceReader} — the approval-evidence artifact only.
 *
 * Neither reads a credential. The S2-D-B `credential-file-reader.ts` remains the ONLY file permitted to
 * read credential contents, and this module deliberately does not generalise into a "read any file"
 * helper — a shared secret/non-secret reader is how an owner-only mode check gets bypassed later.
 *
 * Same safety sequence as the credential adapter, and the same honesty about its limits: `lstat` refuses
 * a symlink or non-file, then `fstat` on the OPEN descriptor re-checks type and size. That narrows, and
 * does not eliminate, the TOCTOU window. These are non-secret artifacts, so no mode check is applied.
 */
import { open, lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

/** Bounded: a run config is a few hundred bytes; evidence with a full case set is still small. */
export const MAX_SHADOW_CONFIG_BYTES = 16_384;
export const MAX_SHADOW_EVIDENCE_BYTES = 262_144;

/** Why a non-secret artifact could not be loaded. Closed; never a path or a backend message. */
export type ShadowJsonReadFailure =
  /** The path is relative, the target is a symlink or not a file, or the file is missing/unreadable. */
  | 'unreadable'
  /** The file is larger than the bound, refused before allocation. */
  | 'too-large'
  /** The bytes are not parseable JSON. */
  | 'not-json';

export type ShadowJsonRead =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly failure: ShadowJsonReadFailure };

/** The injected read seam. Specs supply a deterministic fake; production supplies a real file. */
export interface ShadowJsonReader {
  read(): Promise<ShadowJsonRead>;
}

/**
 * One bounded read of one absolute path, parsed as JSON.
 *
 * Every raw filesystem exception is caught and discarded — never inspected for a message, never
 * rethrown, and never permitted to carry the path outward.
 */
function createReader(absoluteFilePath: string, maxBytes: number): ShadowJsonReader {
  return {
    async read(): Promise<ShadowJsonRead> {
      if (typeof absoluteFilePath !== 'string' || !isAbsolute(absoluteFilePath)) {
        return { ok: false, failure: 'unreadable' };
      }
      let link;
      try {
        link = await lstat(absoluteFilePath);
      } catch {
        return { ok: false, failure: 'unreadable' };
      }
      if (link.isSymbolicLink() || !link.isFile()) {
        return { ok: false, failure: 'unreadable' };
      }

      let handle;
      try {
        handle = await open(absoluteFilePath, 'r');
      } catch {
        return { ok: false, failure: 'unreadable' };
      }
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) {
          return { ok: false, failure: 'unreadable' };
        }
        if (stat.size > maxBytes) {
          return { ok: false, failure: 'too-large' };
        }
        const buffer = Buffer.allocUnsafe(stat.size);
        const { bytesRead } = await handle.read(buffer, 0, stat.size, 0);
        const text = buffer.subarray(0, bytesRead).toString('utf8');
        try {
          return { ok: true, value: JSON.parse(text) as unknown };
        } catch {
          // The parser's message can quote the offending content; it is discarded.
          return { ok: false, failure: 'not-json' };
        }
      } catch {
        return { ok: false, failure: 'unreadable' };
      } finally {
        try {
          await handle.close();
        } catch {
          // A close failure cannot change the outcome and must not surface a backend error.
        }
      }
    },
  };
}

/** THE run-configuration reader. Reads the config file and nothing else. */
export function createShadowConfigReader(absoluteFilePath: string): ShadowJsonReader {
  return createReader(absoluteFilePath, MAX_SHADOW_CONFIG_BYTES);
}

/** THE evidence-artifact reader. Reads the evidence file and nothing else. */
export function createShadowEvidenceReader(absoluteFilePath: string): ShadowJsonReader {
  return createReader(absoluteFilePath, MAX_SHADOW_EVIDENCE_BYTES);
}
