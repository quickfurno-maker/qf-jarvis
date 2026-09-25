import { z } from 'zod';

export const liveKitOperatorConfigV1Schema = z
  .object({
    protocol: z.literal('qfj.jarvis-os.livekit.v1'),
    serverUrl: z
      .url()
      .refine((value) => value.startsWith('wss://'), 'wss-required')
      .refine(
        (value) => new URL(value).hostname.endsWith('.livekit.cloud'),
        'livekit-cloud-required',
      ),
    apiKey: z.string().min(3).max(128).regex(/^\S+$/u),
    apiSecret: z.string().min(16).max(256).regex(/^\S+$/u),
    agentName: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._:-]+$/u),
  })
  .strict();

export type LiveKitOperatorConfigV1 = z.infer<typeof liveKitOperatorConfigV1Schema>;
