import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import {
  createDatabaseConfig,
  type DatabaseConfig,
  type DatabaseConfigInput,
} from '@qf-jarvis/event-backbone';
import { z } from 'zod';

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_SEAL_BYTES = 512 * 1024;
const MAX_CA_BYTES = 256 * 1024;
const SHA40 = /^[0-9a-f]{40}$/u;
const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/u;

const absolutePath = z.string().min(1).max(4096).refine(isAbsolute);
const tlsSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('disabled') }).strict(),
  z.object({ mode: z.literal('verify-full'), caFile: absolutePath }).strict(),
]);
const schema = z
  .object({
    revision: z.string().regex(SHA40),
    sealFile: absolutePath,
    groqCredentialReference: z.string().regex(REF),
    groqCredentialFile: absolutePath,
    database: z
      .object({
        connectionString: z.string().min(1).max(8192),
        maxConnections: z.number().int().min(1).max(50).optional(),
        connectionTimeoutMillis: z.number().int().min(1000).max(60000).optional(),
        idleTimeoutMillis: z.number().int().min(1000).max(300000).optional(),
        statementTimeoutMillis: z.number().int().min(1000).max(300000).optional(),
        tls: tlsSchema,
      })
      .strict(),
    quickfurno: z
      .object({
        baseUrl: z.url().max(2048),
        keyId: z.string().regex(KEY_ID),
        privateKeyPem: z.string().min(1).max(32768),
        timeoutMs: z.number().int().min(100).max(30000).default(5000),
      })
      .strict(),
    spoolDirectory: absolutePath,
    killSwitchFile: absolutePath,
    runtimeId: z.string().regex(REF),
    policyRevision: z.string().regex(REF),
    idlePollMs: z.number().int().min(50).max(60000).default(500),
    staleProcessingMs: z.number().int().min(1000).max(86400000).default(300000),
    maxConcurrentTextTurns: z.number().int().min(1).max(8).default(1),
  })
  .strict();

export interface QuickFurnoWhatsAppProductionWorkerConfig {
  readonly revision: string;
  readonly seal: unknown;
  readonly groqCredentialReference: string;
  readonly groqCredentialFile: string;
  readonly database: DatabaseConfig;
  readonly quickfurno: Readonly<{
    baseUrl: string;
    keyId: string;
    privateKeyPem: string;
    timeoutMs: number;
  }>;
  readonly spoolDirectory: string;
  readonly killSwitchFile: string;
  readonly runtimeId: string;
  readonly policyRevision: string;
  readonly idlePollMs: number;
  readonly staleProcessingMs: number;
  readonly maxConcurrentTextTurns: number;
}

function boundedFile(path: string, maxBytes: number): Buffer {
  const raw = readFileSync(path);
  if (raw.length < 2 || raw.length > maxBytes) throw new Error('production-worker-config-invalid');
  return raw;
}

function parseJsonFile(path: string, maxBytes: number): unknown {
  try {
    return JSON.parse(boundedFile(path, maxBytes).toString('utf8'));
  } catch {
    throw new Error('production-worker-config-invalid');
  }
}

export function loadQuickFurnoWhatsAppProductionWorkerConfig(
  configPath: string,
): QuickFurnoWhatsAppProductionWorkerConfig {
  if (!isAbsolute(configPath)) throw new Error('production-worker-config-invalid');
  const parsed = schema.safeParse(parseJsonFile(configPath, MAX_CONFIG_BYTES));
  if (!parsed.success) throw new Error('production-worker-config-invalid');

  const input = parsed.data;
  let tls: DatabaseConfigInput['tls'];
  if (input.database.tls.mode === 'disabled') {
    tls = { mode: 'disabled' };
  } else {
    let caCertificatePem: string;
    try {
      caCertificatePem = boundedFile(input.database.tls.caFile, MAX_CA_BYTES).toString('utf8');
    } catch {
      throw new Error('production-worker-config-invalid');
    }
    tls = { mode: 'verify-full', caCertificatePem };
  }

  let database: DatabaseConfig;
  try {
    database = createDatabaseConfig({
      connectionString: input.database.connectionString,
      ...(input.database.maxConnections === undefined
        ? {}
        : { maxConnections: input.database.maxConnections }),
      ...(input.database.connectionTimeoutMillis === undefined
        ? {}
        : { connectionTimeoutMillis: input.database.connectionTimeoutMillis }),
      ...(input.database.idleTimeoutMillis === undefined
        ? {}
        : { idleTimeoutMillis: input.database.idleTimeoutMillis }),
      ...(input.database.statementTimeoutMillis === undefined
        ? {}
        : { statementTimeoutMillis: input.database.statementTimeoutMillis }),
      applicationName: 'qf-jarvis-whatsapp-worker',
      tls,
    });
  } catch {
    throw new Error('production-worker-config-invalid');
  }

  const seal = parseJsonFile(input.sealFile, MAX_SEAL_BYTES);
  return Object.freeze({
    revision: input.revision,
    seal,
    groqCredentialReference: input.groqCredentialReference,
    groqCredentialFile: input.groqCredentialFile,
    database,
    quickfurno: Object.freeze({ ...input.quickfurno }),
    spoolDirectory: input.spoolDirectory,
    killSwitchFile: input.killSwitchFile,
    runtimeId: input.runtimeId,
    policyRevision: input.policyRevision,
    idlePollMs: input.idlePollMs,
    staleProcessingMs: input.staleProcessingMs,
    maxConcurrentTextTurns: input.maxConcurrentTextTurns,
  });
}
