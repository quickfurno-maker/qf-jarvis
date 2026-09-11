/**
 * The non-secret preflight summary, and the argv surface that reaches the two gates.
 *
 * ### The summary is the second gate
 *
 * The typed confirmation is only meaningful if the person typing it has been shown what is about to
 * happen. So this renders every non-secret fact the mandate requires — head, cleanliness, providers,
 * ceilings, endpoints, the exact prompt digests, the output directory, retry posture and the
 * synthetic-only statement — and it renders them BEFORE any credential is requested.
 *
 * Nothing here reads a terminal, a filesystem or a network. It formats facts it is handed, so the whole
 * summary can be asserted line by line in a test with no environment at all.
 */
import { AAROHI_ACQUISITION_PROMPT_V1 } from '@qf-jarvis/aarohi-prompts';
import { ANISHA_VENDOR_JOURNEY_PROMPT_V1 } from '@qf-jarvis/anisha-prompts';
import { RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1 } from '@qf-jarvis/riya-prompts';

import { NARA_MODELS_ENDPOINT } from '../discovery/nara-model-discovery.js';
import {
  EXECUTE_LIVE_FLAG,
  JF5B_BUDGET,
  LIVE_CONFIRMATION_PHRASE,
} from '../contracts/live-execution-gate.js';
import { GROQ_DATA_CONTROLS_REF, NARA_DATA_CONTROLS_REF } from '../releases/jf5b-releases.js';

/** The Nara chat endpoint, restated for the summary. The transport owns the real constant. */
export const NARA_CHAT_HOST = 'router.bynara.id';
/** The Groq host, for the summary only. The Groq smoke owns the real endpoint. */
export const GROQ_CHAT_HOST = 'api.groq.com';

export interface PreflightFacts {
  readonly headSha: string;
  readonly worktreeClean: boolean;
  readonly ciRunId: string;
  readonly ciConclusion: string;
  readonly outputDirectory: string;
  readonly runId: string;
}

/**
 * Render the summary.
 *
 * Returns lines rather than printing them, so a spec can assert the content without capturing stdout
 * and so the caller decides where it goes.
 */
export function renderPreflightSummary(facts: PreflightFacts): readonly string[] {
  return Object.freeze([
    'JF-5B live three-agent provider certification — PREFLIGHT',
    '',
    `  repository head        ${facts.headSha}`,
    `  worktree               ${facts.worktreeClean ? 'CLEAN' : 'DIRTY — refuse'}`,
    `  exact-head CI          ${facts.ciRunId} ${facts.ciConclusion}`,
    `  run id                 ${facts.runId}`,
    `  output directory       ${facts.outputDirectory}`,
    '',
    '  providers              groq (primary), nara (fallback)',
    `  groq host              ${GROQ_CHAT_HOST}`,
    `  nara chat host         ${NARA_CHAT_HOST}`,
    `  nara discovery         GET ${NARA_MODELS_ENDPOINT}`,
    '',
    `  max groq calls         ${String(JF5B_BUDGET.maxGroqCalls)}`,
    `  max nara calls         ${String(JF5B_BUDGET.maxNaraCalls)}`,
    `  max total calls        ${String(JF5B_BUDGET.maxTotalCalls)}`,
    `  max estimated spend    USD ${String(JF5B_BUDGET.maxEstimatedSpendUsd)}`,
    '  same-provider retry    0',
    '',
    `  riya prompt            ${RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1.promptId} v${String(RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1.promptVersion)} ${RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1.contentDigest}`,
    `  anisha prompt          ${ANISHA_VENDOR_JOURNEY_PROMPT_V1.promptId} v${String(ANISHA_VENDOR_JOURNEY_PROMPT_V1.promptVersion)} ${ANISHA_VENDOR_JOURNEY_PROMPT_V1.contentDigest}`,
    `  aarohi prompt          ${AAROHI_ACQUISITION_PROMPT_V1.promptId} v${String(AAROHI_ACQUISITION_PROMPT_V1.promptVersion)} ${AAROHI_ACQUISITION_PROMPT_V1.contentDigest}`,
    '',
    `  groq data controls     ${GROQ_DATA_CONTROLS_REF}`,
    `  nara data controls     ${NARA_DATA_CONTROLS_REF}`,
    '  nara posture           content forwarded to the underlying provider; not used to train Nara',
    '                         models and not sold; retained for a limited period for abuse detection,',
    '                         debugging and legal obligations; international processing possible.',
    '                         This is NOT zero data retention and is NOT claimed as ZDR.',
    '',
    '  FIXTURES               SYNTHETIC ONLY. No QuickFurno customer or vendor record, no PII, no',
    '                         payment, phone, email, lead, package, credit or consent state is sent.',
    '  THIS RUN               certifies; it does NOT activate. No production approval is minted.',
    '',
    `  To proceed, type exactly: ${LIVE_CONFIRMATION_PHRASE}`,
    `  (started with ${EXECUTE_LIVE_FLAG}; the phrase is NOT accepted as an argument)`,
  ]);
}

/** Parsed argv for the operator. Deliberately tiny: one switch and two non-secret paths. */
export interface CertifyArgv {
  readonly executeLive: boolean;
  readonly outputDirectory: string | undefined;
  /**
   * The NON-SECRET Groq smoke configuration file.
   *
   * Required because the existing `@qf-jarvis/groq-staging-smoke` contract is `loadSmokeConfig(path)`,
   * and reusing that harness rather than writing a second connectivity call is the whole point. The
   * file carries release identity and bounds; the smoke's own parser refuses any credential-shaped key
   * in it, so this argument cannot become a way to pass a secret.
   */
  readonly groqSmokeConfig: string | undefined;
  readonly unknown: readonly string[];
}

/**
 * Parse argv without interpreting a secret.
 *
 * There is no `--api-key`, no `--token`, no `--secret` and no positional credential, and a spec asserts
 * that no such switch exists. A credential that can be passed as an argument is a credential in the
 * shell history of whoever ran it.
 */
export function parseCertifyArgv(argv: readonly string[]): CertifyArgv {
  let executeLive = false;
  let outputDirectory: string | undefined;
  let groqSmokeConfig: string | undefined;
  const unknown: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === EXECUTE_LIVE_FLAG) {
      executeLive = true;
      continue;
    }
    if (arg === '--output-dir') {
      const next = argv[index + 1];
      if (next !== undefined) {
        outputDirectory = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--output-dir=')) {
      outputDirectory = arg.slice('--output-dir='.length);
      continue;
    }
    if (arg === '--groq-smoke-config') {
      const next = argv[index + 1];
      if (next !== undefined) {
        groqSmokeConfig = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--groq-smoke-config=')) {
      groqSmokeConfig = arg.slice('--groq-smoke-config='.length);
      continue;
    }
    unknown.push(arg);
  }
  return Object.freeze({
    executeLive,
    outputDirectory,
    groqSmokeConfig,
    unknown: Object.freeze(unknown),
  });
}
