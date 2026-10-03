import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (relative: string): string => readFileSync(`${ROOT}/${relative}`, 'utf8');

const workerConfig = read('apps/api/src/quickfurno-whatsapp/production-worker-config.ts');
const worker = read('apps/api/src/quickfurno-whatsapp/production-worker.ts');
const gateway = read('apps/quickfurno-gateway/src/index.ts');
const spool = read('apps/quickfurno-gateway/src/durable-turn-spool.ts');
const killSwitch = read('apps/api/src/quickfurno-whatsapp/production-kill-switch.ts');
const coreTransport = read('packages/core-decision-http-transport/src/transport.ts');

describe('scale portability contract', () => {
  it('keeps SINGLE_OWNER fail-closed while the production turn store is host-filesystem backed', () => {
    const productionUsesFileSpool =
      worker.includes('createFileDurableTurnSpool(config.spoolDirectory)') ||
      gateway.includes('createFileDurableTurnSpool(spoolPath)');

    if (productionUsesFileSpool) {
      expect(workerConfig).toContain("deploymentMode: z.literal('SINGLE_OWNER')");
    }
  });

  it('keeps durable turn state behind an implementation interface', () => {
    expect(spool).toContain('export interface DurableTurnSpool');
    expect(spool).toContain('accept(turn: WhatsAppTurnV1');
    expect(spool).toContain('claimNext(');
    expect(spool).toContain('recoverStale(');
  });

  it('treats the filesystem kill switch as fail-closed rather than permission-to-run on I/O failure', () => {
    expect(killSwitch).toContain("return (error as { readonly code?: unknown }).code !== 'ENOENT'");
  });

  it('keeps QuickFurno Core service discovery externally configured and signed', () => {
    expect(coreTransport).toContain('readonly baseUrl: string');
    expect(coreTransport).toContain('endpointFor(config.baseUrl)');
    expect(coreTransport).toContain('QUICKFURNO_CORE_DECISION_SIGNATURE_HEADER');
    expect(coreTransport).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
  });

  it('does not hide the current multi-host blockers', () => {
    expect(workerConfig).toContain('readonly spoolDirectory: string');
    expect(workerConfig).toContain('readonly killSwitchFile: string');
    expect(workerConfig).toContain('readonly operationalSnapshotFile: string');
  });
});
