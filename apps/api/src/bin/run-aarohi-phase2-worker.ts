#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { loadAarohiPhase2WorkerConfig, readSecretFile } from '../aarohi-phase2/config.js';
import { createAarohiPhase2CoreClient } from '../aarohi-phase2/core-client.js';
import { createHttpJsonAarohiDiscoveryProvider } from '../aarohi-phase2/http-json-provider.js';
import { createHttpJsonAarohiSocialProvider } from '../aarohi-phase2/http-json-social-provider.js';
import { createAarohiDiscoveryProviderRegistry } from '../aarohi-phase2/provider-port.js';
import { createAarohiSocialProviderRegistry } from '../aarohi-phase2/social-provider-port.js';
import { createAarohiPhase2Worker } from '../aarohi-phase2/worker.js';

function configPath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--config' || !argv[1] || !isAbsolute(argv[1])) {
    throw new Error('invalid-usage');
  }
  return argv[1];
}
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function providerSecret(secrets: ReadonlyMap<string, string>, key: string): string {
  const secret = secrets.get(key);
  if (secret === undefined) {
    throw new Error('provider-secret-missing');
  }
  return secret;
}

async function main(): Promise<void> {
  try {
    const file = loadAarohiPhase2WorkerConfig(configPath(process.argv.slice(2)));
    if (!file.enabled) {
      process.stdout.write('qfj-aarohi-phase2-worker DISABLED\n');
      return;
    }
    const core = createAarohiPhase2CoreClient({
      baseUrl: file.core.baseUrl,
      keyId: file.core.keyId,
      privateKeyPem: readSecretFile(file.core.privateKeyFile, 32_768),
      clock: () => new Date().toISOString(),
      requestId: () => randomUUID(),
      timeoutMs: file.core.timeoutMs,
      httpPost: async (url, init) => fetch(url, init),
    });
    const providerSecrets = new Map(
      file.providers.map(
        (provider) => [provider.key, readSecretFile(provider.bearerTokenFile, 4096)] as const,
      ),
    );
    const providers = createAarohiDiscoveryProviderRegistry(
      file.providers.map((provider) =>
        createHttpJsonAarohiDiscoveryProvider({
          key: provider.key,
          channel: provider.channel,
          endpoint: provider.endpoint,
          bearerToken: providerSecret(providerSecrets, provider.key),
          allowedHosts: provider.allowedHosts,
        }),
      ),
    );
    const socialProviders = createAarohiSocialProviderRegistry(
      file.providers.flatMap((provider) =>
        (provider.socialContinuation || provider.socialReplyPolling) &&
        ['INSTAGRAM', 'FACEBOOK', 'X'].includes(provider.channel)
          ? [
              createHttpJsonAarohiSocialProvider({
                key: provider.key,
                channel: provider.channel as 'INSTAGRAM' | 'FACEBOOK' | 'X',
                endpoint: provider.endpoint,
                bearerToken: providerSecret(providerSecrets, provider.key),
                allowedHosts: provider.allowedHosts,
                enableContinuation: provider.socialContinuation,
                enableReplyPolling: provider.socialReplyPolling,
              }),
            ]
          : [],
      ),
    );
    const worker = createAarohiPhase2Worker({
      workerRef: file.workerRef,
      core,
      providers,
      socialProviders,
    });
    process.stdout.write(
      'qfj-aarohi-phase2-worker READY revision=' +
        file.revision +
        ' providers=' +
        String(file.providers.length) +
        '\n',
    );
    const controller = new AbortController();
    const stop = () => {
      controller.abort();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    try {
      while (!controller.signal.aborted) {
        const discovery = await worker.runOnce();
        const socialInbox = await worker.runSocialInboxOnce();
        const social = await worker.runSocialOnce();
        for (const result of [discovery, socialInbox, social]) {
          if (result.state !== 'idle') {
            process.stdout.write(
              'qfj-aarohi-phase2-worker cycle=' +
                result.state +
                ('runId' in result && result.runId ? ' run=' + result.runId : '') +
                ('jobId' in result && result.jobId ? ' job=' + result.jobId : '') +
                ('candidateCount' in result ? ' candidates=' + String(result.candidateCount) : '') +
                ('replyCount' in result ? ' replies=' + String(result.replyCount) : '') +
                '\n',
            );
          }
        }
        const idle =
          discovery.state === 'idle' && socialInbox.state === 'idle' && social.state === 'idle';
        await sleep(idle ? file.pollMs : 50, controller.signal);
      }
    } finally {
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
    }
  } catch {
    process.stderr.write('qfj-aarohi-phase2-worker REFUSED\n');
    process.exitCode = 1;
  }
}
await main();
