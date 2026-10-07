import { z } from 'zod';

const keyId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/u);

const publicKeyPem = z
  .string()
  .min(80)
  .max(4096)
  .regex(/-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----/u)
  .refine(
    (value) => !value.includes('PRIVATE KEY'),
    'private key material is forbidden',
  );

export const agniOperatorIngressConfigV1Schema = z
  .object({
    version: z.literal(1),
    verificationKeys: z
      .array(
        z
          .object({
            keyId,
            publicKeyPem,
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.verificationKeys.map((entry) => entry.keyId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'verification key ids must be unique',
        path: ['verificationKeys'],
      });
    }
  });

export type AgniOperatorIngressConfigV1 = z.infer<typeof agniOperatorIngressConfigV1Schema>;
