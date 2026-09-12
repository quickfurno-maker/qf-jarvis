/**
 * Which part of the reply the schema refused, and why (JF-5B-R8).
 *
 * ### The gap
 *
 * `ModelGateway.validateOutput` runs `request.structuredSchema.safeParse(output.value)` and, on failure,
 * returns `{ ok: false, code: 'structured-output-invalid' }`. The rejected value and every Zod issue —
 * path, code, expectation — are discarded at that line. Run-10 produced three such rows and there is no
 * way to tell, from the evidence, whether a required field was missing, a closed enum was violated, or
 * the whole envelope was the wrong shape.
 *
 * ### What this may say
 *
 * A PATH and a CODE. `reply.reasonCode:invalid_type`. `evolution.observations.sets.0.field:invalid_value`.
 *
 * Never `issue.message`, which is prose Zod composes about the value. Never `expected` or `received`,
 * which quote it. Never the value itself. A path segment is a schema field name — it comes from the
 * governed schema we wrote, not from the model — and an issue code is one of Zod's closed tokens. A
 * numeric index inside a path is an array position, which is structure, not content.
 *
 * At most eight unique entries, because the purpose is to name the shape of a failure and a model that
 * returned the wrong envelope entirely can produce dozens of issues that all say the same thing.
 *
 * ### What it may decide
 *
 * Nothing. This runs only AFTER the real gateway has already returned `structured-output-invalid`, and
 * it re-parses with the SAME schema purely to read the error it threw away. The outcome is fixed before
 * this function is called, and a spec proves that calling it changes no record field.
 */
import type { ZodType } from 'zod';

/** What the diagnostic says when there is nothing to say. Never an empty list, which reads as "no issues". */
export const SCHEMA_ISSUES_UNAVAILABLE = 'SCHEMA_ISSUES_UNAVAILABLE';

/** The ceiling on reported issues. Eight names a shape; eighty names a tantrum. */
export const MAX_SCHEMA_ISSUES = 8;

/** A path segment is a schema field name or an array index. Anything else is not rendered. */
function renderPath(path: readonly PropertyKey[]): string {
  const segments = path.map((segment) =>
    typeof segment === 'number' ? String(segment) : typeof segment === 'string' ? segment : '?',
  );
  return segments.length === 0 ? '(root)' : segments.join('.');
}

/**
 * Up to {@link MAX_SCHEMA_ISSUES} unique `path:code` tokens for a value the schema refuses.
 *
 * Returns an empty array when the value PASSES — which would mean the gateway and this diagnostic
 * disagree, and an empty result is the honest way to say so rather than inventing an issue.
 */
export function schemaIssueTokens(schema: ZodType, value: unknown): readonly string[] {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return Object.freeze([]);
  }
  const seen = new Set<string>();
  for (const issue of parsed.error.issues) {
    // PATH and CODE. `issue.message`, `expected` and `received` are never read.
    seen.add(`${renderPath(issue.path)}:${issue.code}`);
    if (seen.size >= MAX_SCHEMA_ISSUES) {
      break;
    }
  }
  return Object.freeze([...seen]);
}

/** The sanitized suffix an operator reads, or the unavailable token. Never an empty string. */
export function renderSchemaIssues(tokens: readonly string[] | undefined): string {
  if (tokens === undefined || tokens.length === 0) {
    return `schemaIssues=${SCHEMA_ISSUES_UNAVAILABLE}`;
  }
  return `schemaIssues=${tokens.join(',')}`;
}
