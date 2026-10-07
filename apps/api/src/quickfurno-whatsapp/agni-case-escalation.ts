import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';

const PATH = '/v2/cases/ingest';
const PROTOCOL = 'agni.m2m.http.v1';
const SIGNING_DOMAIN = 'agni.m2m.http.sig.v1';
const CLIENT = 'qf-jarvis-os';
const MACHINE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;

export interface AgniCaseEscalationInput {
  readonly conversationId: string;
  readonly runId: string;
}

export interface AgniCaseEscalationPort {
  escalateVendor(input: AgniCaseEscalationInput): Promise<void>;
}

export type AgniCaseHttpPost = (
  url: string,
  init: Readonly<{
    method: 'POST';
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
    redirect: 'error';
  }>,
) => Promise<{ readonly status: number; text(): Promise<string> }>;

export interface AgniCaseEscalationConfig {
  readonly baseUrl: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly timeoutMs: number;
  readonly httpPost: AgniCaseHttpPost;
}

function digest(raw: Uint8Array): string {
  return createHash('sha256').update(raw).digest('base64url');
}

function deterministicCaseId(value: string): string {
  const bytes = Buffer.from(createHash('sha256').update(value, 'utf8').digest().subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function signedHeaders(input: {
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly requestId: string;
  readonly issuedAt: string;
  readonly deadlineAt: string;
  readonly rawBody: Uint8Array;
}): Readonly<Record<string, string>> {
  const key = createPrivateKey(input.privateKeyPem);
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('agni-case-key-invalid');
  }
  const signing = [
    SIGNING_DOMAIN,
    PROTOCOL,
    'POST',
    PATH,
    CLIENT,
    input.requestId,
    input.issuedAt,
    input.deadlineAt,
    input.keyId,
    digest(input.rawBody),
  ].join('\n');
  return Object.freeze({
    'x-agni-protocol': PROTOCOL,
    'x-agni-client': CLIENT,
    'x-agni-request-id': input.requestId,
    'x-agni-issued-at': input.issuedAt,
    'x-agni-deadline-at': input.deadlineAt,
    'x-agni-key-id': input.keyId,
    'x-agni-signature': sign(null, Buffer.from(signing, 'utf8'), key).toString('base64url'),
    'content-type': 'application/json',
  });
}

export function createAgniCaseEscalationPort(
  config: AgniCaseEscalationConfig,
): AgniCaseEscalationPort {
  const url = new URL(config.baseUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !MACHINE.test(config.keyId) ||
    !Number.isSafeInteger(config.timeoutMs) ||
    config.timeoutMs < 100 ||
    config.timeoutMs > 30_000
  ) {
    throw new TypeError('agni-case-config-invalid');
  }

  return Object.freeze({
    async escalateVendor(input: AgniCaseEscalationInput) {
      if (!MACHINE.test(input.conversationId) || !MACHINE.test(input.runId)) {
        throw new TypeError('agni-case-input-invalid');
      }

      const caseId = deterministicCaseId(
        ['ANISHA', input.conversationId, input.runId, 'VENDOR_ESCALATION_REQUIRED'].join(':'),
      );
      const sourceRef = ['jarvis-conversation', input.conversationId].join(':');
      const evidenceRef = 'jarvis-run:' + input.runId;
      const body = JSON.stringify({
        protocol: 'qf.owner.case.v1',
        caseId,
        sourceSystem: 'JARVIS',
        sourceRef,
        subjectType: 'VENDOR',
        domain: 'VENDOR_SUPPORT',
        severity: 'WARNING',
        summaryCode: 'VENDOR_ESCALATION_REQUIRED',
        evidenceRefs: [evidenceRef],
      });
      const rawBody = Buffer.from(body, 'utf8');
      const requestId = randomUUID();
      const issuedAt = new Date();
      const deadlineAt = new Date(issuedAt.getTime() + config.timeoutMs);
      const response = await config.httpPost(new URL(PATH, url).toString(), {
        method: 'POST',
        headers: signedHeaders({
          keyId: config.keyId,
          privateKeyPem: config.privateKeyPem,
          requestId,
          issuedAt: issuedAt.toISOString(),
          deadlineAt: deadlineAt.toISOString(),
          rawBody,
        }),
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > 64 * 1024) {
        throw new Error('agni-case-response-too-large');
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error('agni-case-refused');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new Error('agni-case-response-invalid');
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        (parsed as Record<string, unknown>)['protocol'] !== 'qf.owner.case.response.v1' ||
        (parsed as Record<string, unknown>)['caseId'] !== caseId
      ) {
        throw new Error('agni-case-response-invalid');
      }
    },
  });
}
