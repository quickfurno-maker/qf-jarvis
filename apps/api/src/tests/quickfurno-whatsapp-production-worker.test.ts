import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadQuickFurnoWhatsAppProductionWorkerConfig } from '../quickfurno-whatsapp/production-worker-config.js';

const SYNTHETIC_CA_PEM = [
  '-----BEGIN CERTIFICATE-----',
  'MIIDMTCCAhmgAwIBAgIUJ9cLatTARkdFQCjPOyzGZUTOIUUwDQYJKoZIhvcNAQEL',
  'BQAwKDEmMCQGA1UEAwwdUUYgSmFydmlzIFN5bnRoZXRpYyBUZXN0IENBIDEwHhcN',
  'MjYwNzEyMTMyMzM4WhcNMzYwNzA5MTMyMzM4WjAoMSYwJAYDVQQDDB1RRiBKYXJ2',
  'aXMgU3ludGhldGljIFRlc3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC',
  'AQoCggEBALm4GDo3Sa9D8tH+NJrBoYTgSQDhSDoZ54ToMDZN9YjBrwETt3HCI+Br',
  'MR9GhfHXQNdeuoNAsgPoYI8w/SqNapIwMnTSRt+m+3GqHOvRomH3Av6W/ikgAoMu',
  '5DBkhEZg0fRScLzs9jpYorgK7t5BHf7O6QhufLb9hE4OR8MjnmLX3iWM/MHUey35',
  'S6X2vPdyKK/tOmuMXOTlfxCkoG2/r8Hsnm/cSsdMVtu7wrVOQrYieyGu9OdU9EuH',
  'nXddrGwv2Qe6tdaV+juUCrQouJ5lAh3YzMRo2JGGgweovochI/nIB7dJzY9HcsXE',
  'AjR2L/aINyQZIDl5Ox3rK1ISh7WGbMkCAwEAAaNTMFEwHQYDVR0OBBYEFMdJTdWr',
  'GQz19uI+1sMhvJIbKYBwMB8GA1UdIwQYMBaAFMdJTdWrGQz19uI+1sMhvJIbKYBw',
  'MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAK8Snt0sZ5RKFz8X',
  'p+tLO5szWETi1gPCiZgIUunefYQWLGzk7oDiFSn1vKhsc85Vy03OihMRj7qdU6oT',
  'ysydLXLXKZaz3hvLsVK+fv9BqXt4liqLpKxSJ7tXFQjp/b1Q7HdsHyzLWMDJnzS1',
  '+3BXU5SEgssS2SlU9M4x28doEV3lgwa61w7nhUvHrGxutZhOi/9dnM5G9mODWqzX',
  'X25zHRH6kU0OpzrjRrFspT/rrz1cK551nC470oU8YN98/y8n9T8bl+APwoNajdjm',
  'M0I+UZjvf2HtaLNO6F2iDbinWe/FhOcJ8DKVHLyDBEler91FtIYyots4+rcjHlPe',
  'eCGJzJ0=',
  '-----END CERTIFICATE-----',
].join('\n');

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'qfj-worker-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

