/**
 * INTERNAL Groq Chat Completions request/response shapes (QFJ-P04.01B, ADR-0046).
 *
 * These are provider-specific and NEVER cross the package boundary — the gateway public contracts stay
 * provider-neutral. The response is validated by a closed zod schema before any field is read; a
 * malformed body is normalized to a safe failure and its raw content never escapes.
 */
import { z } from 'zod';

/** The minimal Groq Chat Completions request body the adapter builds. Non-streaming, one choice. */
export interface GroqChatRequestBody {
  readonly model: string;
  readonly messages: readonly {
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: string;
  }[];
  readonly stream: false;
  readonly n: 1;
  readonly max_completion_tokens: number;
  readonly response_format?:
    | { readonly type: 'json_object' }
    | {
        readonly type: 'json_schema';
        readonly json_schema: {
          readonly name: string;
          readonly strict: boolean;
          readonly schema: unknown;
        };
      };
}

/** The closed schema for a Groq Chat Completions response. Anything else is malformed. */
export const groqChatResponseSchema = z
  .object({
    id: z.string().max(256).optional(),
    model: z.string().max(256).optional(),
    choices: z
      .array(
        z.object({
          index: z.number().optional(),
          message: z.object({
            role: z.string().max(64).optional(),
            content: z.string().max(2_000_000).nullable().optional(),
          }),
          finish_reason: z.string().max(64).nullable().optional(),
        }),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().min(0).optional(),
        completion_tokens: z.number().int().min(0).optional(),
        total_tokens: z.number().int().min(0).optional(),
      })
      .optional(),
  })
  .loose();

export type GroqChatResponse = z.infer<typeof groqChatResponseSchema>;

/** The recognized non-error finish reasons the adapter accepts. */
export const GROQ_ACCEPTED_FINISH_REASONS = ['stop', 'length', 'complete', 'eos'] as const;
