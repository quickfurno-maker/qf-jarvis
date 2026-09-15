/**
 * JF-6 private process binding.
 *
 * This is the first app module allowed to bind the already-reviewed private Riya ingress. It is
 * deliberately non-authorizing: it chooses no provider, holds no production approval and exposes
 * only a content-free readiness response plus the injected ingress listener.
 */
import { createServer, type RequestListener, type Server } from 'node:http';

export const JF6_PRIVATE_PROCESS_READINESS_PATH = '/internal/jarvis/readiness' as const;
export const JF6_PRIVATE_PROCESS_PROTOCOL = 'qfj.jf6.private-process-readiness.v1' as const;
export const JF6_PRIVATE_PROCESS_MODE = 'INTERNAL_SHADOW' as const;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const REVISION = /^[0-9a-f]{40}$/u;

export type Jf6PrivateProcessState = 'STOPPED' | 'STARTING' | 'READY' | 'STOPPING';
export type Jf6PrivateProcessErrorCode =
  'invalid-config' | 'already-started' | 'listen-failed' | 'stop-failed';

export class Jf6PrivateProcessError extends Error {
  readonly code: Jf6PrivateProcessErrorCode;

  constructor(code: Jf6PrivateProcessErrorCode) {
    super(code);
    this.name = 'Jf6PrivateProcessError';
    this.code = code;
  }
}
export interface Jf6PrivateProcessConfig {
  readonly ingress: RequestListener;
  readonly host: string;
  /** Port 0 is allowed only so an internal/test process can request an ephemeral loopback port. */
  readonly port: number;
  /** Exact Git revision the process claims to serve. */
  readonly revision: string;
}

export interface Jf6PrivateProcessSnapshot {
  readonly protocol: typeof JF6_PRIVATE_PROCESS_PROTOCOL;
  readonly state: Jf6PrivateProcessState;
  readonly mode: typeof JF6_PRIVATE_PROCESS_MODE;
  readonly productionAuthorizing: false;
  readonly host: string;
  readonly port: number | null;
  readonly revision: string;
}

export interface Jf6PrivateProcess {
  start(): Promise<Jf6PrivateProcessSnapshot>;
  stop(): Promise<Jf6PrivateProcessSnapshot>;
  snapshot(): Jf6PrivateProcessSnapshot;
}

function isValidConfig(config: unknown): config is Jf6PrivateProcessConfig {
  if (config === null || typeof config !== 'object') return false;
  const value = config as Partial<Jf6PrivateProcessConfig>;
  return (
    typeof value.ingress === 'function' &&
    typeof value.host === 'string' &&
    LOOPBACK_HOSTS.has(value.host) &&
    typeof value.port === 'number' &&
    Number.isInteger(value.port) &&
    value.port >= 0 &&
    value.port <= 65_535 &&
    typeof value.revision === 'string' &&
    REVISION.test(value.revision)
  );
}

function writeReadiness(
  res: Parameters<RequestListener>[1],
  snapshot: Jf6PrivateProcessSnapshot,
): void {
  const body = JSON.stringify({
    protocol: snapshot.protocol,
    status: snapshot.state,
    mode: snapshot.mode,
    productionAuthorizing: snapshot.productionAuthorizing,
    revision: snapshot.revision,
  });
  res.statusCode = snapshot.state === 'READY' ? 200 : 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Connection', 'close');
  res.setHeader('Content-Length', String(Buffer.byteLength(body, 'utf8')));
  res.end(body);
}
export function createJf6PrivateProcess(config: Jf6PrivateProcessConfig): Jf6PrivateProcess {
  if (!isValidConfig(config)) {
    throw new Jf6PrivateProcessError('invalid-config');
  }

  let state: Jf6PrivateProcessState = 'STOPPED';
  let server: Server | undefined;
  let boundPort: number | null = null;

  const snapshot = (): Jf6PrivateProcessSnapshot =>
    Object.freeze({
      protocol: JF6_PRIVATE_PROCESS_PROTOCOL,
      state,
      mode: JF6_PRIVATE_PROCESS_MODE,
      productionAuthorizing: false as const,
      host: config.host,
      port: boundPort,
      revision: config.revision,
    });

  const start = async (): Promise<Jf6PrivateProcessSnapshot> => {
    if (state !== 'STOPPED') {
      throw new Jf6PrivateProcessError('already-started');
    }
    state = 'STARTING';
    const candidate = createServer((req, res) => {
      if (req.method === 'GET' && req.url === JF6_PRIVATE_PROCESS_READINESS_PATH) {
        writeReadiness(res, snapshot());
        return;
      }
      config.ingress(req, res);
    });
    // Bound the server itself. The ingress separately bounds body size and replay lifetime.
    candidate.requestTimeout = 10_000;
    candidate.headersTimeout = 5_000;
    candidate.keepAliveTimeout = 1_000;
    candidate.maxRequestsPerSocket = 64;

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (): void => {
          candidate.off('listening', onListening);
          reject(new Jf6PrivateProcessError('listen-failed'));
        };
        const onListening = (): void => {
          candidate.off('error', onError);
          resolve();
        };
        candidate.once('error', onError);
        candidate.once('listening', onListening);
        candidate.listen(config.port, config.host);
      });
    } catch {
      state = 'STOPPED';
      boundPort = null;
      throw new Jf6PrivateProcessError('listen-failed');
    }

    const address = candidate.address();
    if (address === null || typeof address === 'string') {
      candidate.close();
      state = 'STOPPED';
      throw new Jf6PrivateProcessError('listen-failed');
    }
    boundPort = address.port;
    server = candidate;
    state = 'READY';
    return snapshot();
  };

  const stop = async (): Promise<Jf6PrivateProcessSnapshot> => {
    if (state === 'STOPPED') return snapshot();
    if (state !== 'READY' || server === undefined) {
      throw new Jf6PrivateProcessError('stop-failed');
    }
    state = 'STOPPING';
    const closing = server;
    try {
      await new Promise<void>((resolve, reject) => {
        closing.close((error) => {
          if (error === undefined) resolve();
          else reject(new Jf6PrivateProcessError('stop-failed'));
        });
      });
    } catch {
      state = 'READY';
      throw new Jf6PrivateProcessError('stop-failed');
    }
    server = undefined;
    boundPort = null;
    state = 'STOPPED';
    return snapshot();
  };

  return Object.freeze({ start, stop, snapshot });
}