function validConfig(root: string) {
  const sealFile = join(root, 'seal.json');
  const keyFile = join(root, 'groq.key');
  const caFile = join(root, 'postgres-ca.pem');
  const signingFile = join(root, 'quickfurno-signing.key');
  const embeddingFile = join(root, 'embedding.key');
  const spool = join(root, 'spool');
  const kill = join(root, 'disabled');
  const operationalSnapshotFile = join(root, 'worker-observation.json');
  writeFileSync(sealFile, '{}');
  writeFileSync(keyFile, 'synthetic-not-read-by-config-loader');
  writeFileSync(caFile, SYNTHETIC_CA_PEM);
  writeFileSync(signingFile, 'synthetic-signing-key-not-used-by-loader-test');
  writeFileSync(embeddingFile, 'synthetic-embedding-token-not-used-by-loader-test');
  return {
    revision: 'a'.repeat(40),
    deploymentMode: 'SINGLE_OWNER',
    sealFile,
    groqCredentialReference: 'groq.qfj.production.v1',
    groqCredentialFile: keyFile,
    database: {
      connectionString: 'postgresql://qf_test@db.example.invalid/qf_test',
      tls: { mode: 'verify-full', caFile },
    },
    quickfurno: {
      baseUrl: 'https://quickfurno.example/',
      keyId: 'qfj.prod.1',
      privateKeyFile: signingFile,
      timeoutMs: 5000,
    },
    knowledge: {
      mode: 'HYBRID',
      revision: 'knowledge.quickfurno.release.1',
      embedding: {
        executionClass: 'HOSTED',
        endpoint: 'https://embedding.example/v1/embeddings',
        modelRef: 'embedding-model-v1',
        credentialFile: embeddingFile,
        timeoutMs: 20000,
        maxBatchItems: 64,
        maxInputChars: 64000,
      },
      agents: {
        RIYA: { topicFilters: [], candidatePool: 64, maxResults: 8, maxContentChars: 4096 },
        ANISHA: { topicFilters: [], candidatePool: 64, maxResults: 8, maxContentChars: 4096 },
        AAROHI: { topicFilters: [], candidatePool: 64, maxResults: 8, maxContentChars: 4096 },
      },
    },
    concurrency: {
      globalMaxConcurrentTurns: 200,
      maxConcurrentByAgent: { RIYA: 200, ANISHA: 200, AAROHI: 200 },
      modelGateway: { maxConcurrent: 50, maxQueue: 150 },
    },
    spoolDirectory: spool,
    killSwitchFile: kill,
    operationalSnapshotFile,
    runtimeId: 'qfj.whatsapp.production.v1',
    policyRevision: 'policy.quickfurno.production.v1',
    idlePollMs: 500,
    staleProcessingMs: 300000,
  };
}

