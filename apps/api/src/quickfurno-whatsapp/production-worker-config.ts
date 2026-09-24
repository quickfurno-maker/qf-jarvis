import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import {
  createDatabaseConfig,
  type DatabaseConfig,
  type DatabaseConfigInput,
} from '@qf-jarvis/event-backbone';
import type { AgentHybridKnowledgeSearchPolicy } from '@qf-jarvis/jarvis-runtime';
import { z } from 'zod';

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_SEAL_BYTES = 512 * 1024;
const MAX_CA_BYTES = 256 * 1024;
const MAX_PRIVATE_KEY_BYTES = 32 * 1024;
const MAX_EMBEDDING_CREDENTIAL_BYTES = 16 * 1024;
const SHA40 = /^[0-9a-f]{40}$/u;
const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/u;
const MODEL_REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

const absolutePath = z.string().min(1).max(4096).refine(isAbsolute);
const searchPolicySchema = z
  .object({
    topicFilters: z.array(z.string().regex(REF)).max(32),
    candidatePool: z.number().int().min(1).max(256),
    maxResults: z.number().int().min(1).max(8),
    maxContentChars: z.number().int().min(256).max(4096),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.maxResults > value.candidatePool ||
      new Set(value.topicFilters).size !== value.topicFilters.length
    ) {
      ctx.addIssue({ code: 'custom', message: 'invalid hybrid search bounds' });
    }
  });

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

const databaseSchema = z
  .object({
    connectionString: z.string().min(1).max(8192),
    maxConnections: z.number().int().min(1).max(50).optional(),
    connectionTimeoutMillis: z.number().int().min(1000).max(60_000).optional(),
    idleTimeoutMillis: z.number().int().min(1000).max(300_000).optional(),
    statementTimeoutMillis: z.number().int().min(1000).max(300_000).optional(),
    tls: z.object({ mode: z.literal('verify-full'), caFile: absolutePath }).strict(),
  })
  .strict();

const knowledgeSchema = z.union([
  z.object({ mode: z.literal('DISABLED') }).strict(),
  z
    .object({
      mode: z.literal('HYBRID').default('HYBRID'),
      revision: z
        .string()
        .regex(REF)
        .refine((value) => value.toLowerCase() !== 'latest'),
      embedding: embeddingSchema,
      agents: z
        .object({
          RIYA: searchPolicySchema,
          ANISHA: searchPolicySchema,
          AAROHI: searchPolicySchema,
        })
        .strict(),
    })
    .strict(),
]);

const schema = z
  .object({
    revision: z.string().regex(SHA40),
    deploymentMode: z.literal('SINGLE_OWNER'),
    sealFile: absolutePath,
    groqCredentialReference: z.string().regex(REF),
    groqCredentialFile: absolutePath,
    database: databaseSchema.optional(),
    quickfurno: z
      .object({
        baseUrl: z.url().max(2048),
        keyId: z.string().regex(KEY_ID),
        privateKeyFile: absolutePath,
        timeoutMs: z.number().int().min(100).max(30_000).default(5000),
      })
      .strict(),
    knowledge: knowledgeSchema,
    spoolDirectory: absolutePath,
    killSwitchFile: absolutePath,
    operationalSnapshotFile: absolutePath,
    runtimeId: z.string().regex(REF),
    policyRevision: z.string().regex(REF),
    idlePollMs: z.number().int().min(50).max(60_000).default(500),
    staleProcessingMs: z.number().int().min(1000).max(86_400_000).default(300_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.knowledge.mode === 'HYBRID' && value.database === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['database'],
        message: 'hybrid knowledge needs database',
      });
    }
    if (value.knowledge.mode === 'DISABLED' && value.database !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['database'],
        message: 'disabled knowledge must not carry database configuration',
      });
    }
  });

