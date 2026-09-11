/**
 * The PRODUCTION wiring for the JF-5B live run — the only place the real seams are assembled.
 *
 * ### Nothing here is reachable from the service
 *
 * This module is imported by exactly one file, `src/bin/run-jf5b-live-certification.ts`, and a
 * containment spec asserts that by path. No server startup, no ingress, no runtime factory and no
 * ordinary request path reaches it, so the certification harness cannot be pulled into a serving
 * process by an accidental import.
 *
 * ### It composes; it does not decide
 *
 * The Groq connectivity check is the existing staging smoke. The Nara credential is the existing
 * masked-TTY primitive wrapped in the provider's own redacting holder. Discovery is one bounded GET.
 * The agent turns run through the existing three-agent Mastra composition, and the QF Model Gateway
 * alone selects the provider. There is no routing logic in this file, and there is no second workflow.
 *
 * ### Constructing it opens nothing
 *
 * Building these seams reads no credential, opens no socket and creates no directory. Every one of
 * those happens later, inside the CLI, after both gates have passed — which is what makes an early
 * refusal cheap.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import {
  createMaskedTtyCredentialResolver,
  createNodeMaskedSecretSource,
  createSystemSmokeTimer,
  loadSmokeConfig,
} from '@qf-jarvis/groq-staging-smoke';
import type { StagingCredentialResolver } from '@qf-jarvis/groq-staging-smoke';
import { createSystemClock } from '@qf-jarvis/model-gateway';
import type { GroqApiKey } from '@qf-jarvis/model-gateway';
import {
  NARA_MODELS_ENDPOINT,
  readNaraCredential,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import type {
  ArtifactWriter,
  ConfirmationReader,
  DiscoveryHttpResponse,
  NaraDiscoveryTransport,
  OperatorIo,
  RepositoryFacts,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';

import type { Jf5bCliDeps } from '../cli/run-jf5b-live-certification.js';
import type { GroqConnectivityCheck, NaraCredentialGate } from '../cli/jf5b-live-deps.js';
import { createJf5bCertificationRunner } from './jf5b-certification-runner-impl.js';
import { readRepositoryFacts } from './jf5b-repository-facts.js';

/** Lines to stdout and stderr, and nothing else. */
const systemIo: OperatorIo = Object.freeze({
  out(line: string): void {
    process.stdout.write(`${line}\n`);
  },
  err(line: string): void {
    process.stderr.write(`${line}\n`);
  },
});

/**
 * The typed confirmation, read from a real terminal with echo ON.
 *
 * Echoed deliberately: the phrase is not a secret, and hiding it would make the one step whose whole
 * purpose is deliberate human acknowledgement feel like a password prompt.
 */
function systemConfirmationReader(): ConfirmationReader {
  return Object.freeze({
    isInteractive(): boolean {
      // Both streams, because a run that can prompt but cannot show the prompt is not interactive.
      return process.stdin.isTTY && process.stdout.isTTY;
    },
    async readLine(prompt: string): Promise<string> {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(prompt);
      } finally {
        rl.close();
      }
    },
  });
}

/**
 * The ONE bounded discovery GET.
 *
 * `redirect: 'manual'` so a 3xx is visible and refusable rather than silently followed with the
 * credential attached. The body is read as text and measured before parsing, so an oversized payload is
 * refused instead of truncated.
 */
