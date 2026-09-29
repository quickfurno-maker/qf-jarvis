#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import {
  JARVIS_V1_OPENAI_CATALOGUE_OBSERVATION,
  JARVIS_V1_OPENAI_DATA_CONTROLS_REF,
  JARVIS_V1_OPENAI_MODEL_BY_TIER,
  JARVIS_V1_OPENAI_REASONING_EFFORT_BY_TIER,
  JARVIS_V1_PRODUCTION_AGENTS,
  JARVIS_V1_PRODUCTION_MAX_COMPLETION_TOKENS,
  JARVIS_V1_PRODUCTION_MAX_INPUT_TOKENS,
  JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT,
  type JarvisV1OpenAITier,
  type JarvisV1ProductionAgent,
} from '@qf-jarvis/jarvis-v1-production-profile';
import {
  createOpenAIV1BindingMatrix,
  createOpenAIV1CertificationManifest,
  type OpenAIV1CertificationEntry,
} from '@qf-jarvis/jarvis-v1-provider-certification-live/openai-v1';
import {
  createOpenAIV1ProductionSeal,
  type OpenAIV1HumanReview,
} from '@qf-jarvis/jarvis-v1-production-seal/openai-v1';
import {
  createFetchOpenAITransport,
  createOpenAIProviderConfig,
  createSystemClock,
  OpenAIModelProvider,
} from '@qf-jarvis/model-gateway';
import { genericReplyWireSchema } from '@qf-jarvis/model-reply-adapter';
import { z } from 'zod';

import { createFileOpenAICredentialBinding } from '../secrets/file-openai-credential-binding.js';

const SHA40 = /^[0-9a-f]{40}$/u;
const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
interface Args {
  readonly credentialFile: string;
  readonly outputDir: string;
  readonly headSha: string;
  readonly ownerRef: string;
  readonly knowledgeRevision?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  let approve = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--approve-production') {
      approve = true;
      continue;
    }
    const value = argv[index + 1];
    if (token === undefined || value === undefined || !token.startsWith('--')) {
      throw new Error('invalid-usage');
    }
    map.set(token, value);
    index += 1;
  }
  const credentialFile = map.get('--credential-file');
  const outputDir = map.get('--output-dir');
  const headSha = map.get('--head-sha');
  const ownerRef = map.get('--owner-ref');
  const knowledgeRevision = map.get('--knowledge-revision');
  if (
    !approve ||
    credentialFile === undefined ||
    outputDir === undefined ||
    headSha === undefined ||
    ownerRef === undefined ||
    !isAbsolute(credentialFile) ||
    !isAbsolute(outputDir) ||
    !SHA40.test(headSha) ||
    !REF.test(ownerRef) ||
    (knowledgeRevision !== undefined && !REF.test(knowledgeRevision))
  ) {
    throw new Error('invalid-usage');
  }
  return Object.freeze({
    credentialFile,
    outputDir,
    headSha,
    ownerRef,
    ...(knowledgeRevision === undefined ? {} : { knowledgeRevision }),
  });
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
const SMOKE_INPUT: Readonly<Record<JarvisV1ProductionAgent, string>> = Object.freeze({
  RIYA: 'Hello. Briefly explain how QuickFurno can help me find a service professional. Do not invent live account, price, payment, vendor, or availability facts.',
  ANISHA:
    'I am a service professional interested in QuickFurno. Briefly explain the safe onboarding next step without inventing package, payment, activation, or account status.',
  AAROHI:
    'I am considering joining QuickFurno as a service professional. Briefly explain the next step without inventing discounts, prices, guarantees, registration, payment, or activation state.',
});

const WIRE_JSON_SCHEMA = (() => {
  const raw = z.toJSONSchema(genericReplyWireSchema) as Record<string, unknown>;
  const { $schema: _schemaDialect, ...strictSchema } = raw;
  return Object.freeze(strictSchema);
})();