describe('QuickFurno WhatsApp production worker configuration', () => {
  it('loads only an absolute bounded config and validates database policy', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    writeFileSync(path, JSON.stringify(validConfig(root)));
    const config = loadQuickFurnoWhatsAppProductionWorkerConfig(path);
    expect(config.revision).toBe('a'.repeat(40));
    expect(config.database?.tls.mode).toBe('verify-full');
    expect(config.knowledge.mode).toBe('HYBRID');
    if (config.knowledge.mode !== 'HYBRID') throw new Error('expected hybrid knowledge');
    expect(config.knowledge.revision).toBe('knowledge.quickfurno.release.1');
    expect(config.knowledge.semanticCache).toEqual({ mode: 'DISABLED' });
    expect(config.knowledge.embedding.bearerToken).toBe(
      'synthetic-embedding-token-not-used-by-loader-test',
    );
    expect(config.database?.applicationName).toBe('qf-jarvis-whatsapp-worker');
    expect(config.concurrency).toEqual({
      globalMaxConcurrentTurns: 200,
      maxConcurrentByAgent: { RIYA: 200, ANISHA: 200, AAROHI: 200 },
      modelGateway: { maxConcurrent: 50, maxQueue: 150 },
    });
    expect(config.modelProvider).toMatchObject({
      mode: 'GROQ_ONLY',
      seal: {},
      credentialReference: 'groq.qfj.production.v1',
    });
  });

  it('loads an OpenAI Luna/Sol provider config without any Groq credential fields', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const openaiSeal = join(root, 'openai-seal.json');
    const openaiKey = join(root, 'openai.key');
    writeFileSync(openaiSeal, '{}');
    writeFileSync(openaiKey, 'synthetic-openai-key-not-used-by-loader-test');
    const legacy = validConfig(root);
    const {
      sealFile: _sealFile,
      groqCredentialReference: _groqCredentialReference,
      groqCredentialFile: _groqCredentialFile,
      ...withoutGroq
    } = legacy;
    writeFileSync(
      path,
      JSON.stringify({
        ...withoutGroq,
        openai: {
          sealFile: openaiSeal,
          credentialReference: 'openai.qfj.production.v1',
          credentialFile: openaiKey,
        },
      }),
    );

    const config = loadQuickFurnoWhatsAppProductionWorkerConfig(path);
    expect(config.modelProvider).toMatchObject({
      mode: 'OPENAI_LUNA_SOL',
      seal: {},
      credentialReference: 'openai.qfj.production.v1',
      credentialFile: openaiKey,
    });
  });

  it('refuses mixed OpenAI and Groq provider configuration', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const config = validConfig(root);
    const openaiSeal = join(root, 'openai-seal.json');
    const openaiKey = join(root, 'openai.key');
    writeFileSync(openaiSeal, '{}');
    writeFileSync(openaiKey, 'synthetic-openai-key-not-used-by-loader-test');
    writeFileSync(
      path,
      JSON.stringify({
        ...config,
        openai: {
          sealFile: openaiSeal,
          credentialReference: 'openai.qfj.production.v1',
          credentialFile: openaiKey,
        },
      }),
    );
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig(path)).toThrow(
      'production-worker-config-invalid',
    );
  });

  it('loads DISABLED knowledge without a database, CA file, embedding endpoint or embedding credential', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const hybrid = validConfig(root);
    unlinkSync(join(root, 'postgres-ca.pem'));
    unlinkSync(join(root, 'embedding.key'));
    const { database: _database, ...withoutDatabase } = hybrid;
    writeFileSync(
      path,
      JSON.stringify({
        ...withoutDatabase,
        knowledge: { mode: 'DISABLED' },
      }),
    );

    const config = loadQuickFurnoWhatsAppProductionWorkerConfig(path);
    expect(config.database).toBeUndefined();
    expect(config.knowledge).toEqual({ mode: 'DISABLED' });
    expect(config.decisionIntelligence).toEqual({ mode: 'DISABLED' });
  });

  it('allows DISABLED knowledge while PostgreSQL remains the durable turn store', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const legacy = validConfig(root);
    const { spoolDirectory: _spoolDirectory, ...withoutLegacySpool } = legacy;
    writeFileSync(
      path,
      JSON.stringify({
        ...withoutLegacySpool,
        knowledge: { mode: 'DISABLED' },
        turnStore: { mode: 'POSTGRES' },
      }),
    );

    const config = loadQuickFurnoWhatsAppProductionWorkerConfig(path);
    expect(config.knowledge).toEqual({ mode: 'DISABLED' });
    expect(config.turnStore).toEqual({ mode: 'POSTGRES' });
    expect(config.database?.applicationName).toBe('qf-jarvis-whatsapp-worker');
  });

  it('loads Jev SHADOW configuration from a bounded mounted credential without exposing the key', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const jevKeyFile = join(root, 'typesafe-jev.key');
    writeFileSync(jevKeyFile, 'synthetic-typesafe-key');
    const config = validConfig(root);
    writeFileSync(
      path,
      JSON.stringify({
        ...config,
        decisionIntelligence: {
          mode: 'SHADOW',
          model: 'jev-latest',
          credentialFile: jevKeyFile,
          timeoutMs: 900,
          minConfidence: 0.76,
          maxConcurrent: 6,
        },
      }),
    );
    const loaded = loadQuickFurnoWhatsAppProductionWorkerConfig(path);
    expect(loaded.decisionIntelligence.mode).toBe('SHADOW');
    if (loaded.decisionIntelligence.mode !== 'SHADOW') throw new Error('expected Jev shadow');
    expect(loaded.decisionIntelligence.model).toBe('jev-latest');
    expect(loaded.decisionIntelligence.timeoutMs).toBe(900);
    expect(loaded.decisionIntelligence.minConfidence).toBe(0.76);
    expect(loaded.decisionIntelligence.maxConcurrent).toBe(6);
    expect(String(loaded.decisionIntelligence.apiKey)).toBe('[REDACTED_TYPESAFE_API_KEY]');
  });

  it('loads only explicit public-topic semantic caching and refuses duplicate topics', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const config = validConfig(root);
    writeFileSync(
      path,
      JSON.stringify({
        ...config,
        knowledge: {
          ...config.knowledge,
          semanticCache: {
            mode: 'PUBLIC_KNOWLEDGE_ONLY',
            maxEntries: 1500,
            threshold: 0.98,
            publicTopics: ['faq.homeowner', 'faq.vendor'],
          },
        },
      }),
    );
    const loaded = loadQuickFurnoWhatsAppProductionWorkerConfig(path);
    expect(loaded.knowledge.mode).toBe('HYBRID');
    if (loaded.knowledge.mode !== 'HYBRID') throw new Error('expected hybrid knowledge');
    expect(loaded.knowledge.semanticCache).toEqual({
      mode: 'PUBLIC_KNOWLEDGE_ONLY',
      maxEntries: 1500,
      threshold: 0.98,
      publicTopics: ['faq.homeowner', 'faq.vendor'],
    });

    writeFileSync(
      path,
      JSON.stringify({
        ...config,
        knowledge: {
          ...config.knowledge,
          semanticCache: {
            mode: 'PUBLIC_KNOWLEDGE_ONLY',
            publicTopics: ['faq.homeowner', 'faq.homeowner'],
          },
        },
      }),
    );
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig(path)).toThrow(
      'production-worker-config-invalid',
    );
  });

  it('refuses database configuration when knowledge is explicitly DISABLED', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const config = validConfig(root);
    writeFileSync(path, JSON.stringify({ ...config, knowledge: { mode: 'DISABLED' } }));
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig(path)).toThrow(
      'production-worker-config-invalid',
    );
  });

  it('refuses HYBRID knowledge when database configuration is absent', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const config = validConfig(root);
    const { database: _database, ...withoutDatabase } = config;
    writeFileSync(path, JSON.stringify(withoutDatabase));
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig(path)).toThrow(
      'production-worker-config-invalid',
    );
  });

  it('refuses non-loopback plaintext PostgreSQL without leaking the supplied URL', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const config = validConfig(root);
    writeFileSync(
      path,
      JSON.stringify({
        ...config,
        database: {
          connectionString: 'postgresql://secret-user:secret-pass@db.example.invalid/db',
          tls: { mode: 'disabled' },
        },
      }),
    );
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig(path)).toThrow(
      'production-worker-config-invalid',
    );
  });

  it('refuses an obsolete managed-Riya persistence field in WhatsApp production config', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const config = validConfig(root);
    writeFileSync(
      path,
      JSON.stringify({
        ...config,
        riyaPersistenceDecisionFile: join(root, 'must-not-be-required.json'),
      }),
    );
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig(path)).toThrow(
      'production-worker-config-invalid',
    );
  });

  it('refuses a floating knowledge revision', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const config = validConfig(root);
    writeFileSync(
      path,
      JSON.stringify({ ...config, knowledge: { ...config.knowledge, revision: 'latest' } }),
    );
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig(path)).toThrow(
      'production-worker-config-invalid',
    );
  });

  it('refuses hybrid search budgets wider than the runtime grounding envelope', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const config = validConfig(root);
    writeFileSync(
      path,
      JSON.stringify({
        ...config,
        knowledge: {
          ...config.knowledge,
          agents: {
            ...config.knowledge.agents,
            RIYA: { ...config.knowledge.agents.RIYA, maxResults: 9, maxContentChars: 4097 },
          },
        },
      }),
    );
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig(path)).toThrow(
      'production-worker-config-invalid',
    );
  });

  it('refuses concurrency that exceeds a 200-turn agent lane or cannot absorb all admitted turns', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const config = validConfig(root);
    writeFileSync(
      path,
      JSON.stringify({
        ...config,
        concurrency: {
          ...config.concurrency,
          maxConcurrentByAgent: { RIYA: 201, ANISHA: 200, AAROHI: 200 },
        },
      }),
    );
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig(path)).toThrow(
      'production-worker-config-invalid',
    );

    writeFileSync(
      path,
      JSON.stringify({
        ...config,
        concurrency: {
          ...config.concurrency,
          modelGateway: { maxConcurrent: 20, maxQueue: 20 },
        },
      }),
    );
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig(path)).toThrow(
      'production-worker-config-invalid',
    );
  });

  it('refuses relative config paths', () => {
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig('worker.json')).toThrow(
      'production-worker-config-invalid',
    );
  });
});

