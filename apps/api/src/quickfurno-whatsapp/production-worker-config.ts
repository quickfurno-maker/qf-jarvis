import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import {
  createDatabaseConfig,
  type DatabaseConfig,
  type DatabaseConfigInput,
} from '@qf-jarvis/event-backbone';
import type { AgentHybridKnowledgeSearchPolicy } from '@qf-jarvis/jarvis-runtime';
import { createTypeSafeApiKey, type TypeSafeApiKey } from '@qf-jarvis/jev-decision-adapter';
import { z } from 'zod';

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_SEAL_BYTES = 512 * 1024;
const MAX_CA_BYTES = 256 * 1024;
const MAX_PRIVATE_KEY_BYTES = 32 * 1024;
const MAX_EMBEDDING_CREDENTIAL_BYTES = 16 * 1024;
const MAX_JEV_CREDENTIAL_BYTES = 16 * 1024;
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

const turnStoreSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('FILE'), directory: absolutePath }).strict(),
  z.object({ mode: z.literal('POSTGRES') }).strict(),
]);

const concurrencySchema = z
  .object({
    globalMaxConcurrentTurns: z.number().int().min(1).max(200),
    maxConcurrentByAgent: z
      .object({
        RIYA: z.number().int().min(1).max(200),
        ANISHA: z.number().int().min(1).max(200),
        AAROHI: z.number().int().min(1).max(200),
      })
      .strict(),
    modelGateway: z
      .object({
        maxConcurrent: z.number().int().min(1).max(200),
        maxQueue: z.number().int().min(0).max(400),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const laneCapacity =
      value.maxConcurrentByAgent.RIYA +
      value.maxConcurrentByAgent.ANISHA +
      value.maxConcurrentByAgent.AAROHI;
    if (value.globalMaxConcurrentTurns > laneCapacity) {
      ctx.addIssue({ code: 'custom', message: 'global concurrency exceeds agent-lane capacity' });
    }
    if (
      value.modelGateway.maxConcurrent + value.modelGateway.maxQueue <
      value.globalMaxConcurrentTurns
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'model gateway cannot absorb admitted chat capacity',
      });
    }
  });

const decisionIntelligenceSchema = z.union([
  z.object({ mode: z.literal('DISABLED') }).strict(),
  z
    .object({
      mode: z.literal('SHADOW'),
      model: z.string().regex(MODEL_REF),
      credentialFile: absolutePath,
      timeoutMs: z.number().int().min(50).max(5_000).default(1_200),
      minConfidence: z.number().min(0).max(1).default(0.7),
      maxConcurrent: z.number().int().min(1).max(32).default(8),
    })
    .strict(),
]);

