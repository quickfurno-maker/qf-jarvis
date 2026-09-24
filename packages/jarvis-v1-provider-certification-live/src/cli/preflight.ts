/**
 * JF-5B-R25 Groq-only live-certification preflight and argv surface.
 *
 * Nara is deliberately absent from the executable surface. Historical Nara discovery utilities remain
 * elsewhere for audit compatibility, but this parser accepts no Nara candidate/model/provider switch.
 */
import { AAROHI_ACQUISITION_PROMPT_V1 } from '@qf-jarvis/aarohi-prompts';
import { ANISHA_VENDOR_JOURNEY_PROMPT_V1 } from '@qf-jarvis/anisha-prompts';
import { RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1 } from '@qf-jarvis/riya-prompts';

import {
  GROQ_OBSERVED_RPM,
  GROQ_OBSERVED_TPM,
  MIN_MODEL_CALL_INTERVAL_MS,
  PACING_TARGET_TPM,
  RATE_LIMIT_COOLDOWN_MS,
} from '../contracts/groq-live-pacing.js';
import {
  EXECUTE_LIVE_FLAG,
  JF5B_GROQ_ONLY_BUDGET,
  LIVE_CONFIRMATION_PHRASE,
} from '../contracts/live-execution-gate.js';
import { GROQ_DATA_CONTROLS_REF, JF5B_PROVIDER_MODE } from '../releases/jf5b-releases.js';

export const GROQ_CHAT_HOST = 'api.groq.com';
/** Historical Nara host constant retained for audit compatibility; the live CLI no longer uses it. */
export const NARA_CHAT_HOST = 'router.bynara.id';

/**
 * Historical switch name, exported only so tests/callers can prove it is now refused.
 * parseCertifyArgv intentionally has no branch that accepts it.
 */
export const NARA_CANDIDATE_FLAG = '--nara-candidate';

export interface PreflightFacts {
  readonly headSha: string;
  readonly worktreeClean: boolean;
  readonly ciRunId: string;
  readonly ciConclusion: string;
  readonly outputDirectory: string;
  readonly runId: string;
  /** Historical compatibility field; ignored in Groq-only mode and must be empty in live use. */
  readonly naraCandidates?: readonly string[];
  readonly groqCertificationModelId: string;
  /** Explicit serving knowledge posture under certification. */
  readonly knowledgeMode?: 'DISABLED' | 'HYBRID';
  /** Exact governed knowledge release for a current grounded certification. */
  readonly knowledgeRevision?: string;
}

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
    `  provider mode          ${JF5B_PROVIDER_MODE}`,
    '  providers              groq only (Nara disabled; no hosted fallback)',
    `  groq host              ${GROQ_CHAT_HOST}`,
    '  groq connectivity smoke  as supplied by --groq-smoke-config (phase 1 only)',
    `  groq certification model ${facts.groqCertificationModelId} (phase 2)`,
    `  knowledge mode          ${facts.knowledgeMode ?? 'UNSPECIFIED — historical/audit helper only'}`,
    `  knowledge revision      ${facts.knowledgeRevision ?? 'UNBOUND'}`,
    '',
    `  max groq calls         ${String(JF5B_GROQ_ONLY_BUDGET.maxGroqCalls)}`,
    `  max nara calls         ${String(JF5B_GROQ_ONLY_BUDGET.maxNaraCalls)} (hard-disabled)`,
    `  max total calls        ${String(JF5B_GROQ_ONLY_BUDGET.maxTotalCalls)}`,
    `  max estimated spend    USD ${String(JF5B_GROQ_ONLY_BUDGET.maxEstimatedSpendUsd)}`,
    '  same-provider retry    0',
    '  provider fallback      NONE',
    '',
    '  JF-5B GROQ PACING      evaluation-only; production serving pacing is unchanged',
    `  groq observed RPM      ${String(GROQ_OBSERVED_RPM)} (project inherits organisation limits)`,
    `  groq observed TPM      ${String(GROQ_OBSERVED_TPM)}`,
    `  groq pacing target TPM ${String(PACING_TARGET_TPM)} (25% headroom under the observed ceiling)`,
    `  groq min call interval ${String(MIN_MODEL_CALL_INTERVAL_MS / 1000)}s`,
    `  rate-limit cooldown    ${String(RATE_LIMIT_COOLDOWN_MS / 1000)}s, applied to the NEXT case; the failed case is never retried`,
    '',
    `  riya prompt            ${RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1.promptId} v${String(RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1.promptVersion)} ${RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1.contentDigest}`,
    `  anisha prompt          ${ANISHA_VENDOR_JOURNEY_PROMPT_V1.promptId} v${String(ANISHA_VENDOR_JOURNEY_PROMPT_V1.promptVersion)} ${ANISHA_VENDOR_JOURNEY_PROMPT_V1.contentDigest}`,
    `  aarohi prompt          ${AAROHI_ACQUISITION_PROMPT_V1.promptId} v${String(AAROHI_ACQUISITION_PROMPT_V1.promptVersion)} ${AAROHI_ACQUISITION_PROMPT_V1.contentDigest}`,
    '',
    `  groq data controls     ${GROQ_DATA_CONTROLS_REF}`,
    '  nara                   DISABLED — no credential, discovery, probe, certification or fallback call',
    '  future local provider  NOT ACTIVE — requires a separate release + certification before use',
    '',
    '  FIXTURES               SYNTHETIC ONLY. No QuickFurno customer or vendor record, no PII, no',
    '                         payment, phone, email, lead, package, credit or consent state is sent.',
    '  THIS RUN               certifies Groq only; it does NOT activate. No production approval is minted.',
    '',
    `  To proceed, type exactly: ${LIVE_CONFIRMATION_PHRASE}`,
    `  (started with ${EXECUTE_LIVE_FLAG}; the phrase is NOT accepted as an argument)`,
  ]);
}

