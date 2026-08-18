/**
 * CONTENT-FREE measurement of the exact request the candidate path sends (MVP-P2A.2 HF4-R8).
 *
 * ### Why measure before diagnosing
 *
 * S9 and S10 both ended with nine identical HTTP 400s, and both left the same gap: nobody could state
 * how big the request actually was, how deep the schema went, or how many of each construct it
 * carried. Every hypothesis about the 400 was therefore a hypothesis about an unmeasured object.
 *
 * This module measures it. Lengths, byte counts, node counts, depths and field NAMES — never a
 * character of a prompt, a client message, a schema document or a model answer. The numbers are safe
 * to print in a receipt and safe to paste into a provider bug report, which is exactly what Groq's own
 * docs ask for when strict mode returns a 400.
 *
 * ### The one thing it deliberately re-derives
 *
 * `bodyBytesLowCap` / `bodyBytesHighCap` serialise a body with the SAME documented field set the Groq
 * provider sends — `model`, `messages`, `stream`, `n`, `max_completion_tokens`, `response_format` — at
 * two completion caps. That is a measurement of size, not a second request path: nothing here reaches
 * a transport, and a spec pins the field-name set against the provider's own contract so the two
 * cannot drift apart silently.
 */
import type { ModelMessage } from '@qf-jarvis/model-gateway';

/** Everything measured, and nothing that could carry content. */
export interface RequestShapeInventory {
  /** The message ROLES in order. Roles are a closed vocabulary; the contents are never read. */
  readonly roleSequence: readonly string[];
  readonly systemMessageChars: number;
  readonly userMessageChars: number;
  readonly totalMessageChars: number;
  readonly systemMessageBytes: number;
  readonly userMessageBytes: number;
  readonly totalMessageBytes: number;
  readonly projectedSchemaBytes: number;
  readonly projectedSchemaNodes: number;
  readonly anyOfCount: number;
  readonly enumCount: number;
  readonly numericEnumCount: number;
  readonly stringEnumCount: number;
  readonly maxNestingDepth: number;
  readonly bodyBytesLowCap: number;
  readonly bodyBytesHighCap: number;
  /** The body's FIELD NAMES only, sorted. Never a value. */
  readonly bodyFieldNames: readonly string[];
  readonly responseFormatType: string;
  readonly responseFormatStrict: boolean;
  readonly responseFormatName: string;
  readonly stream: boolean;
  readonly n: number;
  readonly model: string;
}

const utf8 = (value: string): number => Buffer.byteLength(value, 'utf8');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walk a projected JSON Schema and count constructs. Reads shape only; retains no value. */
function measureSchema(
  node: unknown,
  depth: number,
  acc: {
    nodes: number;
    anyOf: number;
    enums: number;
    numericEnums: number;
    stringEnums: number;
    maxDepth: number;
  },
): void {
  if (!isRecord(node)) {
    return;
  }
  acc.nodes += 1;
  acc.maxDepth = Math.max(acc.maxDepth, depth);

  if (Array.isArray(node['enum'])) {
    acc.enums += 1;
    const members = node['enum'];
    if (members.every((one) => typeof one === 'number')) {
      acc.numericEnums += 1;
    } else if (members.every((one) => typeof one === 'string')) {
      acc.stringEnums += 1;
    }
  }
  const anyOf = node['anyOf'];
  if (Array.isArray(anyOf)) {
    acc.anyOf += 1;
    for (const branch of anyOf) {
      measureSchema(branch, depth + 1, acc);
    }
  }
  const properties = node['properties'];
  if (isRecord(properties)) {
    for (const value of Object.values(properties)) {
      measureSchema(value, depth + 1, acc);
    }
  }
  const defs = node['$defs'];
  if (isRecord(defs)) {
    for (const value of Object.values(defs)) {
      measureSchema(value, depth + 1, acc);
    }
  }
  if (node['items'] !== undefined) {
    measureSchema(node['items'], depth + 1, acc);
  }
}

/** The two completion caps the R8 canary pairs contrast. Measured, never sent from here. */
export const INVENTORY_LOW_COMPLETION_CAP = 512;

