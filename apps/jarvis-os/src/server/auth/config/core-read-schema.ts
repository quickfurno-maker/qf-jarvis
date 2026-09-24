import { z } from 'zod';

const keyId = z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/u);

export const coreReadConfigV1Schema = z.object({
  version: z.literal(1),
  baseUrl: z.string().url().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.username === '' && url.password === '' &&
        (url.pathname === '/' || url.pathname === '') && url.search === '' && url.hash === '';
    } catch {
      return false;
    }
  }, 'must be an HTTPS origin'),
  keyId,
  privateKeyPem: z.string().min(80).max(4096)
    .regex(/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/u),
}).strict();

export type CoreReadConfigV1 = z.infer<typeof coreReadConfigV1Schema>;
