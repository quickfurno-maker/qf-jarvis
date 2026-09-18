import { open, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { WhatsAppTurnV1 } from './whatsapp-turn-protocol.js';

export interface DurableTurnRecordV1 {
  readonly version: 1;
  readonly requestId?: string;
  readonly conversationId: string;
  readonly conversationRevision: number;
  readonly inboundMessageId: string;
  readonly receivedAt: string;
  readonly assignedActor: 'AAROHI' | 'ANISHA' | 'RIYA';
  readonly subjectType: 'unknown' | 'prospect' | 'client' | 'vendor';
  readonly acceptedAt: string;
}

export type TurnAcceptResult =
  | { readonly outcome: 'accepted'; readonly record: DurableTurnRecordV1 }
  | { readonly outcome: 'duplicate'; readonly record: DurableTurnRecordV1 }
  | { readonly outcome: 'replay'; readonly record: DurableTurnRecordV1 }
  | { readonly outcome: 'conflict' };

export interface DurableTurnSpool {
  accept(turn: WhatsAppTurnV1, acceptedAt: string): Promise<TurnAcceptResult>;
  claimNext(): Promise<DurableTurnRecordV1 | null>;
  complete(inboundMessageId: string): Promise<void>;
  fail(inboundMessageId: string): Promise<void>;
  release(inboundMessageId: string): Promise<void>;
  recoverStale(maxAgeMs: number, nowMs: number): Promise<number>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const fileName = (id: string): string => `${id}.json`;
function stableRecord(turn: WhatsAppTurnV1, acceptedAt: string): DurableTurnRecordV1 {
  return Object.freeze({
    version: 1,
    requestId: turn.requestId,
    conversationId: turn.conversationId,
    conversationRevision: turn.conversationRevision,
    inboundMessageId: turn.inboundMessageId,
    receivedAt: turn.receivedAt,
    assignedActor: turn.assignedActor,
    subjectType: turn.subjectType,
    acceptedAt,
  });
}

function sameIdentity(a: DurableTurnRecordV1, b: DurableTurnRecordV1): boolean {
  return (
    a.conversationId === b.conversationId &&
    a.conversationRevision === b.conversationRevision &&
    a.inboundMessageId === b.inboundMessageId &&
    a.receivedAt === b.receivedAt &&
    a.assignedActor === b.assignedActor &&
    a.subjectType === b.subjectType
  );
}

function parseRecord(value: unknown): DurableTurnRecordV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const legacyKeys = [
    'version',
    'conversationId',
    'conversationRevision',
    'inboundMessageId',
    'receivedAt',
    'assignedActor',
    'subjectType',
    'acceptedAt',
  ];
  const currentKeys = [...legacyKeys, 'requestId'];
  const actualKeys = Object.keys(r).sort().join(',');
  if (
    actualKeys !== [...legacyKeys].sort().join(',') &&
    actualKeys !== currentKeys.sort().join(',')
  )
    return null;
  const version = r['version'];
  const requestId = r['requestId'];
  const conversationId = r['conversationId'];
  const conversationRevision = r['conversationRevision'];
  const inboundMessageId = r['inboundMessageId'];
  const receivedAt = r['receivedAt'];
  const assignedActor = r['assignedActor'];
  const subjectType = r['subjectType'];
  const acceptedAt = r['acceptedAt'];
  if (
    version !== 1 ||
    (requestId !== undefined && (typeof requestId !== 'string' || !UUID.test(requestId))) ||
    typeof conversationId !== 'string' ||
    !UUID.test(conversationId) ||
    typeof inboundMessageId !== 'string' ||
    !UUID.test(inboundMessageId) ||
    typeof conversationRevision !== 'number' ||
    !Number.isSafeInteger(conversationRevision) ||
    conversationRevision < 0 ||
    typeof receivedAt !== 'string' ||
    !Number.isFinite(Date.parse(receivedAt)) ||
    typeof acceptedAt !== 'string' ||
    !Number.isFinite(Date.parse(acceptedAt)) ||
    typeof assignedActor !== 'string' ||
    !['AAROHI', 'ANISHA', 'RIYA'].includes(assignedActor) ||
    typeof subjectType !== 'string' ||
    !['unknown', 'prospect', 'client', 'vendor'].includes(subjectType)
  )
    return null;
  return Object.freeze({
    version: 1,
    ...(requestId === undefined ? {} : { requestId }),
    conversationId,
    conversationRevision,
    inboundMessageId,
    receivedAt,
    assignedActor: assignedActor as DurableTurnRecordV1['assignedActor'],
    subjectType: subjectType as DurableTurnRecordV1['subjectType'],
    acceptedAt,
  });
}
async function readRecord(path: string): Promise<DurableTurnRecordV1 | null> {
  try {
    return parseRecord(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
}

export async function createFileDurableTurnSpool(root: string): Promise<DurableTurnSpool> {
  if (!isAbsolute(root)) throw new Error('turn_spool_invalid');
  const pending = join(root, 'pending');
  const processing = join(root, 'processing');
  const completed = join(root, 'completed');
  const failed = join(root, 'failed');
  await mkdir(pending, { recursive: true, mode: 0o700 });
  await mkdir(processing, { recursive: true, mode: 0o700 });
  await mkdir(completed, { recursive: true, mode: 0o700 });
  await mkdir(failed, { recursive: true, mode: 0o700 });

  const existingRecord = async (id: string): Promise<DurableTurnRecordV1 | null> => {
    for (const dir of [pending, processing, completed, failed]) {
      const record = await readRecord(join(dir, fileName(id)));
      if (record) return record;
    }
    return null;
  };

  return Object.freeze({
    async accept(turn: WhatsAppTurnV1, acceptedAt: string): Promise<TurnAcceptResult> {
      const record = stableRecord(turn, acceptedAt);
      const prior = await existingRecord(turn.inboundMessageId);
      if (prior) {
        const same = sameIdentity(prior, record);
        if (same && prior.requestId === turn.requestId) return { outcome: 'replay', record: prior };
        return same ? { outcome: 'duplicate', record: prior } : { outcome: 'conflict' };
      }
      const path = join(pending, fileName(turn.inboundMessageId));
      let handle;
      try {
        handle = await open(path, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(record), 'utf8');
        await handle.sync();
        return { outcome: 'accepted', record };
      } catch (error: unknown) {
        const code = (error as { code?: unknown }).code;
        if (code === 'EEXIST') {
          const converged = await existingRecord(turn.inboundMessageId);
          if (!converged) return { outcome: 'conflict' };
          const same = sameIdentity(converged, record);
          if (same && converged.requestId === turn.requestId) {
            return { outcome: 'replay', record: converged };
          }
          return same ? { outcome: 'duplicate', record: converged } : { outcome: 'conflict' };
        }
        throw error;
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },

    async claimNext(): Promise<DurableTurnRecordV1 | null> {
      const files = (await readdir(pending)).filter((name) => name.endsWith('.json')).sort();
      for (const name of files) {
        const from = join(pending, name);
        const to = join(processing, name);
        try {
          await rename(from, to);
          const record = await readRecord(to);
          if (!record) throw new Error('turn_spool_corrupt');
          return record;
        } catch (error: unknown) {
          const code = (error as { code?: unknown }).code;
          if (code === 'ENOENT' || code === 'EEXIST') continue;
          throw error;
        }
      }
      return null;
    },

    async complete(inboundMessageId: string): Promise<void> {
      await rename(
        join(processing, fileName(inboundMessageId)),
        join(completed, fileName(inboundMessageId)),
      );
    },

    async fail(inboundMessageId: string): Promise<void> {
      await rename(
        join(processing, fileName(inboundMessageId)),
        join(failed, fileName(inboundMessageId)),
      );
    },

    async release(inboundMessageId: string): Promise<void> {
      await rename(
        join(processing, fileName(inboundMessageId)),
        join(pending, fileName(inboundMessageId)),
      );
    },
    async recoverStale(maxAgeMs: number, nowMs: number): Promise<number> {
      if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1_000 || maxAgeMs > 24 * 60 * 60 * 1000) {
        throw new Error('turn_spool_invalid_recovery_window');
      }
      let recovered = 0;
      const files = (await readdir(processing)).filter((name) => name.endsWith('.json')).sort();
      for (const name of files) {
        const from = join(processing, name);
        try {
          const info = await stat(from);
          if (nowMs - info.mtimeMs <= maxAgeMs) continue;
          await rename(from, join(pending, name));
          recovered += 1;
        } catch (error: unknown) {
          if ((error as { code?: unknown }).code !== 'ENOENT') throw error;
        }
      }
      return recovered;
    },
  });
}