export interface CertifyArgv {
  readonly executeLive: boolean;
  readonly outputDirectory: string | undefined;
  readonly groqSmokeConfig: string | undefined;
  readonly knowledgeMode: 'DISABLED' | 'HYBRID' | undefined;
  readonly knowledgeRevision: string | undefined;
  /** Historical compatibility only. Always empty; Nara flags are collected as unknown. */
  readonly naraCandidates: readonly string[];
  readonly unknown: readonly string[];
}

/**
 * Parse only the Groq-only operator surface. Any retired Nara/provider option is therefore an unknown
 * argument and fails closed before credentials or network calls.
 */
export function parseCertifyArgv(argv: readonly string[]): CertifyArgv {
  let executeLive = false;
  let outputDirectory: string | undefined;
  let groqSmokeConfig: string | undefined;
  let knowledgeMode: 'DISABLED' | 'HYBRID' | undefined;
  let knowledgeRevision: string | undefined;
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
    if (arg === '--knowledge-mode') {
      const next = argv[index + 1];
      if (next === 'DISABLED' || next === 'HYBRID') {
        knowledgeMode = next;
        index += 1;
      } else if (next !== undefined) {
        unknown.push(arg, next);
        index += 1;
      } else {
        unknown.push(arg);
      }
      continue;
    }
    if (arg.startsWith('--knowledge-mode=')) {
      const value = arg.slice('--knowledge-mode='.length);
      if (value === 'DISABLED' || value === 'HYBRID') knowledgeMode = value;
      else unknown.push(arg);
      continue;
    }
    if (arg === '--knowledge-revision') {
      const next = argv[index + 1];
      if (next !== undefined) {
        knowledgeRevision = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--knowledge-revision=')) {
      knowledgeRevision = arg.slice('--knowledge-revision='.length);
      continue;
    }
    unknown.push(arg);
  }

  return Object.freeze({
    executeLive,
    outputDirectory,
    groqSmokeConfig,
    knowledgeMode,
    knowledgeRevision,
    naraCandidates: Object.freeze([]),
    unknown: Object.freeze(unknown),
  });
}