export interface QuickFurnoWhatsAppProductionWorkerConfig {
  readonly revision: string;
  readonly deploymentMode: 'SINGLE_OWNER';
  readonly seal: unknown;
  readonly groqCredentialReference: string;
  readonly groqCredentialFile: string;
  readonly database?: DatabaseConfig;
  readonly quickfurno: Readonly<{
    baseUrl: string;
    keyId: string;
    privateKeyPem: string;
    timeoutMs: number;
  }>;
  readonly knowledge:
    | Readonly<{ mode: 'DISABLED' }>
    | Readonly<{
        mode: 'HYBRID';
        revision: string;
        embedding: Readonly<{
          executionClass: 'HOSTED' | 'LOCAL';
          endpoint: string;
          modelRef: string;
          bearerToken?: string;
          timeoutMs: number;
          maxBatchItems: number;
          maxInputChars: number;
        }>;
        agents: Readonly<Record<'RIYA' | 'ANISHA' | 'AAROHI', AgentHybridKnowledgeSearchPolicy>>;
      }>;
  readonly spoolDirectory: string;
  readonly killSwitchFile: string;
  readonly operationalSnapshotFile: string;
  readonly runtimeId: string;
  readonly policyRevision: string;
  readonly idlePollMs: number;
  readonly staleProcessingMs: number;
}

function boundedFile(path: string, maxBytes: number): Buffer {
  const raw = readFileSync(path);
  if (raw.length < 2 || raw.length > maxBytes) throw new Error('production-worker-config-invalid');
  return raw;
}

function secretText(path: string, maxBytes: number): string {
  const value = boundedFile(path, maxBytes).toString('utf8').trim();
  if (value.length < 2) throw new Error('production-worker-config-invalid');
  return value;
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

  let privateKeyPem: string;
  try {
    privateKeyPem = secretText(input.quickfurno.privateKeyFile, MAX_PRIVATE_KEY_BYTES);
  } catch {
    throw new Error('production-worker-config-invalid');
  }

  let database: DatabaseConfig | undefined;
  let knowledge: QuickFurnoWhatsAppProductionWorkerConfig['knowledge'];
  if (input.knowledge.mode === 'DISABLED') {
    knowledge = Object.freeze({ mode: 'DISABLED' as const });
  } else {
    if (input.database === undefined) throw new Error('production-worker-config-invalid');

    let tls: DatabaseConfigInput['tls'];
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
        applicationName: 'qf-jarvis-whatsapp-worker',
        tls,
      });
    } catch {
      throw new Error('production-worker-config-invalid');
    }

    let bearerToken: string | undefined;
    try {
      bearerToken =
        input.knowledge.embedding.executionClass === 'HOSTED'
          ? secretText(input.knowledge.embedding.credentialFile, MAX_EMBEDDING_CREDENTIAL_BYTES)
          : undefined;
    } catch {
      throw new Error('production-worker-config-invalid');
    }
    const embedding = input.knowledge.embedding;
    knowledge = Object.freeze({
      mode: 'HYBRID' as const,
      revision: input.knowledge.revision,
      embedding: Object.freeze({
        executionClass: embedding.executionClass,
        endpoint: embedding.endpoint,
        modelRef: embedding.modelRef,
        ...(bearerToken === undefined ? {} : { bearerToken }),
        timeoutMs: embedding.timeoutMs,
        maxBatchItems: embedding.maxBatchItems,
        maxInputChars: embedding.maxInputChars,
      }),
      agents: Object.freeze({
        RIYA: Object.freeze({ ...input.knowledge.agents.RIYA }),
        ANISHA: Object.freeze({ ...input.knowledge.agents.ANISHA }),
        AAROHI: Object.freeze({ ...input.knowledge.agents.AAROHI }),
      }),
    });
  }

  const seal = parseJsonFile(input.sealFile, MAX_SEAL_BYTES);
  return Object.freeze({
    revision: input.revision,
    deploymentMode: input.deploymentMode,
    seal,
    groqCredentialReference: input.groqCredentialReference,
    groqCredentialFile: input.groqCredentialFile,
    ...(database === undefined ? {} : { database }),
    quickfurno: Object.freeze({
      baseUrl: input.quickfurno.baseUrl,
      keyId: input.quickfurno.keyId,
      privateKeyPem,
      timeoutMs: input.quickfurno.timeoutMs,
    }),
    knowledge,
    spoolDirectory: input.spoolDirectory,
    killSwitchFile: input.killSwitchFile,
    operationalSnapshotFile: input.operationalSnapshotFile,
    runtimeId: input.runtimeId,
    policyRevision: input.policyRevision,
    idlePollMs: input.idlePollMs,
    staleProcessingMs: input.staleProcessingMs,
  });
}
