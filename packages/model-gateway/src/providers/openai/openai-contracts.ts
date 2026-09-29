import { z } from 'zod';

export interface OpenAIResponsesRequestBody {
  readonly model: string;
  readonly input: readonly {
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: string;
  }[];
  readonly max_output_tokens: number;
  readonly store: false;
  readonly reasoning: {
    readonly effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  };
  readonly text?: {
    readonly format: {
      readonly type: 'json_schema';
      readonly name: 'qf_jarvis_response';
      readonly strict: true;
      readonly schema: unknown;
    };
  };
}

const responseUsageSchema = z
  .object({
    input_tokens: z.number().int().min(0).optional(),
    output_tokens: z.number().int().min(0).optional(),
    total_tokens: z.number().int().min(0).optional(),
  })
  .loose();

export const openAIResponsesEnvelopeSchema = z
  .object({
    id: z.string().max(256).optional(),
    model: z.string().max(256).optional(),
    status: z.string().max(64),
    output: z.array(z.unknown()).max(4096),
    incomplete_details: z
      .object({ reason: z.string().max(128).nullable().optional() })
      .nullable()
      .optional(),
    usage: responseUsageSchema.optional(),
  })
  .loose();

export type OpenAIOutputExtraction =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly kind: 'refusal' | 'missing-text' | 'malformed-output' };

const outputTextSchema = z
  .object({ type: z.literal('output_text'), text: z.string().max(2_000_000) })
  .loose();

const refusalSchema = z
  .object({ type: z.literal('refusal'), refusal: z.string().max(2_000_000) })
  .loose();

const messageSchema = z
  .object({
    type: z.literal('message'),
    role: z.literal('assistant'),
    content: z.array(z.unknown()).max(4096),
  })
  .loose();

export function extractOpenAIOutputText(output: readonly unknown[]): OpenAIOutputExtraction {
  const chunks: string[] = [];
  for (const item of output) {
    const message = messageSchema.safeParse(item);
    if (!message.success) {
      if (
        typeof item === 'object' &&
        item !== null &&
        (item as Record<string, unknown>)['type'] === 'message'
      ) {
        return { ok: false, kind: 'malformed-output' };
      }
      continue;
    }
    for (const content of message.data.content) {
      const refusal = refusalSchema.safeParse(content);
      if (refusal.success) {
        return { ok: false, kind: 'refusal' };
      }
      const text = outputTextSchema.safeParse(content);
      if (text.success) {
        chunks.push(text.data.text);
        continue;
      }
      return { ok: false, kind: 'malformed-output' };
    }
  }
  return chunks.length === 0
    ? { ok: false, kind: 'missing-text' }
    : { ok: true, text: chunks.join('') };
}