function systemDiscoveryTransport(): NaraDiscoveryTransport {
  return Object.freeze({
    async get(request: {
      readonly authorization: string;
      readonly timeoutMs: number;
      readonly maxBytes: number;
    }): Promise<DiscoveryHttpResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, request.timeoutMs);
      try {
        const response = await fetch(NARA_MODELS_ENDPOINT, {
          method: 'GET',
          headers: { authorization: request.authorization, accept: 'application/json' },
          redirect: 'manual',
          signal: controller.signal,
        });
        const bodyText = await response.text();
        return Object.freeze({
          status: response.status,
          redirected: response.type === 'opaqueredirect' || response.redirected,
          bodyBytes: Buffer.byteLength(bodyText, 'utf8'),
          bodyText,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

/** Writes under the run directory, which has already been proved to be outside the repository. */
function systemArtifactWriter(rootDirectory: string): ArtifactWriter {
  return Object.freeze({
    ensureDirectory(absolutePath: string): void {
      mkdirSync(absolutePath, { recursive: true });
    },
    writeFile(relativePath: string, contents: string): void {
      const full = join(rootDirectory, relativePath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents, 'utf8');
    },
    digestOf(relativePath: string): string {
      return createHash('sha256')
        .update(readFileSync(join(rootDirectory, relativePath)))
        .digest('hex');
    },
  });
}

/**
 * Phase 1: the EXISTING Groq staging smoke, composed.
 *
 * `loadSmokeConfig` is that package's own contract — a non-secret JSON file carrying release identity
 * and bounds — and its parser refuses any credential-shaped key, so the path argument cannot become a
 * way to smuggle a secret. Writing a second connectivity call here was the alternative, and it would
 * have been a second credential policy too.
 */
function systemGroqConnectivity(): GroqConnectivityCheck {
  return Object.freeze({
    async run(input: {
      readonly smokeConfigPath: string;
      readonly reserve: () => boolean;
    }): Promise<{ ok: true; key: GroqApiKey } | { ok: false; reason: string }> {
      const config = loadSmokeConfig(input.smokeConfigPath);
      if (!config.ok) {
        return { ok: false, reason: config.reason };
      }
      if (!input.reserve()) {
        return { ok: false, reason: 'budget-exhausted' };
      }
      const { runGroqStagingSmokeOnce, createSystemSmokeWireDeps } =
        await import('@qf-jarvis/groq-staging-smoke');
      const resolver = createMaskedTtyCredentialResolver(createNodeMaskedSecretSource());

      // ONE prompt for ONE secret.
      //
      // The masked resolver admits exactly one entry per process and refuses a second, so the phases
      // after this one cannot ask again. Rather than prompt the owner twice, the resolved HOLDER is
      // kept as the smoke resolves it and handed on. What is kept is the redacting holder, never the
      // typed value: it has no accessor, and its `toString`, `toJSON` and inspect hook all return the
      // redaction marker. This wrapper delegates and observes; it decides nothing about acceptance.
      let captured: GroqApiKey | undefined;
      const capturing: StagingCredentialResolver = Object.freeze({
        ...resolver,
        async resolve(reference: Parameters<StagingCredentialResolver['resolve']>[0]) {
          const key = await resolver.resolve(reference);
          captured = key;
          return key;
        },
      });

      // The wire factory pairs the instrumented transport with its recorder, and that pairing is the
      // thing a previous run proved cannot live as a convention in two composition roots. Spread it
      // whole; supply only the clock, the timer and the resolver it deliberately leaves to the caller.
      const wire = createSystemSmokeWireDeps();
      const result = await runGroqStagingSmokeOnce(config.config, {
        ...wire,
        clock: createSystemClock(),
        timer: createSystemSmokeTimer(),
        credentialResolver: capturing,
      });
      if (!result.ok) {
        return { ok: false, reason: result.reason };
      }
      if (captured === undefined) {
        // A smoke that succeeded without resolving a credential is a wiring contradiction, not a
        // certification that may continue.
        return { ok: false, reason: 'smoke-credential-not-captured' };
      }
      return { ok: true, key: captured };
    },
  });
}

/** Phase 2: the existing masked-TTY primitive, wrapped in the Nara holder. Never `GroqApiKey`. */
function systemNaraCredential(): NaraCredentialGate {
  return Object.freeze({
    async read() {
      const source = createNodeMaskedSecretSource();
      const result = await readNaraCredential(source, source.isInteractive());
      return result.ok
        ? { ok: true as const, key: result.key }
        : { ok: false as const, failure: result.failure };
    },
  });
}

/** A run id from the wall clock. Content-free, and the only clock read in the lane. */
function runId(): string {
  return `run.jf5b.${new Date().toISOString().replace(/[:.]/gu, '-')}`;
}

/**
 * Assemble the production dependencies.
 *
 * Takes argv only to resolve the output directory: the CLI re-parses argv itself and owns every
 * decision, so this cannot become a second argument interpreter.
 */
export function createDefaultJf5bCliDeps(argv: readonly string[]): Jf5bCliDeps {
  const outputFlag = argv.indexOf('--output-dir');
  const inline = argv.find((arg) => arg.startsWith('--output-dir='));
  const rawOutput =
    inline !== undefined
      ? inline.slice('--output-dir='.length)
      : outputFlag === -1
        ? ''
        : (argv[outputFlag + 1] ?? '');
  const resolvedOutputDirectory = rawOutput === '' ? '' : resolve(rawOutput);

  const facts: RepositoryFacts = readRepositoryFacts(resolvedOutputDirectory);

  return Object.freeze({
    io: systemIo,
    confirmation: systemConfirmationReader(),
    facts,
    runId: runId(),
    groqConnectivity: systemGroqConnectivity(),
    naraCredential: systemNaraCredential(),
    discoveryTransport: systemDiscoveryTransport(),
    runner: createJf5bCertificationRunner(),
    artifacts: systemArtifactWriter(resolvedOutputDirectory),
  });
}
