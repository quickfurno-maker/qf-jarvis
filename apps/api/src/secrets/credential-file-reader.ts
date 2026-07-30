/**
 * THE designated filesystem adapter (QFJ-S2-D-B, ADR-0064 §7).
 *
 * This is the ONLY file in `apps/api` permitted to import `node:fs` — a containment spec enforces that,
 * mirroring the `isDesignatedTransport` idiom `@qf-jarvis/model-gateway` already uses for `fetch`.
 *
 * It reads ONE explicitly configured absolute path and returns its bytes as text, or a closed failure
 * code. It never scans a directory, never accepts a list of paths, never derives a path from the
 * credential reference, and never puts the path, a backend exception, or file metadata into a result.
 *
 * On what the safety sequence does and does not achieve: `lstat` rejects a symlink or non-file, then the
 * file is opened once and `fstat` re-checks type, size and mode ON THE OPEN DESCRIPTOR. That narrows the
 * TOCTOU window between the check and the read — it does not eliminate it, and this module claims no
 * more than that. Kubernetes-style symlinked projected volumes are consequently NOT supported by this
 * first backend; that is deferred.
 */
import { open, lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import type { CredentialFailureCode } from './credential-errors.js';

/**
 * The maximum credential file this adapter will read.
 *
 * Derived, not guessed: `createGroqApiKey` bounds a key at 512 characters, and a file mount may append
 * one terminal `CRLF`. Anything larger is refused from `fstat` BEFORE a byte is allocated.
 */
export const MAX_CREDENTIAL_FILE_BYTES = 514;

/** Permission bits that must be clear on POSIX: any group or other access at all. */
const FORBIDDEN_POSIX_BITS = 0o077;

/** The bounded result of one read. Text or a closed code — never a path, message, or metadata. */
export type CredentialFileRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: CredentialFailureCode };

/**
 * The injected read seam.
 *
 * Production uses {@link createNodeCredentialFileReader}. Specs inject a deterministic fake so the
 * binding's laziness, single-flight and refresh behaviour can be exercised without a real filesystem —
 * the real reader is separately covered against synthetic temporary files.
 */
export interface CredentialFileReader {
  read(): Promise<CredentialFileRead>;
}

/**
 * Whether POSIX mode bits are a meaningful security control on this platform.
 *
 * On Windows they are synthetic — Node reports something like `0o666` regardless of the real ACL — so
 * enforcing them there would reject every file while proving nothing. The check is skipped, and this
 * module does NOT claim Windows mode bits provide equivalent protection. `process.platform` is a
 * platform predicate, not configuration; no environment variable is read anywhere in this slice.
 */
function posixModeBitsAreMeaningful(): boolean {
  return process.platform !== 'win32';
}

/** True iff a POSIX mode grants any group or other permission. */
export function modeIsGroupOrOtherAccessible(mode: number): boolean {
  return (mode & FORBIDDEN_POSIX_BITS) !== 0;
}

/**
 * The production reader for ONE absolute path.
 *
 * Every failure collapses to a closed code: a missing file is `credential-not-found`; a relative path,
 * a symlink, a directory, an oversized file, and every raw filesystem exception are
 * `credential-unavailable`. The raw error is caught and discarded — it is never inspected for a message,
 * never rethrown, and never allowed to carry the path outward.
 */
export function createNodeCredentialFileReader(absoluteFilePath: string): CredentialFileReader {
  return {
    async read(): Promise<CredentialFileRead> {
      // An absolute path is required: a relative one resolves against an ambient working directory,
      // which is exactly the sort of invisible input this boundary exists to refuse.
      if (typeof absoluteFilePath !== 'string' || !isAbsolute(absoluteFilePath)) {
        return { ok: false, code: 'credential-unavailable' };
      }

      // 1. lstat WITHOUT following: a symlink is refused rather than resolved.
      let link;
      try {
        link = await lstat(absoluteFilePath);
      } catch {
        // ENOENT and everything else are indistinguishable to a caller by design; only the closed
        // "not found" case is worth separating, and it is separated here without quoting the path.
        return { ok: false, code: 'credential-not-found' };
      }
      if (link.isSymbolicLink() || !link.isFile()) {
        return { ok: false, code: 'credential-unavailable' };
      }

      let handle;
      try {
        handle = await open(absoluteFilePath, 'r');
      } catch {
        return { ok: false, code: 'credential-unavailable' };
      }

      try {
        // 2. fstat on the OPEN DESCRIPTOR — the same object that will be read, which is what narrows
        //    (not closes) the window between checking and reading.
        const stat = await handle.stat();
        if (!stat.isFile()) {
          return { ok: false, code: 'credential-unavailable' };
        }
        if (posixModeBitsAreMeaningful() && modeIsGroupOrOtherAccessible(stat.mode)) {
          return { ok: false, code: 'credential-unavailable' };
        }
        // 3. Bound BEFORE allocating. An oversized file is refused, not truncated — a truncated
        //    credential would be a silently wrong one.
        if (stat.size > MAX_CREDENTIAL_FILE_BYTES) {
          return { ok: false, code: 'credential-unavailable' };
        }

        const buffer = Buffer.allocUnsafe(stat.size);
        const { bytesRead } = await handle.read(buffer, 0, stat.size, 0);
        return { ok: true, text: buffer.subarray(0, bytesRead).toString('utf8') };
      } catch {
        return { ok: false, code: 'credential-unavailable' };
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
