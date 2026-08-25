/**
 * The four JAO-4 tool implementations (ADR-0118).
 *
 * ### What each one may do, and what none of them can
 *
 * List metadata. Read a bounded excerpt. Search for a literal substring. Hash an artifact. That is
 * the entire vocabulary, and it is closed: there is no `shell.exec`, `command.run`, `bash`,
 * `powershell`, `node.eval`, SQL, HTTP fetch, browser navigation or file write anywhere in this
 * slice, and none can be added by a caller because tools are not values a request can carry.
 *
 * Every tool reads from the virtual sandbox and returns a bounded, strictly parsed evidence object.
 * None of them imports a filesystem, a network, a process, an environment or a database -- the only
 * Node built-in used here is `node:crypto`, for SHA-256, which reaches nothing.
 *
 * ### Output is evidence, and evidence is untrusted
 *
 * A tool result describes what was observed in text somebody else wrote. It carries no `authorized`,
 * `approved`, `canExecute`, `businessEffect` or `recommendation` field, because the strict evidence
 * contracts have nowhere to put one. Whatever consumes this later must treat it as data.
 *
 * Pure apart from one hash: no clock, no network, no filesystem, no environment, no storage, no
 * process.
 */
import { createHash } from 'node:crypto';

import {
  JAO4_LIMITS,
  Jao4WorkbenchError,
  jao4DigestEvidenceSchema,
  jao4HashCallSchema,
  jao4ListCallSchema,
  jao4ListEvidenceSchema,
  jao4ReadCallSchema,
  jao4ReadEvidenceSchema,
  jao4SearchCallSchema,
  jao4SearchEvidenceSchema,
  type Jao4Evidence,
  type Jao4ToolDescriptor,
} from './contracts.js';
import type { Jao4ArtifactSandbox, Jao4SandboxEntry } from './artifact-sandbox.js';
import {
  JAO4_HASH_TOOL,
  JAO4_LIST_TOOL,
  JAO4_READ_TOOL,
  JAO4_SEARCH_TOOL,
} from './tool-registry.js';

/** What a tool returns: bounded evidence, and how much artifact text it had to look at. */
export interface Jao4ToolOutput {
  readonly evidence: Jao4Evidence;
  readonly inputCharsExamined: number;
}

/**
 * A tool implementation, carrying its OWN descriptor.
 *
 * The descriptor is on the implementation deliberately: the binding gate compares it to the one the
 * registry authorized, so pairing a well-governed descriptor with a differently-governed
 * implementation is a refusal rather than a silent substitution.
 */
export interface Jao4Tool {
  readonly descriptor: Jao4ToolDescriptor;
  invoke(sandbox: Jao4ArtifactSandbox, call: unknown): Jao4ToolOutput;
}

// Each tool below PARSES its own call against its own schema before touching the sandbox. The
// workbench already parsed the whole request, so this is a second opinion at the tool boundary: a
// tool validates what it was handed rather than reading fields off whatever arrived, and a call
// belonging to a different tool is refused rather than partially understood. Written inline four
// times rather than behind a generic helper, because the helper's only job would be to carry a
// type assertion past the compiler.

/** The size of a result, measured on what will actually be returned. */
export function jao4OutputChars(evidence: Jao4Evidence): number {
  return JSON.stringify(evidence).length;
}

// ---------------------------------------------------------------------------
// artifact.list.v1 -- metadata only.
// ---------------------------------------------------------------------------

function listArtifacts(sandbox: Jao4ArtifactSandbox, raw: unknown): Jao4ToolOutput {
  const parsed = jao4ListCallSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Jao4WorkbenchError('TOOL_INPUT_INVALID');
  }
  const call = parsed.data;
  const entries =
    call.pathPrefix === undefined ? sandbox.entries() : sandbox.entries(call.pathPrefix);
  const evidence = jao4ListEvidenceSchema.parse({
    kind: 'ARTIFACT_LIST',
    // Metadata ONLY. There is no content field on a list entry, so a listing cannot become a read
    // by another name -- which is what a `preview` or `firstLine` convenience field would make it.
    artifacts: entries.map((entry) => ({
      artifactId: entry.artifact.artifactId,
      path: entry.artifact.path,
      contentClass: entry.artifact.contentClass,
      chars: entry.chars,
      lines: entry.lines.length,
    })),
  });
  // Listing examines names and sizes, not text.
  return Object.freeze({ evidence, inputCharsExamined: 0 });
}

// ---------------------------------------------------------------------------
// artifact.read.v1 -- one artifact, one bounded window.
// ---------------------------------------------------------------------------

