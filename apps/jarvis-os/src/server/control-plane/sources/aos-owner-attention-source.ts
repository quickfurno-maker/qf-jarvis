import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import {
  parseAosOwnerAttentionObservation,
  type AosOwnerAttentionObservation,
} from '@qf-jarvis/aos-intelligence';

const MAX_FILE_BYTES = 64 * 1024;
const MAX_STALENESS_MS = 30 * 60 * 1_000;

export type AosOwnerAttentionObservationRead =
  | {
      readonly status: 'AVAILABLE';
      readonly observation: AosOwnerAttentionObservation;
    }
  | {
      readonly status: 'NOT_CONNECTED' | 'STALE' | 'UNUSABLE';
    };

export async function readAosOwnerAttentionObservation(
  filePath: string | undefined,
  nowMs: number = Date.now(),
): Promise<AosOwnerAttentionObservationRead> {
  if (filePath === undefined) {
    return Object.freeze({ status: 'NOT_CONNECTED' as const });
  }
  if (!isAbsolute(filePath) || !Number.isFinite(nowMs) || nowMs < 0) {
    return Object.freeze({ status: 'UNUSABLE' as const });
  }

  let raw: string;
  try {
    raw = await readFile(filePath, { encoding: 'utf8' });
  } catch {
    return Object.freeze({ status: 'NOT_CONNECTED' as const });
  }
  if (raw.length < 2 || raw.length > MAX_FILE_BYTES) {
    return Object.freeze({ status: 'UNUSABLE' as const });
  }

  let observation: AosOwnerAttentionObservation;
  try {
    observation = parseAosOwnerAttentionObservation(JSON.parse(raw));
  } catch {
    return Object.freeze({ status: 'UNUSABLE' as const });
  }

  const emittedAt = Date.parse(observation.emittedAt);
  if (!Number.isFinite(emittedAt) || emittedAt > nowMs + 1_000) {
    return Object.freeze({ status: 'UNUSABLE' as const });
  }
  if (nowMs - emittedAt > MAX_STALENESS_MS) {
    return Object.freeze({ status: 'STALE' as const });
  }
  return Object.freeze({ status: 'AVAILABLE' as const, observation });
}