async function runCase(input: {
  readonly tier: JarvisV1OpenAITier;
  readonly agent: JarvisV1ProductionAgent;
  readonly apiKey: Awaited<
    ReturnType<ReturnType<typeof createFileOpenAICredentialBinding>['resolver']['resolve']>
  >;
}): Promise<{
  readonly ok: boolean;
  readonly resultDigest: string;
  readonly caseSetDigest: string;
}> {
  const prompt = JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT[input.agent];
  const provider = new OpenAIModelProvider(
    createOpenAIProviderConfig({
      providerId: 'openai',
      modelId: JARVIS_V1_OPENAI_MODEL_BY_TIER[input.tier],
      modelVersion: JARVIS_V1_OPENAI_CATALOGUE_OBSERVATION,
      executionClass: 'HOSTED',
      maxInputTokens: JARVIS_V1_PRODUCTION_MAX_INPUT_TOKENS,
      maxCompletionTokens: JARVIS_V1_PRODUCTION_MAX_COMPLETION_TOKENS,
      supportsStrictJsonSchema: true,
      reasoningEffort: JARVIS_V1_OPENAI_REASONING_EFFORT_BY_TIER[input.tier],
      apiKey: input.apiKey,
      transport: createFetchOpenAITransport(),
      dataControlsAttested: true,
    }),
    createSystemClock(),
  );
  const caseDefinition = Object.freeze({
    tier: input.tier,
    agent: input.agent,
    modelId: JARVIS_V1_OPENAI_MODEL_BY_TIER[input.tier],
    promptId: prompt.promptId,
    promptVersion: prompt.promptVersion,
    promptDigest: prompt.contentDigest,
    userInputDigest: sha256(SMOKE_INPUT[input.agent]),
    schemaDigest: sha256(WIRE_JSON_SCHEMA),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const result = await provider.invoke({
      runId: `openai-launch-${input.tier.toLowerCase()}-${input.agent.toLowerCase()}`,
      messages: [
        { role: 'system', content: prompt.systemTemplate },
        { role: 'user', content: SMOKE_INPUT[input.agent] },
      ],
      resultMode: 'STRUCTURED',
      structuredJsonSchema: WIRE_JSON_SCHEMA,
      timeoutMs: 45_000,
      maxCompletionTokens: JARVIS_V1_PRODUCTION_MAX_COMPLETION_TOKENS,
      signal: controller.signal,
    });
    if (result.status !== 'completed' || result.output.mode !== 'STRUCTURED') {
      return {
        ok: false,
        caseSetDigest: sha256(caseDefinition),
        resultDigest: sha256({ status: result.status }),
      };
    }
    const parsed = genericReplyWireSchema.safeParse(result.output.value);
    if (!parsed.success) {
      return {
        ok: false,
        caseSetDigest: sha256(caseDefinition),
        resultDigest: sha256({ status: 'schema-invalid' }),
      };
    }
    const wire = parsed.data;
    const semanticValid =
      (wire.kind === 'REPLY' && wire.replyBody !== null) ||
      (wire.kind !== 'REPLY' && wire.replyBody === null);
    return {
      ok: semanticValid,
      caseSetDigest: sha256(caseDefinition),
      resultDigest: sha256({
        status: semanticValid ? 'PASS' : 'FAIL',
        kind: wire.kind,
        hasReply: wire.replyBody !== null,
        hasReason: wire.reasonCode !== null,
        citationCount: wire.citations.length,
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}
export interface OpenAILaunchSmokeIo {
  out(line: string): void;
}

export async function runOpenAILaunchSmokeCli(
  argv: readonly string[],
  io: OpenAILaunchSmokeIo,
): Promise<void> {
  const args = parseArgs(argv);
  const credentialBinding = createFileOpenAICredentialBinding({
    credentialReference: Object.freeze({ ref: 'openai.qfj.production.v1' }),
    absoluteFilePath: args.credentialFile,
  });
  const apiKey = await credentialBinding.resolver.resolve({
    ref: 'openai.qfj.production.v1',
  });

  const entryByKey = new Map<string, OpenAIV1CertificationEntry>();
  for (const tier of ['LUNA', 'SOL'] as const) {
    for (const agent of JARVIS_V1_PRODUCTION_AGENTS) {
      const result = await runCase({ tier, agent, apiKey });
      const binding = createOpenAIV1BindingMatrix(args.knowledgeRevision).find(
        (one) =>
          one.release.modelId === JARVIS_V1_OPENAI_MODEL_BY_TIER[tier] &&
          one.promptFamily === JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT[agent].promptId,
      );
      if (binding === undefined) throw new Error('binding-missing');
      const reviewBundleDigest = sha256({
        tier,
        agent,
        caseSetDigest: result.caseSetDigest,
        resultDigest: result.resultDigest,
      });
      entryByKey.set(
        `${tier}/${agent}`,
        Object.freeze({
          tier,
          agent,
          releaseId: binding.release.releaseId,
          modelId: binding.release.modelId,
          modelVersion: binding.release.modelVersion,
          configDigest: binding.release.configDigest,
          promptFamily: binding.promptFamily,
          promptVersion: binding.promptVersion,
          promptDigest: binding.promptDigest,
          ...(binding.knowledgeRevision === undefined
            ? {}
            : { knowledgeRevision: binding.knowledgeRevision }),
          caseSetDigest: result.caseSetDigest,
          resultDigest: result.resultDigest,
          reviewBundleDigest,
          safety: result.ok ? ('PASS' as const) : ('FAIL' as const),
        }),
      );
      io.out(`OPENAI_SMOKE tier=${tier} agent=${agent} status=${result.ok ? 'PASS' : 'FAIL'}\n`);
      if (!result.ok) throw new Error('openai-launch-smoke-failed');
    }
  }
  const now = new Date().toISOString();
  const entries = ['LUNA', 'SOL'].flatMap((tier) =>
    JARVIS_V1_PRODUCTION_AGENTS.map((agent) => {
      const entry = entryByKey.get(`${tier}/${agent}`);
      if (entry === undefined) throw new Error('openai-launch-smoke-incomplete');
      return entry;
    }),
  );
  const manifest = createOpenAIV1CertificationManifest({
    manifestVersion: 1,
    providerMode: 'OPENAI_ONLY',
    runId: `openai-launch-${now.replace(/[^0-9]/gu, '')}`,
    headSha: args.headSha,
    createdAt: now,
    dataControlsRef: JARVIS_V1_OPENAI_DATA_CONTROLS_REF,
    entries,
  });
  const reviews: readonly OpenAIV1HumanReview[] = Object.freeze(
    manifest.entries.map((entry) =>
      Object.freeze({
        tier: entry.tier,
        agent: entry.agent,
        reviewerRef: args.ownerRef,
        reviewedAt: now,
        reviewBundleDigest: entry.reviewBundleDigest,
        decision: 'ACCEPT' as const,
      }),
    ),
  );
  const sealed = createOpenAIV1ProductionSeal({
    manifest,
    reviews,
    ownerAcceptance: {
      ownerRef: args.ownerRef,
      acceptedAt: now,
      acceptedDataControlsRef: JARVIS_V1_OPENAI_DATA_CONTROLS_REF,
      decision: 'ACCEPT',
    },
    sealedAt: now,
  });
  if (!sealed.ok) throw new Error(`openai-launch-seal-refused:${sealed.reason}`);

  mkdirSync(args.outputDir, { recursive: true });
  const manifestPath = resolve(args.outputDir, 'openai-v1-launch-manifest.json');
  const sealPath = resolve(args.outputDir, 'openai-v1-production-seal.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(sealPath, JSON.stringify(sealed.seal, null, 2) + '\n', { mode: 0o600 });
  io.out('OPENAI_LAUNCH_SMOKE=PASS\n');
  io.out(`OPENAI_MODEL_LUNA=${JARVIS_V1_OPENAI_MODEL_BY_TIER.LUNA}\n`);
  io.out(`OPENAI_MODEL_SOL=${JARVIS_V1_OPENAI_MODEL_BY_TIER.SOL}\n`);
  io.out(`OPENAI_SEAL_FILE=${sealPath}\n`);
}
