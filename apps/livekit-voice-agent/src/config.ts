import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

import { z } from 'zod';

const MAX_CONFIG_BYTES = 16 * 1024;
export const VOICE_AGENT_CONFIG_PATH_VAR = 'QFJ_LIVEKIT_VOICE_AGENT_CONFIG_FILE';

const modelRef = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._:/-]+$/u);

export const voiceAgentConfigSchema = z
  .object({
    protocol: z.literal('qfj.livekit.operator-voice-agent.v1'),
    livekit: z
      .object({
        wsUrl: z
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
      .strict(),
    inference: z
      .object({
        sttModel: modelRef,
        language: z
          .string()
          .min(2)
          .max(16)
          .regex(/^[A-Za-z-]+$/u),
        llmModel: modelRef,
        ttsModel: modelRef,
        ttsVoice: z.string().min(1).max(160),
      })
      .strict(),
  })
  .strict();

export type VoiceAgentConfig = z.infer<typeof voiceAgentConfigSchema>;

function readPath(): string {
  const path = process.env[VOICE_AGENT_CONFIG_PATH_VAR];
  if (path === undefined || path.trim() === '')
    throw new TypeError('voice-agent-config-path-unset');
  return path;
}

export function loadVoiceAgentConfig(path = readPath()): VoiceAgentConfig {
  let fd: number | undefined;
  try {
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
    fd = openSync(path, constants.O_RDONLY | noFollow);
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.size > MAX_CONFIG_BYTES) {
      throw new TypeError('voice-agent-config-invalid-file');
    }
    if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
      throw new TypeError('voice-agent-config-permissions-too-open');
    }
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    if (bytes > MAX_CONFIG_BYTES) throw new TypeError('voice-agent-config-too-large');
    const parsed: unknown = JSON.parse(buffer.subarray(0, bytes).toString('utf8'));
    const result = voiceAgentConfigSchema.safeParse(parsed);
    if (!result.success) throw new TypeError('voice-agent-config-invalid');
    return result.data;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError('voice-agent-config-unreadable', { cause: error });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
