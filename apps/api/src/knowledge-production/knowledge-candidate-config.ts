import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import {
  createDatabaseConfig,
  type DatabaseConfig,
  type DatabaseConfigInput,
} from '@qf-jarvis/event-backbone';
import { z } from 'zod';

import type { QuickFurnoKnowledgeApproval } from './quickfurno-production-corpus.js';

const MAX_CONFIG_BYTES = 128 * 1024;
const MAX_CA_BYTES = 256 * 1024;
const MAX_CREDENTIAL_BYTES = 16 * 1024;
const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const MODEL_REF = /^[A-Za-z0-9._:/-]{1,256}$/u;
const absolutePath = z.string().min(1).max(4096).refine(isAbsolute);

const databaseSchema = z
  .object({
    connectionString: z.string().min(1).max(8192),
    maxConnections: z.number().int().min(1).max(20).optional(),
    connectionTimeoutMillis: z.number().int().min(1000).max(60_000).optional(),
    idleTimeoutMillis: z.number().int().min(1000).max(300_000).optional(),
    statementTimeoutMillis: z.number().int().min(1000).max(300_000).optional(),
    tls: z.object({ mode: z.literal('verify-full'), caFile: absolutePath }).strict(),
  })
  .strict();

const embeddingSchema = z.discriminatedUnion('executionClass', [
  z
    .object({
      executionClass: z.literal('HOSTED'),
      endpoint: z.url().max(2048),
      modelRef: z.string().regex(MODEL_REF),
      credentialFile: absolutePath,
      timeoutMs: z.number().int().min(100).max(120_000).default(20_000),
      maxBatchItems: z.number().int().min(1).max(512).default(64),
      maxInputChars: z.number().int().min(1).max(2_000_000).default(64_000),
    })
    .strict(),
  z
    .object({
      executionClass: z.literal('LOCAL'),
      endpoint: z.url().max(2048),
      modelRef: z.string().regex(MODEL_REF),
      timeoutMs: z.number().int().min(100).max(120_000).default(20_000),
      maxBatchItems: z.number().int().min(1).max(512).default(64),
      maxInputChars: z.number().int().min(1).max(2_000_000).default(64_000),
    })
    .strict(),
]);

const schema = z
  .object({
    approval: z
      .object({
        approvedBy: z.string().regex(REF),
        approvedAt: z.string().datetime({ offset: false }),
        approvalRef: z.string().regex(REF),
      })
      .strict(),
    database: databaseSchema,
    embedding: embeddingSchema,
  })
  .strict();

export interface QuickFurnoKnowledgeCandidateConfig {
  readonly approval: QuickFurnoKnowledgeApproval;
  readonly database: DatabaseConfig;
  readonly embedding: Readonly<{
    executionClass: 'HOSTED' | 'LOCAL';
    endpoint: string;
    modelRef: string;
    bearerToken?: string;
    timeoutMs: number;
    maxBatchItems: number;
    maxInputChars: number;
  }>;
}

function boundedFile(path: string, maxBytes: number): Buffer {
  const value = readFileSync(path);
  if (value.length < 2 || value.length > maxBytes) {
    throw new Error('knowledge-candidate-config-invalid');
  }
  return value;
}

function secretText(path: string): string {
  const value = boundedFile(path, MAX_CREDENTIAL_BYTES).toString('utf8').trim();
  if (value.length < 8) throw new Error('knowledge-candidate-config-invalid');
  return value;
}

export function loadQuickFurnoKnowledgeCandidateConfig(
  configPath: string,
): QuickFurnoKnowledgeCandidateConfig {
  if (!isAbsolute(configPath)) throw new Error('knowledge-candidate-config-invalid');

  let raw: unknown;
  try {
    raw = JSON.parse(boundedFile(configPath, MAX_CONFIG_BYTES).toString('utf8'));
  } catch {
    throw new Error('knowledge-candidate-config-invalid');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error('knowledge-candidate-config-invalid');
  const input = parsed.data;

  let tls: DatabaseConfigInput['tls'];
  let database: DatabaseConfig;
  try {
    tls = {
      mode: 'verify-full',
      caCertificatePem: boundedFile(input.database.tls.caFile, MAX_CA_BYTES).toString('utf8'),
    };
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
      applicationName: 'qf-jarvis-knowledge-candidate-builder',
      tls,
    });
  } catch {
    throw new Error('knowledge-candidate-config-invalid');
  }

  let bearerToken: string | undefined;
  try {
    bearerToken =
      input.embedding.executionClass === 'HOSTED'
        ? secretText(input.embedding.credentialFile)
        : undefined;
  } catch {
    throw new Error('knowledge-candidate-config-invalid');
  }

  return Object.freeze({
    approval: Object.freeze({ ...input.approval }),
    database,
    embedding: Object.freeze({
      executionClass: input.embedding.executionClass,
      endpoint: input.embedding.endpoint,
      modelRef: input.embedding.modelRef,
      ...(bearerToken === undefined ? {} : { bearerToken }),
      timeoutMs: input.embedding.timeoutMs,
      maxBatchItems: input.embedding.maxBatchItems,
      maxInputChars: input.embedding.maxInputChars,
    }),
  });
}