const semanticCacheSchema = z.union([
  z.object({ mode: z.literal('DISABLED') }).strict(),
  z
    .object({
      mode: z.literal('PUBLIC_KNOWLEDGE_ONLY'),
      maxEntries: z.number().int().min(1).max(10_000).default(2_000),
      threshold: z.number().min(0.9).max(1).default(0.97),
      publicTopics: z.array(z.string().regex(REF)).min(1).max(256),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (new Set(value.publicTopics).size !== value.publicTopics.length) {
        ctx.addIssue({ code: 'custom', message: 'semantic cache topics must be unique' });
      }
    }),
]);

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
      semanticCache: semanticCacheSchema.default({ mode: 'DISABLED' }),
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
    sealFile: absolutePath.optional(),
    groqCredentialReference: z.string().regex(REF).optional(),
    groqCredentialFile: absolutePath.optional(),
    openai: z
      .object({
        sealFile: absolutePath,
        credentialReference: z.string().regex(REF),
        credentialFile: absolutePath,
      })
      .strict()
      .optional(),
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
    decisionIntelligence: decisionIntelligenceSchema.default({ mode: 'DISABLED' }),
    concurrency: concurrencySchema,
    // spoolDirectory is the legacy SINGLE_OWNER file-spool field. New deployments
    // use turnStore; keeping this optional preserves existing config compatibility.
    spoolDirectory: absolutePath.optional(),
    turnStore: turnStoreSchema.optional(),
    killSwitchFile: absolutePath,
    operationalSnapshotFile: absolutePath,
    agentFlowTraceSnapshotFile: absolutePath.optional(),
    runtimeId: z.string().regex(REF),
    policyRevision: z.string().regex(REF),
    idlePollMs: z.number().int().min(50).max(60_000).default(500),
    staleProcessingMs: z.number().int().min(1000).max(86_400_000).default(300_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const legacyGroq = [
      value.sealFile,
      value.groqCredentialReference,
      value.groqCredentialFile,
    ].filter((item) => item !== undefined).length;
    if (value.openai === undefined && legacyGroq !== 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['openai'],
        message: 'exactly one complete provider configuration is required',
      });
    }
    if (value.openai !== undefined && legacyGroq !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['openai'],
        message: 'OpenAI and legacy Groq provider configuration cannot be mixed',
      });
    }
    if (
      value.openai !== undefined &&
      (value.concurrency.modelGateway.maxConcurrent < 2 ||
        value.concurrency.modelGateway.maxQueue < 2)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['concurrency', 'modelGateway'],
        message: 'OpenAI Luna/Sol requires at least two concurrent and two queued model slots',
      });
    }
    if (value.turnStore === undefined && value.spoolDirectory === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['turnStore'],
        message: 'a durable turn store is required',
      });
    }
    if (value.turnStore !== undefined && value.spoolDirectory !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['turnStore'],
        message: 'legacy spoolDirectory and turnStore cannot be mixed',
      });
    }
    const needsDatabase =
      value.knowledge.mode === 'HYBRID' || value.turnStore?.mode === 'POSTGRES';
    if (needsDatabase && value.database === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['database'],
        message: 'selected runtime capabilities need database configuration',
      });
    }
    if (!needsDatabase && value.database !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['database'],
        message: 'database configuration has no enabled consumer',
      });
    }
  });

export interface QuickFurnoWhatsAppProductionWorkerConfig {
  readonly revision: string;
  readonly deploymentMode: 'SINGLE_OWNER';
  readonly modelProvider:
    | Readonly<{
        mode: 'GROQ_ONLY';
        seal: unknown;
        credentialReference: string;
        credentialFile: string;
      }>
    | Readonly<{
        mode: 'OPENAI_LUNA_SOL';
        seal: unknown;
        credentialReference: string;
        credentialFile: string;
      }>;
  readonly database?: DatabaseConfig;
  readonly quickfurno: Readonly<{
    baseUrl: string;
    keyId: string;
    privateKeyPem: string;
    timeoutMs: number;
  }>;
  readonly decisionIntelligence:
    | Readonly<{ mode: 'DISABLED' }>
    | Readonly<{
        mode: 'SHADOW';
        model: string;
        apiKey: TypeSafeApiKey;
        timeoutMs: number;
        minConfidence: number;
        maxConcurrent: number;
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
        semanticCache:
          | Readonly<{ mode: 'DISABLED' }>
          | Readonly<{
              mode: 'PUBLIC_KNOWLEDGE_ONLY';
              maxEntries: number;
              threshold: number;
              publicTopics: readonly string[];
            }>;
        agents: Readonly<Record<'RIYA' | 'ANISHA' | 'AAROHI', AgentHybridKnowledgeSearchPolicy>>;
      }>;
  readonly concurrency: Readonly<{
    globalMaxConcurrentTurns: number;
    maxConcurrentByAgent: Readonly<Record<'RIYA' | 'ANISHA' | 'AAROHI', number>>;
    modelGateway: Readonly<{ maxConcurrent: number; maxQueue: number }>;
  }>;
  readonly turnStore:
    | Readonly<{ mode: 'FILE'; directory: string }>
    | Readonly<{ mode: 'POSTGRES' }>;
  readonly killSwitchFile: string;
  readonly operationalSnapshotFile: string;
  readonly agentFlowTraceSnapshotFile?: string;
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

  const turnStore: QuickFurnoWhatsAppProductionWorkerConfig['turnStore'] =
    input.turnStore === undefined
      ? Object.freeze({ mode: 'FILE' as const, directory: input.spoolDirectory as string })
      : input.turnStore.mode === 'POSTGRES'
        ? Object.freeze({ mode: 'POSTGRES' as const })
        : Object.freeze({ mode: 'FILE' as const, directory: input.turnStore.directory });