/**
 * Measure one candidate request.
 *
 * `projectedSchema` must be the document that would actually go on the wire — the output of the
 * HF4-R7 projection — because measuring the raw Zod rendering would describe a request this codebase
 * no longer sends.
 */
export function measureRequestShape(args: {
  readonly model: string;
  readonly messages: readonly ModelMessage[];
  readonly projectedSchema: unknown;
  readonly highCompletionCap: number;
  readonly responseFormatName: string;
}): RequestShapeInventory {
  const systemText = args.messages
    .filter((one) => one.role === 'system')
    .map((one) => one.content)
    .join('');
  const userText = args.messages
    .filter((one) => one.role === 'user')
    .map((one) => one.content)
    .join('');
  const allText = args.messages.map((one) => one.content).join('');

  const acc = { nodes: 0, anyOf: 0, enums: 0, numericEnums: 0, stringEnums: 0, maxDepth: 0 };
  measureSchema(args.projectedSchema, 1, acc);

  const schemaJson = JSON.stringify(args.projectedSchema);

  // The documented Groq Chat Completions field set, at both caps. Serialised for SIZE only.
  const bodyAt = (cap: number): Record<string, unknown> => ({
    model: args.model,
    messages: args.messages.map((one) => ({ role: one.role, content: one.content })),
    stream: false,
    n: 1,
    max_completion_tokens: cap,
    response_format: {
      type: 'json_schema',
      json_schema: { name: args.responseFormatName, strict: true, schema: args.projectedSchema },
    },
  });

  const lowBody = bodyAt(INVENTORY_LOW_COMPLETION_CAP);
  const highBody = bodyAt(args.highCompletionCap);

  return Object.freeze({
    roleSequence: Object.freeze(args.messages.map((one) => one.role)),
    systemMessageChars: systemText.length,
    userMessageChars: userText.length,
    totalMessageChars: allText.length,
    systemMessageBytes: utf8(systemText),
    userMessageBytes: utf8(userText),
    totalMessageBytes: utf8(allText),
    projectedSchemaBytes: utf8(schemaJson),
    projectedSchemaNodes: acc.nodes,
    anyOfCount: acc.anyOf,
    enumCount: acc.enums,
    numericEnumCount: acc.numericEnums,
    stringEnumCount: acc.stringEnums,
    maxNestingDepth: acc.maxDepth,
    bodyBytesLowCap: utf8(JSON.stringify(lowBody)),
    bodyBytesHighCap: utf8(JSON.stringify(highBody)),
    bodyFieldNames: Object.freeze(Object.keys(highBody).sort()),
    responseFormatType: 'json_schema',
    responseFormatStrict: true,
    responseFormatName: args.responseFormatName,
    stream: false,
    n: 1,
    model: args.model,
  });
}

/** The MIN/MAX span across a set of measured requests. Proves whether fixture size varies at all. */
export interface RequestShapeSpan {
  readonly count: number;
  readonly systemCharsMin: number;
  readonly systemCharsMax: number;
  readonly userCharsMin: number;
  readonly userCharsMax: number;
  readonly totalCharsMin: number;
  readonly totalCharsMax: number;
  readonly bodyBytesHighCapMin: number;
  readonly bodyBytesHighCapMax: number;
}

export function spanOf(inventories: readonly RequestShapeInventory[]): RequestShapeSpan {
  const pick = (read: (one: RequestShapeInventory) => number): readonly number[] =>
    inventories.map(read);
  const min = (values: readonly number[]): number =>
    values.length === 0 ? 0 : Math.min(...values);
  const max = (values: readonly number[]): number =>
    values.length === 0 ? 0 : Math.max(...values);
  return Object.freeze({
    count: inventories.length,
    systemCharsMin: min(pick((one) => one.systemMessageChars)),
    systemCharsMax: max(pick((one) => one.systemMessageChars)),
    userCharsMin: min(pick((one) => one.userMessageChars)),
    userCharsMax: max(pick((one) => one.userMessageChars)),
    totalCharsMin: min(pick((one) => one.totalMessageChars)),
    totalCharsMax: max(pick((one) => one.totalMessageChars)),
    bodyBytesHighCapMin: min(pick((one) => one.bodyBytesHighCap)),
    bodyBytesHighCapMax: max(pick((one) => one.bodyBytesHighCap)),
  });
}