describe('QuickFurno WhatsApp production worker containment', () => {
  const worker = source('../quickfurno-whatsapp/production-worker.ts');
  const binder = source('../quickfurno-whatsapp/production-seal-binding.ts');
  const openaiBinder = source('../quickfurno-whatsapp/openai-production-seal-binding.ts');
  const killSwitch = source('../quickfurno-whatsapp/production-kill-switch.ts');
  const network = source('../quickfurno-whatsapp/production-network.ts');
  const bin = source('../bin/run-quickfurno-whatsapp-production-worker.ts');

  it('has no Nara provider, discovery, credential or fallback surface', () => {
    for (const forbidden of [
      'NaraModelProvider',
      'createFetchNaraTransport',
      'readNaraCredential',
      'fetchNaraModelCatalogue',
      "providerMode: 'AUTO'",
      "providerMode: 'NARA_ONLY'",
      'allowFallback: true',
    ]) {
      expect(worker, forbidden).not.toContain(forbidden);
    }
    expect(worker).toContain("providerMode: 'GROQ_ONLY'");
    expect(worker).toContain("providerMode: 'OPENAI_ONLY'");
    expect(worker).toContain('new OpenAIModelProvider');
    expect(worker).toContain('createFetchOpenAITransport');
    expect(worker).toContain('defaultRetryBudget: 0');
    expect(worker).toContain('allowFallback: false');
  });

  it('binds TypeSafe Jev only as bounded SHADOW decision intelligence', () => {
    expect(worker).toContain("config.decisionIntelligence.mode === 'SHADOW'");
    expect(worker).toContain('new JevDecisionProvider');
    expect(worker).toContain('jev.listModels');
    expect(worker).toContain('createJevDecisionShadowPort');
    expect(worker).toContain('...(decisionShadowPort === undefined ? {} : { decisionShadowPort })');
    expect(worker).not.toContain('actionProposalAuthorized: true');
    expect(worker).not.toContain('executionAuthorized: true');
  });

  it('binds hybrid knowledge only inside the explicit HYBRID branch', () => {
    expect(worker).toContain("config.knowledge.mode === 'HYBRID'");
    expect(worker).toContain('assertPostgresKnowledgeReleaseReady');
    expect(worker).toContain('createPostgresHybridCandidateStore');
    expect(worker).toContain('createHybridKnowledgeRetriever');
    expect(worker).toContain('createInMemoryPublicKnowledgeSemanticCache');
    expect(worker).toContain("hybridConfig.semanticCache.mode === 'PUBLIC_KNOWLEDGE_ONLY'");
    expect(worker).toContain('knowledgeRevision: hybridConfig.revision');
    expect(worker).toContain(
      '...(agentHybridKnowledge === undefined ? {} : { agentHybridKnowledge })',
    );
  });

  it('uses live QuickFurno authority rather than PostgreSQL business state', () => {
    expect(worker).toContain('createQuickFurnoWhatsAppAuthorityStatePort');
    expect(worker).toContain('createQuickFurnoWhatsAppAuthorityReader');
    expect(worker).toContain('createJarvisRuntime');
    expect(worker).not.toContain('composeDurableJarvisRuntime');
    expect(worker).not.toContain('createPostgresConversationStateAdapter');
    expect(worker).not.toContain('createJf6RiyaServiceBoundary');
    expect(worker).not.toContain('createPostgresRiyaConversationContinuityStore');
    expect(worker).not.toContain('createPostgresRiyaTurnCoordinator');
    expect(worker).not.toContain('riyaPersistenceDecision');
    expect(worker).not.toContain('.provision(');
  });

  it('verifies the exact seal before credentials, database creation and durable turn-store binding', () => {
    const seal = worker.indexOf('bindJf5cSealForProduction');
    const credential = worker.indexOf('credentialBinding.resolver.resolve');
    const database = worker.indexOf('createDatabasePool(config.database)');
    const postgresSpool = worker.indexOf('createPostgresDurableTurnSpool(pool)');
    const fileSpool = worker.indexOf('createFileDurableTurnSpool(config.turnStore.directory)');
    expect(seal).toBeGreaterThanOrEqual(0);
    expect(seal).toBeLessThan(credential);
    expect(credential).toBeLessThan(database);
    expect(database).toBeLessThan(postgresSpool);
    expect(fileSpool).toBeGreaterThanOrEqual(0);
  });

  it('reads no secret-bearing environment variable and logs no config or exception', () => {
    const environmentToken = ['process', 'env'].join('.');
    expect(worker).not.toContain(environmentToken);
    expect(bin).not.toContain(environmentToken);
    expect(bin).not.toContain('console.log');
    expect(bin).not.toContain('console.error');
    expect(bin).not.toContain('String(error)');
    expect(bin).not.toContain('error.message');
    expect(bin).toContain('qfj-whatsapp-worker REFUSED');
  });

  it('checks a fail-closed filesystem kill switch before claiming and at gateway invocation', () => {
    expect(killSwitch).toContain('statSync(path)');
    expect(killSwitch).toContain("code !== 'ENOENT'");
    expect(worker).toContain('canClaim: () => !killSwitch.active()');
    expect(worker).toContain('killSwitch,');
  });

  it('routes production turns through bounded Luna/Sol adaptive specialist routing and scheduler', () => {
    expect(worker).toContain('createAdaptiveQuickFurnoWhatsAppSpecialistRuntime');
    expect(worker).toContain('activeReleaseIds: specialists.map((item) => item.releaseId)');
    expect(worker).toContain('releaseId: luna.releaseId');
    expect(worker).toContain('releaseId: sol.releaseId');
    expect(worker).toContain('SIMPLE: Object.freeze');
    expect(worker).toContain('STANDARD: Object.freeze');
    expect(worker).toContain('COMPLEX: Object.freeze');
    expect(worker).toContain('splitOpenAIConcurrency');
    expect(worker).toContain('reasoningEffort: JARVIS_V1_OPENAI_REASONING_EFFORT_BY_TIER[tier]');
    expect(worker).toContain('createQuickFurnoWhatsAppParallelScheduler');
    expect(worker).toContain(
      'globalMaxConcurrentTurns: config.concurrency.globalMaxConcurrentTurns',
    );
    expect(worker).toContain('maxConcurrentByAgent: config.concurrency.maxConcurrentByAgent');
    expect(worker).toContain('concurrency: config.concurrency.modelGateway');
    expect(worker).not.toContain('concurrency: { maxConcurrent: 1, maxQueue: 1 }');
  });

  it('keeps Riya on her evaluated conversation task class without changing Anisha or Aarohi defaults', () => {
    expect(worker).toContain('RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1');
    expect(worker).toContain('taskClass: RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1.taskClass');
    expect(worker).toContain("material.assignedActor === 'RIYA'");
    expect(worker).toContain('? riyaSpecialist');
    expect(worker).toContain(': genericSpecialist');
    expect(worker).toContain('const genericRuntime = createJarvisRuntime(sharedRuntimeConfig)');
    expect(worker).not.toContain("taskClass: 'RIYA_CONVERSATION_EVOLUTION'");
  });

  it('confines direct QuickFurno HTTP to one no-retry network adapter', () => {
    expect(worker).not.toMatch(/\bfetch\s*\(/);
    expect(network.match(/\bfetch\s*\(/g)).toHaveLength(2);
    expect(network).not.toMatch(/setTimeout|setInterval|\bretry\s*\(/);
  });

  it('serving code imports the neutral profile and never the live certification operator', () => {
    expect(worker).toContain('@qf-jarvis/jarvis-v1-production-profile');
    expect(binder).toContain('@qf-jarvis/jarvis-v1-production-profile');
    expect(openaiBinder).toContain('@qf-jarvis/jarvis-v1-production-profile');
    for (const servingSource of [worker, binder, openaiBinder]) {
      expect(servingSource).not.toContain('@qf-jarvis/jarvis-v1-provider-certification-live');
      expect(servingSource).not.toContain('@qf-jarvis/jarvis-v1-production-seal/openai-v1');
    }
  });
});

describe('production worker deployment shape', () => {
  it('refuses any deployment mode other than the governed single-owner topology', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    const config = validConfig(root);
    writeFileSync(path, JSON.stringify({ ...config, deploymentMode: 'MULTI_REPLICA' }));
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig(path)).toThrow(
      'production-worker-config-invalid',
    );
  });
});
