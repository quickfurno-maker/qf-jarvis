/**
 * The injected seams the executable needs, and the phase plan it walks.
 *
 * ### Why every one of these is an interface
 *
 * The live run needs a terminal, a network and a filesystem. A test needs none of them. The whole
 * design rests on that split: each capability is one narrow interface, production supplies the real
 * implementation at the process boundary, and a spec supplies a deterministic fake. Nothing in this
 * package reaches a terminal, a socket or a disk by itself, so the entire phase sequence — including
 * every refusal, every ceiling and every ordering rule — is assertable with zero network.
 *
 * ### The phase order is the safety property
 *
 * Preflight before any credential. The typed confirmation before any credential. Groq before Nara.
 * Discovery before selection. Selection before certification. A run that asked for a key and then
 * discovered the output path was wrong would already have the key in memory, so the order below is not
 * a convenience — it is the reason each refusal is cheap.
 */

/** Reads the one typed confirmation from a real terminal. */
export interface ConfirmationReader {
  /** True only when stdin AND stdout are an interactive terminal. */
  isInteractive(): boolean;
  /** Prompt once and return what was typed. Echoed: this is not a secret. */
  readLine(prompt: string): Promise<string>;
}

/** Writes run artifacts. The path has already been checked to resolve outside the repository. */
export interface ArtifactWriter {
  /** Create the run directory tree. Called once, after both gates pass. */
  ensureDirectory(absolutePath: string): void;
  /** Write one file. `relativePath` is joined under the run directory by the implementation. */
  writeFile(relativePath: string, contents: string): void;
  /** The SHA-256 of what was written, for the sanitized receipt. */
  digestOf(relativePath: string): string;
}

/** The repository facts the preflight asserts. Supplied, never discovered by this package. */
export interface RepositoryFacts {
  readonly headSha: string;
  readonly worktreeClean: boolean;
  readonly repositoryRoot: string;
  /** The resolved output directory, already through `realpath`. */
  readonly resolvedOutputDirectory: string;
}

/** Where the operator prints. Separated so a spec reads lines instead of capturing a stream. */
export interface OperatorIo {
  out(line: string): void;
  err(line: string): void;
}

/**
 * The closed phase vocabulary.
 *
 * A run reports the phase it reached, so a failure receipt says WHERE it stopped rather than only that
 * it stopped. `PRECHECK` failing and `CERTIFICATION` failing are very different facts about a run.
 */
export const RUN_PHASES = [
  'PRECHECK',
  'GROQ_CONNECTIVITY',
  'NARA_DISCOVERY',
  'NARA_SELECTION',
  'CERTIFICATION',
  'AUTO_ROUTING',
  'ARTIFACTS',
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

/** Closed exit codes. A distinct code per stop reason, so a person can act without reading a log. */
export const EXIT_CODES = Object.freeze({
  OK: 0,
  GATE_REFUSED: 10,
  PRECHECK_FAILED: 11,
  CREDENTIAL_REFUSED: 12,
  GROQ_CONNECTIVITY_FAILED: 20,
  NARA_DISCOVERY_FAILED: 30,
  NARA_SELECTION_REFUSED: 31,
  CERTIFICATION_FAILED: 40,
  AUTO_ROUTING_FAILED: 50,
  ARTIFACTS_FAILED: 60,
  INVALID_USAGE: 64,
});
export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** What one completed run reports back, content-free. */
export interface RunOutcome {
  readonly phaseReached: RunPhase;
  readonly exitCode: ExitCode;
  /** A closed reason when the run stopped early; absent on a completed run. */
  readonly reason?: string;
  readonly groqCalls: number;
  readonly naraCalls: number;
  readonly manifestDigest?: string;
}
