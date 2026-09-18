import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createFileDurableTurnSpool } from '../durable-turn-spool.js';
import type { WhatsAppTurnV1 } from '../whatsapp-turn-protocol.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function spoolRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'qfj-turn-spool-'));
  roots.push(root);
  return root;
}

function turn(over: Partial<WhatsAppTurnV1> = {}): WhatsAppTurnV1 {
  return {
    protocol: 'qfj.whatsapp.turn',
    version: 1,
    caller: 'quickfurno-core',
    audience: 'qf-jarvis',
    requestId: '11111111-1111-4111-8111-111111111111',
    issuedAt: '2026-09-18T12:00:00.000Z',
    conversationId: '22222222-2222-4222-8222-222222222222',
    conversationRevision: 4,
    inboundMessageId: '33333333-3333-4333-8333-333333333333',
    receivedAt: '2026-09-18T12:00:00.000Z',
    assignedActor: 'RIYA',
    subjectType: 'client',
    normalizedText: 'sensitive customer sentence',
    ...over,
  };
}
describe('durable WhatsApp turn spool', () => {
  it('fsync-backed record contains only opaque turn references and routing facts', async () => {
    const root = await spoolRoot();
    const spool = await createFileDurableTurnSpool(root);
    const result = await spool.accept(turn(), '2026-09-18T12:00:01.000Z');
    expect(result.outcome).toBe('accepted');
    const files = await readdir(join(root, 'pending'));
    expect(files).toEqual(['33333333-3333-4333-8333-333333333333.json']);
    const pendingFile = files[0];
    if (pendingFile === undefined) throw new Error('pending fixture missing');
    const raw = await readFile(join(root, 'pending', pendingFile), 'utf8');
    expect(raw).not.toContain('sensitive customer sentence');
    expect(raw).not.toContain('normalizedText');
    expect(JSON.parse(raw)).toMatchObject({
      requestId: '11111111-1111-4111-8111-111111111111',
      assignedActor: 'RIYA',
      subjectType: 'client',
    });
  });

  it('converges a duplicate logical turn and rejects changed identity', async () => {
    const root = await spoolRoot();
    const spool = await createFileDurableTurnSpool(root);
    expect((await spool.accept(turn(), '2026-09-18T12:00:01.000Z')).outcome).toBe('accepted');
    expect((await spool.accept(turn(), '2026-09-18T12:00:01.500Z')).outcome).toBe('replay');
    expect(
      (
        await spool.accept(
          turn({ requestId: '44444444-4444-4444-8444-444444444444' }),
          '2026-09-18T12:00:02.000Z',
        )
      ).outcome,
    ).toBe('duplicate');
    expect(
      (await spool.accept(turn({ conversationRevision: 5 }), '2026-09-18T12:00:03.000Z')).outcome,
    ).toBe('conflict');
  });

  it('keeps legacy durable records readable and treats a new request id as a duplicate', async () => {
    const root = await spoolRoot();
    const spool = await createFileDurableTurnSpool(root);
    await writeFile(
      join(root, 'pending', '33333333-3333-4333-8333-333333333333.json'),
      JSON.stringify({
        version: 1,
        conversationId: '22222222-2222-4222-8222-222222222222',
        conversationRevision: 4,
        inboundMessageId: '33333333-3333-4333-8333-333333333333',
        receivedAt: '2026-09-18T12:00:00.000Z',
        assignedActor: 'RIYA',
        subjectType: 'client',
        acceptedAt: '2026-09-18T12:00:01.000Z',
      }),
      'utf8',
    );
    expect(
      (
        await spool.accept(
          turn({ requestId: '44444444-4444-4444-8444-444444444444' }),
          '2026-09-18T12:00:02.000Z',
        )
      ).outcome,
    ).toBe('duplicate');
  });

  it('atomically claims, releases, completes, and retains completion identity', async () => {
    const root = await spoolRoot();
    const spool = await createFileDurableTurnSpool(root);
    await spool.accept(turn(), '2026-09-18T12:00:01.000Z');
    expect((await spool.claimNext())?.inboundMessageId).toBe(turn().inboundMessageId);
    await spool.release(turn().inboundMessageId);
    expect((await spool.claimNext())?.inboundMessageId).toBe(turn().inboundMessageId);
    await spool.complete(turn().inboundMessageId);
    expect(await readdir(join(root, 'completed'))).toEqual([
      '33333333-3333-4333-8333-333333333333.json',
    ]);
    expect(
      (
        await spool.accept(
          turn({ requestId: '44444444-4444-4444-8444-444444444444' }),
          '2026-09-18T12:00:10.000Z',
        )
      ).outcome,
    ).toBe('duplicate');
  });
  it('recovers a stale processing claim without losing the turn', async () => {
    const root = await spoolRoot();
    const spool = await createFileDurableTurnSpool(root);
    await spool.accept(turn(), '2026-09-18T12:00:01.000Z');
    await spool.claimNext();
    const processing = join(root, 'processing', '33333333-3333-4333-8333-333333333333.json');
    const old = new Date('2026-09-18T11:00:00.000Z');
    await utimes(processing, old, old);
    expect(await spool.recoverStale(60_000, Date.parse('2026-09-18T12:00:00.000Z'))).toBe(1);
    expect((await spool.claimNext())?.inboundMessageId).toBe(turn().inboundMessageId);
  });
});
