import { z } from 'zod';

export interface RiyaClientProfileContextV1 {
  readonly version: 1;
  readonly isFirstContact: boolean;
  readonly name?: string;
  readonly preferredLanguage?: 'en' | 'hi' | 'hinglish' | 'other';
}

const NAME = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u);

const schema = z
  .object({
    version: z.literal(1),
    isFirstContact: z.boolean(),
    name: NAME.optional(),
    preferredLanguage: z.enum(['en', 'hi', 'hinglish', 'other']).optional(),
  })
  .strict();

export function parseRiyaClientProfileContextV1(
  value: unknown,
): RiyaClientProfileContextV1 {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error('riya-client-profile-context-invalid');
  }
  const data = parsed.data;
  return Object.freeze({
    version: 1 as const,
    isFirstContact: data.isFirstContact,
    ...(data.name === undefined ? {} : { name: data.name }),
    ...(data.preferredLanguage === undefined
      ? {}
      : { preferredLanguage: data.preferredLanguage }),
  });
}