  let database: DatabaseConfig | undefined;
  if (input.database !== undefined) {
    try {
      const tls: DatabaseConfigInput['tls'] = {
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
  }

  let knowledge: QuickFurnoWhatsAppProductionWorkerConfig['knowledge'];
  if (input.knowledge.mode === 'DISABLED') {
    knowledge = Object.freeze({ mode: 'DISABLED' as const });
  } else {
    if (database === undefined) throw new Error('production-worker-config-invalid');
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
      semanticCache:
        input.knowledge.semanticCache.mode === 'DISABLED'
          ? Object.freeze({ mode: 'DISABLED' as const })
          : Object.freeze({
              mode: 'PUBLIC_KNOWLEDGE_ONLY' as const,
              maxEntries: input.knowledge.semanticCache.maxEntries,
              threshold: input.knowledge.semanticCache.threshold,
              publicTopics: Object.freeze([...input.knowledge.semanticCache.publicTopics]),
            }),
      agents: Object.freeze({
        RIYA: Object.freeze({ ...input.knowledge.agents.RIYA }),
        ANISHA: Object.freeze({ ...input.knowledge.agents.ANISHA }),
        AAROHI: Object.freeze({ ...input.knowledge.agents.AAROHI }),
      }),
    });
  }

  let decisionIntelligence: QuickFurnoWhatsAppProductionWorkerConfig['decisionIntelligence'];
  if (input.decisionIntelligence.mode === 'DISABLED') {
    decisionIntelligence = Object.freeze({ mode: 'DISABLED' as const });
  } else {
    try {
      decisionIntelligence = Object.freeze({
        mode: 'SHADOW' as const,
        model: input.decisionIntelligence.model,
        apiKey: createTypeSafeApiKey(
          secretText(input.decisionIntelligence.credentialFile, MAX_JEV_CREDENTIAL_BYTES),
        ),
        timeoutMs: input.decisionIntelligence.timeoutMs,
        minConfidence: input.decisionIntelligence.minConfidence,
        maxConcurrent: input.decisionIntelligence.maxConcurrent,
      });
    } catch {
      throw new Error('production-worker-config-invalid');
    }
  }

  let modelProvider: QuickFurnoWhatsAppProductionWorkerConfig['modelProvider'];
  if (input.openai !== undefined) {
    modelProvider = Object.freeze({
      mode: 'OPENAI_LUNA_SOL' as const,
      seal: parseJsonFile(input.openai.sealFile, MAX_SEAL_BYTES),
      credentialReference: input.openai.credentialReference,
      credentialFile: input.openai.credentialFile,
    });
  } else {
    if (
      input.sealFile === undefined ||
      input.groqCredentialReference === undefined ||
      input.groqCredentialFile === undefined
    ) {
      throw new Error('production-worker-config-invalid');
    }
    modelProvider = Object.freeze({
      mode: 'GROQ_ONLY' as const,
      seal: parseJsonFile(input.sealFile, MAX_SEAL_BYTES),
      credentialReference: input.groqCredentialReference,
      credentialFile: input.groqCredentialFile,
    });
  }

  return Object.freeze({
    revision: input.revision,
    deploymentMode: input.deploymentMode,
    modelProvider,
    ...(database === undefined ? {} : { database }),
    quickfurno: Object.freeze({
      baseUrl: input.quickfurno.baseUrl,
      keyId: input.quickfurno.keyId,
      privateKeyPem,
      timeoutMs: input.quickfurno.timeoutMs,
    }),
    decisionIntelligence,
    knowledge,
    concurrency: Object.freeze({
      globalMaxConcurrentTurns: input.concurrency.globalMaxConcurrentTurns,
      maxConcurrentByAgent: Object.freeze({ ...input.concurrency.maxConcurrentByAgent }),
      modelGateway: Object.freeze({ ...input.concurrency.modelGateway }),
    }),
    turnStore,
    killSwitchFile: input.killSwitchFile,
    operationalSnapshotFile: input.operationalSnapshotFile,
    ...(input.agentFlowTraceSnapshotFile === undefined
      ? {}
      : { agentFlowTraceSnapshotFile: input.agentFlowTraceSnapshotFile }),
    runtimeId: input.runtimeId,
    policyRevision: input.policyRevision,
    idlePollMs: input.idlePollMs,
    staleProcessingMs: input.staleProcessingMs,
  });
}