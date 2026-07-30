/**
 * The closed CLI argument parser (QFJ-S2-E-B, ADR-0065).
 *
 * Five flags, all optional-by-command, all absolute paths or exact digests. An unknown flag, a duplicate
 * flag, a missing value, a relative path, or a stray positional is a refusal — a permissive parser is how
 * a run ends up pointed at the wrong file.
 *
 * `argv` is never echoed. The credential PATH is visible in the operating-system process list
 * (`ps`, `/proc/<pid>/cmdline`) — that is a documented limitation, accepted because it is a path rather
 * than a secret and the file's own owner-only mode is the real control. Stdin is not used as a
 * workaround: an interactive secret prompt is the design S2-D-A explicitly rejected.
 */
import { isAbsolute } from 'node:path';

/** The closed flag set. */
const FLAGS = [
  '--config',
  '--evidence',
  '--credential-file',
  '--expected-config-digest',
  '--expected-evidence-digest',
] as const;

type Flag = (typeof FLAGS)[number];

/** Flags whose value must be an absolute filesystem path. */
const PATH_FLAGS: ReadonlySet<Flag> = new Set<Flag>([
  '--config',
  '--evidence',
  '--credential-file',
]);

const DIGEST = /^[0-9a-f]{8,128}$/;

/** Why argv was refused. Closed; never echoes the offending value. */
export type ArgsRefusal =
  | 'args-unknown-flag'
  | 'args-duplicate-flag'
  | 'args-missing-value'
  | 'args-relative-path'
  | 'args-invalid-digest'
  | 'args-unexpected-positional'
  | 'args-missing-required';

export type ParsedShadowArgs = Readonly<Partial<Record<Flag, string>>>;

export type ShadowArgsResult =
  | { readonly ok: true; readonly args: ParsedShadowArgs }
  | { readonly ok: false; readonly reason: ArgsRefusal };

function isFlag(token: string): token is Flag {
  return (FLAGS as readonly string[]).includes(token);
}

/** Parse argv into the closed flag map. `required` names the flags this command demands. */
export function parseShadowArgs(
  argv: readonly string[],
  required: readonly Flag[],
): ShadowArgsResult {
  const args: Partial<Record<Flag, string>> = {};
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) {
      return { ok: false, reason: 'args-unexpected-positional' };
    }
    if (!token.startsWith('--')) {
      return { ok: false, reason: 'args-unexpected-positional' };
    }
    if (!isFlag(token)) {
      return { ok: false, reason: 'args-unknown-flag' };
    }
    if (args[token] !== undefined) {
      return { ok: false, reason: 'args-duplicate-flag' };
    }
    const value = argv[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith('--')) {
      return { ok: false, reason: 'args-missing-value' };
    }
    if (PATH_FLAGS.has(token) && !isAbsolute(value)) {
      return { ok: false, reason: 'args-relative-path' };
    }
    if (!PATH_FLAGS.has(token) && !DIGEST.test(value)) {
      return { ok: false, reason: 'args-invalid-digest' };
    }
    args[token] = value;
    index += 2;
  }
  for (const flag of required) {
    if (args[flag] === undefined) {
      return { ok: false, reason: 'args-missing-required' };
    }
  }
  return { ok: true, args: Object.freeze({ ...args }) };
}
