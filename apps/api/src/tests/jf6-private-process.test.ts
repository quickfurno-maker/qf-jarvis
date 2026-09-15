import type { RequestListener } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import * as apiRoot from '../index.js';
import {
  JF6_PRIVATE_PROCESS_MODE,
  JF6_PRIVATE_PROCESS_PROTOCOL,
  JF6_PRIVATE_PROCESS_READINESS_PATH,
  Jf6PrivateProcessError,
  createJf6PrivateProcess,
  type Jf6PrivateProcess,
} from '../jf6-private-process/create-private-process.js';

const REVISION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const processes: Jf6PrivateProcess[] = [];

afterEach(async () => {
  await Promise.all(
    processes.splice(0).map(async (process) => process.stop().catch(() => undefined)),
  );
});

function processWith(
  ingress: RequestListener,
  over: Partial<{ host: string; port: number; revision: string }> = {},
) {
  const process = createJf6PrivateProcess({
    ingress,
    host: over.host ?? '127.0.0.1',
    port: over.port ?? 0,
    revision: over.revision ?? REVISION,
  });
  processes.push(process);
  return process;
}
describe('JF-6 private process — inert until explicitly started', () => {
  it('constructs STOPPED, non-authorizing, and preserves the empty API root', () => {
    const process = processWith((_req, res) => res.end());
    expect(process.snapshot()).toEqual({
      protocol: JF6_PRIVATE_PROCESS_PROTOCOL,
      state: 'STOPPED',
      mode: JF6_PRIVATE_PROCESS_MODE,
      productionAuthorizing: false,
      host: '127.0.0.1',
      port: null,
      revision: REVISION,
    });
    expect(Object.keys(apiRoot)).toEqual([]);
  });

  it.each([
    ['public wildcard host', { host: '0.0.0.0' }],
    ['arbitrary private host', { host: '10.0.0.4' }],
    ['bad port', { port: 65_536 }],
    ['bad revision', { revision: 'main' }],
  ])('refuses %s at construction', (_label, over) => {
    expect(() => processWith((_req, res) => res.end(), over)).toThrow(Jf6PrivateProcessError);
  });
});
describe('JF-6 private process — readiness and delegation', () => {
  it('binds loopback, reports truthful non-authorizing readiness, and delegates another route once', async () => {
    let delegated = 0;
    const process = processWith((_req, res) => {
      delegated += 1;
      res.statusCode = 204;
      res.end();
    });
    const ready = await process.start();
    expect(ready.state).toBe('READY');
    expect(ready.productionAuthorizing).toBe(false);
    expect(ready.port).toBeTypeOf('number');

    const base = `http://127.0.0.1:${String(ready.port)}`;
    const response = await fetch(`${base}${JF6_PRIVATE_PROCESS_READINESS_PATH}`, {
      headers: { connection: 'close' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toEqual({
      protocol: JF6_PRIVATE_PROCESS_PROTOCOL,
      status: 'READY',
      mode: JF6_PRIVATE_PROCESS_MODE,
      productionAuthorizing: false,
      revision: REVISION,
    });
    const delegatedResponse = await fetch(`${base}/v1/riya/private`, {
      method: 'POST',
      headers: { connection: 'close' },
    });
    expect(delegatedResponse.status).toBe(204);
    expect(delegated).toBe(1);
  });

  it('refuses a second start and closes cleanly; stop is idempotent', async () => {
    const process = processWith((_req, res) => res.end());
    await process.start();
    await expect(process.start()).rejects.toMatchObject({ code: 'already-started' });

    expect(await process.stop()).toMatchObject({ state: 'STOPPED', port: null });
    expect(await process.stop()).toMatchObject({ state: 'STOPPED', port: null });
  });
});
