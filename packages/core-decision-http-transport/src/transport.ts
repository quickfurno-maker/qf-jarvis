import { createHash, createPrivateKey, sign } from 'node:crypto';

import type { CoreDecisionTransport } from '@qf-jarvis/core-decision-adapter';

export const QUICKFURNO_CORE_DECISION_METHOD = 'POST' as const;
export const QUICKFURNO_CORE_DECISION_PATH = '/api/internal/jarvis/core-decision' as const;
export const QUICKFURNO_CORE_DECISION_CALLER = 'qf-jarvis' as const;
export const QUICKFURNO_CORE_DECISION_AUDIENCE = 'quickfurno-core' as const;
export const QUICKFURNO_CORE_DECISION_SIGNING_DOMAIN = 'qfj.core.decision.http.sig.v1' as const;
export const QUICKFURNO_CORE_DECISION_KEY_ID_HEADER = 'x-qfj-key-id' as const;
export const QUICKFURNO_CORE_DECISION_SIGNATURE_HEADER = 'x-qfj-signature' as const;

const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/u;
const MAX_COMMAND_BYTES = 32_768;
const MAX_RESPONSE_BYTES = 65_536;
const DEFAULT_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;

export interface QuickFurnoCoreHttpResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type QuickFurnoCoreHttpPost = (
  url: string,
  init: Readonly<{
    method: typeof QUICKFURNO_CORE_DECISION_METHOD;
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
    redirect: 'error';
  }>,
) => Promise<QuickFurnoCoreHttpResponse>;

export interface QuickFurnoCoreTransportConfig {
  readonly baseUrl: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly timeoutMs?: number;
  readonly httpPost?: QuickFurnoCoreHttpPost;
}

export type QuickFurnoCoreTransportErrorCode =
  'invalid-config' | 'invalid-command' | 'request-failed' | 'response-invalid';

export class QuickFurnoCoreTransportError extends Error {
  readonly code: QuickFurnoCoreTransportErrorCode;

  constructor(code: QuickFurnoCoreTransportErrorCode) {
    super(code);
    this.name = 'QuickFurnoCoreTransportError';
    this.code = code;
  }
}

interface CommandIdentity {
  readonly commandId: string;
  readonly createdAt: string;
}

function parseCommandIdentity(serializedCommand: string): CommandIdentity {
  if (
    typeof serializedCommand !== 'string' ||
    serializedCommand.length < 2 ||
    Buffer.byteLength(serializedCommand, 'utf8') > MAX_COMMAND_BYTES
  ) {
    throw new QuickFurnoCoreTransportError('invalid-command');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedCommand);
  } catch {
    throw new QuickFurnoCoreTransportError('invalid-command');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QuickFurnoCoreTransportError('invalid-command');
  }
  const record = parsed as Record<string, unknown>;
  const commandId = record['commandId'];
  const createdAt = record['createdAt'];
  if (
    typeof commandId !== 'string' ||
    commandId.length < 1 ||
    commandId.length > 256 ||
    typeof createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt))
  ) {
    throw new QuickFurnoCoreTransportError('invalid-command');
  }
  return Object.freeze({ commandId, createdAt });
}

function endpointFor(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new QuickFurnoCoreTransportError('invalid-config');
  }
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname !== '/'
  ) {
    throw new QuickFurnoCoreTransportError('invalid-config');
  }
  return new URL(QUICKFURNO_CORE_DECISION_PATH, url).toString();
}

function validateConfig(config: QuickFurnoCoreTransportConfig): Readonly<{
  endpoint: string;
  keyId: string;
  privateKey: ReturnType<typeof createPrivateKey>;
  timeoutMs: number;
  httpPost: QuickFurnoCoreHttpPost;
}> {
  if (
    !KEY_ID.test(config.keyId) ||
    typeof config.privateKeyPem !== 'string' ||
    !config.privateKeyPem.includes('PRIVATE KEY')
  ) {
    throw new QuickFurnoCoreTransportError('invalid-config');
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new QuickFurnoCoreTransportError('invalid-config');
  }
  let privateKey: ReturnType<typeof createPrivateKey>;
  try {
    privateKey = createPrivateKey(config.privateKeyPem);
  } catch {
    throw new QuickFurnoCoreTransportError('invalid-config');
  }
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
    throw new QuickFurnoCoreTransportError('invalid-config');
  }
  const httpPost: QuickFurnoCoreHttpPost =
    config.httpPost ??
    (async (url, init) =>
      fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: init.signal,
        redirect: init.redirect,
      }));
  return Object.freeze({
    endpoint: endpointFor(config.baseUrl),
    keyId: config.keyId,
    privateKey,
    timeoutMs,
    httpPost,
  });
}

export function rawQuickFurnoCoreBodyDigest(rawBody: Uint8Array): string {
  return createHash('sha256').update(rawBody).digest('base64url');
}

export function quickFurnoCoreSigningInput(
  args: Readonly<{
    commandId: string;
    createdAt: string;
    keyId: string;
    bodyDigest: string;
  }>,
): string {
  return [
    QUICKFURNO_CORE_DECISION_SIGNING_DOMAIN,
    QUICKFURNO_CORE_DECISION_METHOD,
    QUICKFURNO_CORE_DECISION_PATH,
    QUICKFURNO_CORE_DECISION_CALLER,
    QUICKFURNO_CORE_DECISION_AUDIENCE,
    args.commandId,
    args.createdAt,
    args.keyId,
    args.bodyDigest,
  ].join('\n');
}

export function createQuickFurnoCoreTransport(
  config: QuickFurnoCoreTransportConfig,
): CoreDecisionTransport {
  const validated = validateConfig(config);
  return Object.freeze({
    async send(serializedCommand: string): Promise<string> {
      const identity = parseCommandIdentity(serializedCommand);
      const raw = Buffer.from(serializedCommand, 'utf8');
      const signingInput = quickFurnoCoreSigningInput({
        commandId: identity.commandId,
        createdAt: identity.createdAt,
        keyId: validated.keyId,
        bodyDigest: rawQuickFurnoCoreBodyDigest(raw),
      });
      const signature = sign(
        null,
        Buffer.from(signingInput, 'utf8'),
        validated.privateKey,
      ).toString('base64url');
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, validated.timeoutMs);
      try {
        const response = await validated.httpPost(validated.endpoint, {
          method: QUICKFURNO_CORE_DECISION_METHOD,
          redirect: 'error',
          signal: controller.signal,
          headers: Object.freeze({
            'content-type': 'application/json',
            [QUICKFURNO_CORE_DECISION_KEY_ID_HEADER]: validated.keyId,
            [QUICKFURNO_CORE_DECISION_SIGNATURE_HEADER]: signature,
          }),
          body: serializedCommand,
        });
        if (response.status !== 200) {
          throw new QuickFurnoCoreTransportError('request-failed');
        }
        const body = await response.text();
        if (
          Buffer.byteLength(body, 'utf8') < 2 ||
          Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES
        ) {
          throw new QuickFurnoCoreTransportError('response-invalid');
        }
        return body;
      } catch (error) {
        if (error instanceof QuickFurnoCoreTransportError) throw error;
        throw new QuickFurnoCoreTransportError('request-failed');
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
