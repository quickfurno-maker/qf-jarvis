/**
 * The sanitized smoke report (QFJ-S1A, ADR-0061 §H).
 *
 * This is the ONLY thing the harness ever writes to a terminal, and it is built from a closed field list
 * — not by serializing a result object, because serializing is how a field nobody meant to print gets
 * printed. It carries the sanitized reason code, the reference identifiers, the prompt family/version,
 * the counters, and the numeric latency/token counters.
 *
 * It never carries: the credential, the credential REFERENCE value, an `Authorization` header, prompt
 * text, model output, a raw body/header/error, PII, subject/client/vendor data, or chain-of-thought.
 * The timestamp is injected rather than read, so the function is pure and the output is deterministic.
 */
import type { SmokeRunResult } from './run-once.js';

/** Render the outcome as deterministic `key=value` lines. Pure: no clock, no I/O, no mutation. */
export function formatSanitizedSmokeResult(result: SmokeRunResult, timestampIso: string): string {
  const references = result.references;
  const lines: string[] = [
    'qfj-groq-staging-smoke',
    `timestamp=${timestampIso}`,
    `outcome=${result.ok ? 'PASS' : 'FAIL'}`,
    `reason=${result.reason}`,
    `releaseId=${references.releaseId}`,
    `providerId=${references.providerId}`,
    `modelId=${references.modelId}`,
    `modelVersion=${references.modelVersion}`,
    `configDigest=${references.configDigest}`,
    `capabilityProfileRef=${references.capabilityProfileRef}`,
    `evaluationRef=${references.evaluationRef}`,
    `dataControlsAttestationRef=${references.dataControlsAttestationRef}`,
    `promptFamily=${references.promptFamily}`,
    `promptVersion=${String(references.promptVersion)}`,
    `schemaRevision=${references.schemaRevision}`,
  ];

  if (!result.ok) {
    if (result.bindReason !== undefined) {
      lines.push(`bindReason=${result.bindReason}`);
    }
    if (result.retryable !== undefined) {
      lines.push(`retryable=${String(result.retryable)}`);
    }
  } else {
    lines.push(`latencyMs=${String(result.latencyMs)}`);
    lines.push(`inputTokens=${String(result.usage.inputTokens ?? 0)}`);
    lines.push(`outputTokens=${String(result.usage.outputTokens ?? 0)}`);
    lines.push(`totalTokens=${String(result.usage.totalTokens ?? 0)}`);
  }

  lines.push(`binds=${String(result.counters.binds)}`);
  lines.push(`credentialReads=${String(result.counters.credentialReads)}`);
  lines.push(`invocations=${String(result.counters.invocations)}`);
  lines.push(`timersArmed=${String(result.counters.timersArmed)}`);
  lines.push(`timersCleared=${String(result.counters.timersCleared)}`);
  lines.push('modelOutput=DISCARDED');
  lines.push('authority=QUICKFURNO_CORE');

  return lines.join('\n');
}

/** Render a pre-run refusal (a bad argv or a rejected configuration) with no reference set available. */
export function formatSanitizedPreRunFailure(reason: string, timestampIso: string): string {
  return ['qfj-groq-staging-smoke', `timestamp=${timestampIso}`, 'outcome=FAIL', `reason=${reason}`]
    .join('\n')
    .concat('\nmodelOutput=NONE\nauthority=QUICKFURNO_CORE');
}
