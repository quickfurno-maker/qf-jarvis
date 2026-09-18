import { createHash, verify } from 'node:crypto';
import type { VerificationKey } from './protocol.js';

export const WHATSAPP_TURN_PATH = '/internal/v1/quickfurno/whatsapp-turn' as const;
export const WHATSAPP_TURN_METHOD = 'POST' as const;
export const WHATSAPP_TURN_PROTOCOL = 'qfj.whatsapp.turn' as const;
export const WHATSAPP_TURN_VERSION = 1 as const;
export const WHATSAPP_TURN_SIGNING_DOMAIN = 'qfj.whatsapp.turn.http.sig.v1' as const;
export const WHATSAPP_TURN_CALLER = 'quickfurno-core' as const;
export const WHATSAPP_TURN_AUDIENCE = 'qf-jarvis' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{80,128}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export interface WhatsAppTurnV1 {
  readonly protocol: typeof WHATSAPP_TURN_PROTOCOL;
  readonly version: 1;
  readonly caller: typeof WHATSAPP_TURN_CALLER;
  readonly audience: typeof WHATSAPP_TURN_AUDIENCE;
  readonly requestId: string;
  readonly issuedAt: string;
  readonly conversationId: string;
  readonly conversationRevision: number;
  readonly inboundMessageId: string;
  readonly receivedAt: string;
  readonly assignedActor: 'AAROHI' | 'ANISHA' | 'RIYA';
  readonly subjectType: 'unknown' | 'prospect' | 'client' | 'vendor';
  readonly normalizedText?: string;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function parseWhatsAppTurn(value: unknown): WhatsAppTurnV1 | null {
  if (!isRecord(value)) return null;
  const required = [
    'protocol',
    'version',
    'caller',
    'audience',
    'requestId',
    'issuedAt',
    'conversationId',
    'conversationRevision',
    'inboundMessageId',
    'receivedAt',
    'assignedActor',
    'subjectType',
  ];
  const allowed = [...required, 'normalizedText'];
  if (
    !Object.keys(value).every((key) => allowed.includes(key)) ||
    !required.every((key) => key in value)
  )
    return null;

  const protocol = value['protocol'];
  const version = value['version'];
  const caller = value['caller'];
  const audience = value['audience'];
  const requestId = value['requestId'];
  const issuedAt = value['issuedAt'];
  const conversationId = value['conversationId'];
  const conversationRevision = value['conversationRevision'];
  const inboundMessageId = value['inboundMessageId'];
  const receivedAt = value['receivedAt'];
  const assignedActor = value['assignedActor'];
  const subjectType = value['subjectType'];
  const normalizedText = value['normalizedText'];

  if (
    protocol !== WHATSAPP_TURN_PROTOCOL ||
    version !== 1 ||
    caller !== WHATSAPP_TURN_CALLER ||
    audience !== WHATSAPP_TURN_AUDIENCE
  )
    return null;
  if (typeof requestId !== 'string' || !UUID.test(requestId)) return null;
  if (
    typeof issuedAt !== 'string' ||
    !INSTANT.test(issuedAt) ||
    !Number.isFinite(Date.parse(issuedAt))
  )
    return null;
  if (typeof conversationId !== 'string' || !UUID.test(conversationId)) return null;
  if (typeof inboundMessageId !== 'string' || !UUID.test(inboundMessageId)) return null;
  if (
    typeof conversationRevision !== 'number' ||
    !Number.isSafeInteger(conversationRevision) ||
    conversationRevision < 0
  )
    return null;
  if (
    typeof receivedAt !== 'string' ||
    !INSTANT.test(receivedAt) ||
    !Number.isFinite(Date.parse(receivedAt))
  )
    return null;
  if (typeof assignedActor !== 'string' || !['AAROHI', 'ANISHA', 'RIYA'].includes(assignedActor))
    return null;
  if (
    typeof subjectType !== 'string' ||
    !['unknown', 'prospect', 'client', 'vendor'].includes(subjectType)
  )
    return null;
  if (
    normalizedText !== undefined &&
    (typeof normalizedText !== 'string' || normalizedText.length > 4096)
  )
    return null;

  return Object.freeze({
    protocol: WHATSAPP_TURN_PROTOCOL,
    version: 1,
    caller: WHATSAPP_TURN_CALLER,
    audience: WHATSAPP_TURN_AUDIENCE,
    requestId,
    issuedAt,
    conversationId,
    conversationRevision,
    inboundMessageId,
    receivedAt,
    assignedActor: assignedActor as WhatsAppTurnV1['assignedActor'],
    subjectType: subjectType as WhatsAppTurnV1['subjectType'],
    ...(normalizedText === undefined ? {} : { normalizedText }),
  });
}
function digest(rawBody: Uint8Array): string {
  return createHash('sha256').update(rawBody).digest('base64url');
}

export function whatsAppTurnSigningInput(args: {
  readonly requestId: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly bodyDigest: string;
}): string {
  return [
    WHATSAPP_TURN_SIGNING_DOMAIN,
    WHATSAPP_TURN_METHOD,
    WHATSAPP_TURN_PATH,
    WHATSAPP_TURN_CALLER,
    WHATSAPP_TURN_AUDIENCE,
    args.requestId,
    args.issuedAt,
    args.keyId,
    args.bodyDigest,
  ].join('\n');
}

export function verifyWhatsAppTurnSignature(args: {
  readonly rawBody: Uint8Array;
  readonly turn: WhatsAppTurnV1;
  readonly keyId: string | null;
  readonly signature: string | null;
  readonly verificationKeys: readonly VerificationKey[];
  readonly nowMs: number;
  readonly maxClockSkewMs: number;
}): boolean {
  if (!args.keyId || !KEY_ID.test(args.keyId) || !args.signature || !SIGNATURE.test(args.signature))
    return false;
  const issuedMs = Date.parse(args.turn.issuedAt);
  if (!Number.isFinite(issuedMs) || Math.abs(args.nowMs - issuedMs) > args.maxClockSkewMs)
    return false;
  const configured = args.verificationKeys.find((key) => key.keyId === args.keyId);
  if (!configured) return false;
  let signature: Buffer;
  try {
    signature = Buffer.from(args.signature, 'base64url');
  } catch {
    return false;
  }
  if (signature.length !== 64) return false;
  return verify(
    null,
    Buffer.from(
      whatsAppTurnSigningInput({
        requestId: args.turn.requestId,
        issuedAt: args.turn.issuedAt,
        keyId: args.keyId,
        bodyDigest: digest(args.rawBody),
      }),
      'utf8',
    ),
    configured.publicKey,
    signature,
  );
}