function readArtifact(sandbox: Jao4ArtifactSandbox, raw: unknown): Jao4ToolOutput {
  const parsed = jao4ReadCallSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Jao4WorkbenchError('TOOL_INPUT_INVALID');
  }
  const call = parsed.data;
  const entry: Jao4SandboxEntry = sandbox.lookup(call.path);
  const startLine = call.startLine ?? 1;
  const maxLines = call.maxLines ?? JAO4_LIMITS.maxReadLinesPerCall;

  const windowLines = entry.lines.slice(startLine - 1, startLine - 1 + maxLines);
  const joined = windowLines.join('\n');
  // Bounded twice over: by the line window the caller asked for, and by the hard character
  // ceiling. `maxChars` is required by the contract, so there is no "read the whole artifact".
  const excerpt = joined.slice(0, call.maxChars);

  const evidence = jao4ReadEvidenceSchema.parse({
    kind: 'ARTIFACT_EXCERPT',
    artifactId: entry.artifact.artifactId,
    path: entry.artifact.path,
    contentClass: entry.artifact.contentClass,
    startLine,
    lineCount: windowLines.length,
    // Stated rather than hidden: a consumer that cannot tell a complete excerpt from a clipped one
    // will eventually reason about the absence of text that was simply cut off.
    truncated:
      excerpt.length < joined.length || startLine - 1 + windowLines.length < entry.lines.length,
    excerpt,
  });
  return Object.freeze({ evidence, inputCharsExamined: entry.chars });
}

// ---------------------------------------------------------------------------
// artifact.search-literal.v1 -- a substring, never a pattern.
// ---------------------------------------------------------------------------

function searchLiteral(sandbox: Jao4ArtifactSandbox, raw: unknown): Jao4ToolOutput {
  const parsed = jao4SearchCallSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Jao4WorkbenchError('TOOL_INPUT_INVALID');
  }
  const call = parsed.data;
  const entries =
    call.pathPrefix === undefined ? sandbox.entries() : sandbox.entries(call.pathPrefix);
  const needle = call.caseSensitive ? call.query : call.query.toLowerCase();

  const matches: { artifactId: string; path: string; line: number; snippet: string }[] = [];
  let examined = 0;
  let truncated = false;

  for (const entry of entries) {
    examined += entry.chars;
    for (const [index, line] of entry.lines.entries()) {
      if (matches.length >= call.maxMatches) {
        truncated = true;
        break;
      }
      // `String.includes` on a literal. There is no RegExp constructed anywhere in this function,
      // and no flags field on the call, so a caller cannot hand the sandbox a small program to run
      // over every artifact -- catastrophic backtracking is a denial of service that looks exactly
      // like a search box.
      const haystack = call.caseSensitive ? line : line.toLowerCase();
      if (!haystack.includes(needle)) {
        continue;
      }
      matches.push({
        artifactId: entry.artifact.artifactId,
        path: entry.artifact.path,
        line: index + 1,
        // The snippet is a bounded slice of the artifact's own text. It is untrusted evidence like
        // everything else the sandbox returns.
        snippet: line.slice(0, JAO4_LIMITS.maxSnippetChars),
      });
    }
    if (matches.length >= call.maxMatches) {
      truncated = true;
      break;
    }
  }

  const evidence = jao4SearchEvidenceSchema.parse({
    kind: 'LITERAL_SEARCH',
    matches,
    matchCount: matches.length,
    truncated,
  });
  return Object.freeze({ evidence, inputCharsExamined: examined });
}

// ---------------------------------------------------------------------------
// artifact.sha256.v1 -- a digest, and no content.
// ---------------------------------------------------------------------------

function hashArtifact(sandbox: Jao4ArtifactSandbox, raw: unknown): Jao4ToolOutput {
  const parsed = jao4HashCallSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Jao4WorkbenchError('TOOL_INPUT_INVALID');
  }
  const call = parsed.data;
  const entry = sandbox.lookup(call.path);
  const digest = createHash('sha256').update(entry.artifact.content, 'utf8').digest('hex');
  const evidence = jao4DigestEvidenceSchema.parse({
    kind: 'ARTIFACT_DIGEST',
    artifactId: entry.artifact.artifactId,
    path: entry.artifact.path,
    sha256: digest,
    chars: entry.chars,
  });
  // No content is returned. Hashing must not quietly become a way to read.
  return Object.freeze({ evidence, inputCharsExamined: entry.chars });
}

// ---------------------------------------------------------------------------
// The implementations, each bound to its descriptor.
// ---------------------------------------------------------------------------

export function createJao4Tools(): Readonly<Record<string, Jao4Tool>> {
  return Object.freeze({
    'artifact.list.v1': Object.freeze({ descriptor: JAO4_LIST_TOOL, invoke: listArtifacts }),
    'artifact.read.v1': Object.freeze({ descriptor: JAO4_READ_TOOL, invoke: readArtifact }),
    'artifact.search-literal.v1': Object.freeze({
      descriptor: JAO4_SEARCH_TOOL,
      invoke: searchLiteral,
    }),
    'artifact.sha256.v1': Object.freeze({ descriptor: JAO4_HASH_TOOL, invoke: hashArtifact }),
  });
}
