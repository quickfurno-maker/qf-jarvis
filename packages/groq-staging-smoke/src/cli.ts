/**
 * The harness command surface (QFJ-S1A, ADR-0061 §C).
 *
 * The executable accepts EXACTLY ONE argument pair: `--config <path>`. Nothing else is accepted — not a
 * key, not a prompt, not a model id, not an endpoint, not a verbosity flag. That is deliberate: every
 * additional accepted argument is another place a secret could be typed onto a command line and into a
 * shell history file. An unexpected argument is refused WITHOUT being echoed, because the reason it is
 * unexpected may be that it is a key.
 *
 * This module holds no composition root of its own — the real transport, terminal, clock, and timer are
 * injected by `bin.ts`, so the whole command path is testable without a terminal or a network.
 */
import { loadSmokeConfig } from './config.js';
import {
  formatSanitizedPreRunFailure,
  formatSanitizedSmokeResult,
} from './format-sanitized-result.js';
import { runGroqStagingSmokeOnce, type SmokeRunDeps } from './run-once.js';

/** The parsed argv. On failure the offending token is discarded, never returned or printed. */
export type SmokeArgvResult =
  | { readonly ok: true; readonly configPath: string }
  | { readonly ok: false; readonly reason: 'smoke-config-invalid' };

/** Parse the harness argument list. Pure — reads no process state. */
export function parseSmokeArgv(argv: readonly string[]): SmokeArgvResult {
  if (argv.length !== 2 || argv[0] !== '--config') {
    return { ok: false, reason: 'smoke-config-invalid' };
  }
  const configPath = argv[1];
  if (configPath === undefined || configPath.length === 0 || configPath.startsWith('-')) {
    return { ok: false, reason: 'smoke-config-invalid' };
  }
  return { ok: true, configPath };
}

/** Where the sanitized report goes, and what "now" is. Both injected so the CLI stays deterministic. */
export interface SmokeCliIo {
  write(line: string): void;
  nowIso(): string;
}

/** The process exit code: 0 for a completed probe, 1 for a refused run, 2 for a refused input. */
export type SmokeExitCode = 0 | 1 | 2;

/**
 * Run the command end to end: parse argv, load and validate the configuration, run the single smoke,
 * print the sanitized report, and return an exit code. It never throws and never retries.
 */
export async function runSmokeCli(
  argv: readonly string[],
  io: SmokeCliIo,
  deps: SmokeRunDeps,
): Promise<SmokeExitCode> {
  const parsedArgv = parseSmokeArgv(argv);
  if (!parsedArgv.ok) {
    io.write(formatSanitizedPreRunFailure(parsedArgv.reason, io.nowIso()));
    return 2;
  }

  const loaded = loadSmokeConfig(parsedArgv.configPath);
  if (!loaded.ok) {
    io.write(formatSanitizedPreRunFailure(loaded.reason, io.nowIso()));
    return 2;
  }

  const result = await runGroqStagingSmokeOnce(loaded.config, deps);
  io.write(formatSanitizedSmokeResult(result, io.nowIso()));
  return result.ok ? 0 : 1;
}
