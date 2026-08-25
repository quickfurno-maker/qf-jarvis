/**
 * The JAO-4 virtual artifact sandbox (ADR-0118).
 *
 * ### There is no host filesystem here, and no way to reach one
 *
 * A "sandbox" that wraps a real directory is a sandbox whose safety depends on getting path
 * normalisation, symlink resolution, mount namespaces and race conditions right -- and on getting
 * them right forever, on every platform, against every future edit. This one does not wrap a
 * directory. It wraps a `Map` built from a bundle the caller injected, so there is no host root to
 * escape to, no symlink to follow, no `..` that could resolve anywhere, and no filesystem API in
 * the module at all.
 *
 * `node:fs`, `node:os`, `node:path` and `node:process` are not imported, and a spec asserts that
 * over comment-stripped source. Escaping this sandbox would require inventing a filesystem.
 *
 * ### Read-only by construction
 *
 * The returned object exposes lookup and enumeration and nothing else. There is no `write`, `put`,
 * `delete`, `move` or `mkdir`, so `virtualFilesystem: READ_ONLY` is not a policy anybody enforces
 * -- it is the complete set of things this object can do. Artifacts and the map holding them are
 * frozen, so a tool cannot mutate the bundle it was handed either.
 *
 * Pure: no clock, no network, no filesystem, no environment, no storage, no process.
 */
import {
  Jao4WorkbenchError,
  jao4ArtifactBundleSchema,
  parseJao4PathPrefix,
  parseJao4VirtualPath,
  type Jao4Artifact,
  type Jao4ArtifactBundle,
} from './contracts.js';

/** One artifact plus the measurements the tools report as metadata. */
export interface Jao4SandboxEntry {
  readonly artifact: Jao4Artifact;
  readonly chars: number;
  readonly lines: readonly string[];
}

export interface Jao4ArtifactSandbox {
  readonly bundleId: string;
  /** Every entry, in deterministic path order. Optionally narrowed by a literal path prefix. */
  entries(pathPrefix?: string): readonly Jao4SandboxEntry[];
  /** Exactly one artifact by virtual path. Refuses rather than returning a near miss. */
  lookup(path: string): Jao4SandboxEntry;
  /** Total characters held, so a run can report what it examined without re-reading anything. */
  readonly totalChars: number;
}

/**
 * Split content into lines without a regex over untrusted text.
 *
 * `split('\n')` and a trailing-carriage-return trim: linear, allocation-bounded by the artifact
 * ceiling, and immune to the catastrophic backtracking a line-splitting pattern can suffer on
 * adversarial input. Artifact content is exactly the untrusted string a bad pattern would meet.
 */
function toLines(content: string): readonly string[] {
  return Object.freeze(
    content.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)),
  );
}

/**
 * Build a sandbox over an injected bundle.
 *
 * The bundle is parsed here rather than trusted: it arrives as `unknown` from a caller, and its
 * TypeScript type is gone by the time the tools read it. Every path is re-parsed as well -- the
 * schema already refused a malformed one, and re-parsing means this module's own guarantee does
 * not depend on the schema being the only door in.
 */
export function createJao4ArtifactSandbox(bundle: unknown): Jao4ArtifactSandbox {
  const parsed = jao4ArtifactBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    throw new Jao4WorkbenchError('ARTIFACT_BUNDLE_INVALID');
  }
  const governed: Jao4ArtifactBundle = parsed.data;

  const byPath = new Map<string, Jao4SandboxEntry>();
  let totalChars = 0;
  for (const artifact of governed.artifacts) {
    const path = parseJao4VirtualPath(artifact.path);
    if (byPath.has(path)) {
      // Unreachable through the schema, which already refuses duplicates, and kept because this
      // map is what every lookup resolves against: two artifacts at one path would make "read this
      // path" a guess, and a guess is not evidence.
      throw new Jao4WorkbenchError('ARTIFACT_BUNDLE_INVALID');
    }
    const frozen = Object.freeze({ ...artifact, path });
    byPath.set(
      path,
      Object.freeze({
        artifact: frozen,
        chars: frozen.content.length,
        lines: toLines(frozen.content),
      }),
    );
    totalChars += frozen.content.length;
  }

  // Deterministic order, so a listing is reproducible and two runs over one bundle agree.
  const ordered = Object.freeze(
    [...byPath.values()].sort((left, right) =>
      left.artifact.path < right.artifact.path
        ? -1
        : left.artifact.path > right.artifact.path
          ? 1
          : 0,
    ),
  );

  return Object.freeze({
    bundleId: governed.bundleId,
    totalChars,
    entries(pathPrefix?: string): readonly Jao4SandboxEntry[] {
      if (pathPrefix === undefined) {
        return ordered;
      }
      // Parsed, then used as a LITERAL `startsWith`. It is never split, resolved or joined, so a
      // prefix cannot address anything the bundle does not already contain.
      const prefix = parseJao4PathPrefix(pathPrefix);
      return Object.freeze(ordered.filter((entry) => entry.artifact.path.startsWith(prefix)));
    },
    lookup(path: string): Jao4SandboxEntry {
      const found = byPath.get(parseJao4VirtualPath(path));
      if (found === undefined) {
        // No nearest match, no case-insensitive retry, no fallback. An absent artifact is a stop.
        throw new Jao4WorkbenchError('ARTIFACT_NOT_FOUND');
      }
      return found;
    },
  });
}
