import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadQuickFurnoWhatsAppProductionWorkerConfig } from '../quickfurno-whatsapp/production-worker-config.js';

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
  const spool = join(root, 'spool');
  const kill = join(root, 'disabled');
  writeFileSync(sealFile, '{}');
  writeFileSync(keyFile, 'synthetic-not-read-by-config-loader');
  return {
    revision: 'a'.repeat(40),
    sealFile,
    groqCredentialReference: 'groq.qfj.production.v1',
    groqCredentialFile: keyFile,
    database: {
      connectionString: 'postgresql://qf_test@127.0.0.1:55433/qf_test',
      tls: { mode: 'disabled' },
    },
    quickfurno: {
      baseUrl: 'https://quickfurno.example/',
      keyId: 'qfj.prod.1',
      privateKeyPem: [
        '-----BEGIN',
        'PRIVATE KEY-----\nsynthetic\n-----END',
        'PRIVATE KEY-----',
      ].join(' '),
      timeoutMs: 5000,
    },
    spoolDirectory: spool,
    killSwitchFile: kill,
    runtimeId: 'qfj.whatsapp.production.v1',
    policyRevision: 'policy.quickfurno.production.v1',
    idlePollMs: 500,
    staleProcessingMs: 300000,
    maxConcurrentTextTurns: 1,
  };
}

describe('QuickFurno WhatsApp production worker configuration', () => {
  it('loads only an absolute bounded config and validates database policy', () => {
    const root = tempRoot();
    const path = join(root, 'worker.json');
    writeFileSync(path, JSON.stringify(validConfig(root)));
    const config = loadQuickFurnoWhatsAppProductionWorkerConfig(path);
    expect(config.revision).toBe('a'.repeat(40));
    expect(config.database.tls).toEqual({ mode: 'disabled' });
    expect(config.database.applicationName).toBe('qf-jarvis-whatsapp-worker');
    expect(config.seal).toEqual({});
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

  it('refuses relative config paths', () => {
    expect(() => loadQuickFurnoWhatsAppProductionWorkerConfig('worker.json')).toThrow(
      'production-worker-config-invalid',
    );
  });
});

describe('QuickFurno WhatsApp production worker containment', () => {
  const worker = source('../quickfurno-whatsapp/production-worker.ts');
  const binder = source('../quickfurno-whatsapp/production-seal-binding.ts');
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
    expect(worker).toContain('defaultRetryBudget: 0');
    expect(worker).toContain('allowFallback: false');
  });

  it('uses live QuickFurno authority rather than PostgreSQL business state', () => {
    expect(worker).toContain('createQuickFurnoWhatsAppAuthorityStatePort');
    expect(worker).toContain('createQuickFurnoWhatsAppAuthorityReader');
    expect(worker).toContain('createJarvisRuntime');
    expect(worker).not.toContain('composeDurableJarvisRuntime');
    expect(worker).not.toContain('createPostgresConversationStateAdapter');
    expect(worker).not.toContain('.provision(');
  });

  it('verifies the exact seal before credential resolution, database creation or spool creation', () => {
    const seal = worker.indexOf('bindJf5cSealForProduction');
    const credential = worker.indexOf('credentialBinding.resolver.resolve');
    const database = worker.indexOf('createDatabasePool(config.database)');
    const spool = worker.indexOf('createFileDurableTurnSpool(config.spoolDirectory)');
    expect(seal).toBeGreaterThanOrEqual(0);
    expect(seal).toBeLessThan(credential);
    expect(credential).toBeLessThan(database);
    expect(database).toBeLessThan(spool);
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
    expect(worker).toContain('if (killSwitch.active())');
    expect(worker).toContain('killSwitch,');
  });

  it('confines direct QuickFurno HTTP to one no-retry network adapter', () => {
    expect(worker).not.toMatch(/\bfetch\s*\(/);
    expect(network.match(/\bfetch\s*\(/g)).toHaveLength(2);
    expect(network).not.toMatch(/setTimeout|setInterval|\bretry\s*\(/);
  });

  it('serving code imports the neutral profile and never the live certification operator', () => {
    expect(worker).toContain('@qf-jarvis/jarvis-v1-production-profile');
    expect(binder).toContain('@qf-jarvis/jarvis-v1-production-profile');
    expect(worker).not.toContain('@qf-jarvis/jarvis-v1-provider-certification-live');
    expect(binder).not.toContain('@qf-jarvis/jarvis-v1-provider-certification-live');
  });
});
