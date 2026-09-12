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

import {
  GROQ_OBSERVED_RPM,
  GROQ_OBSERVED_TPM,
  MIN_MODEL_CALL_INTERVAL_MS,
  PACING_TARGET_TPM,
  RATE_LIMIT_COOLDOWN_MS,
} from '../contracts/groq-live-pacing.js';
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

/**
 * The ONE repeatable non-secret switch that carries an owner's Nara candidate decision (JF-5B-R3).
 *
 * There is deliberately no `--nara-model`, no `--nara-winner` and no `--provider`. This names models
 * worth PROBING; it cannot name a winner, and the scorer is the only thing that can.
 */
export const NARA_CANDIDATE_FLAG = '--nara-candidate';

export interface PreflightFacts {
  readonly headSha: string;
  readonly worktreeClean: boolean;
  readonly ciRunId: string;
  readonly ciConclusion: string;
  readonly outputDirectory: string;
  readonly runId: string;
  /** The owner-supplied Nara candidates, or empty for the metadata-driven shortlist. */
  readonly naraCandidates: readonly string[];
  /**
   * The Groq model PHASE 3 certifies (JF-5B-R10).
   *
   * Supplied by the application, because the candidate is an application constant and this package sits
   * below it. Printed beside the connectivity smoke so the owner can see that the two are DIFFERENT
   * things: phase 1 proves a credential and a host reach Groq at all, using whatever model the local
   * smoke file names, and phase 3 is the certification of this one.
   */
  readonly groqCertificationModelId: string;
}

/**
 * The candidate block, or the one line that says there is no owner decision.
 *
 * Numbered from 1 rather than listed, so a reader can count them against the command they typed and
 * see immediately that nothing was added, dropped or reordered.
 */
function renderCandidateLines(candidates: readonly string[]): readonly string[] {
  if (candidates.length === 0) {
    return ['  nara candidate source  DISCOVERY_METADATA'];
  }
  return [
    '  nara candidate source  OWNER_EXPLICIT',
    ...candidates.map(
      (alias, position) => `  nara candidate ${String(position + 1)}       ${alias}`,
    ),
  ];
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
    // JF-5B-R10. TWO different things, printed adjacently because conflating them costs an owner a
    // pointless edit to a local file. Phase 1 proves the credential and the host with whatever model the
    // supplied smoke config names; phase 3 certifies the model below. The smoke file is not touched.
    '  groq connectivity smoke  as supplied by --groq-smoke-config (phase 1 only)',
    `  groq certification model ${facts.groqCertificationModelId} (phase 3)`,
    `  nara chat host         ${NARA_CHAT_HOST}`,
    `  nara discovery         GET ${NARA_MODELS_ENDPOINT}`,
    // The owner must SEE the exact candidate set before typing the phrase. A decision nobody can read
    // back is not a decision anybody made.
    ...renderCandidateLines(facts.naraCandidates),
    '',
    `  max groq calls         ${String(JF5B_BUDGET.maxGroqCalls)}`,
    `  max nara calls         ${String(JF5B_BUDGET.maxNaraCalls)}`,
    `  max total calls        ${String(JF5B_BUDGET.maxTotalCalls)}`,
    `  max estimated spend    USD ${String(JF5B_BUDGET.maxEstimatedSpendUsd)}`,
    '  same-provider retry    0',
    '',
    // JF-5B-R6. The observed limits are what the owner READ in the provider console on 2026-09-12, and
    // the pacing values are what THIS LANE aims at. Neither is a production limit or a production
    // policy: no serving path is paced, and nothing here promises anything about the platform.
    '  JF-5B GROQ PACING      evaluation-only; production serving pacing is unchanged',
    `  groq observed RPM      ${String(GROQ_OBSERVED_RPM)} (project inherits organisation limits)`,
    `  groq observed TPM      ${String(GROQ_OBSERVED_TPM)}`,
    `  groq pacing target TPM ${String(PACING_TARGET_TPM)} (25% headroom under the observed ceiling)`,
    `  groq min call interval ${String(MIN_MODEL_CALL_INTERVAL_MS / 1000)}s`,
    `  rate-limit cooldown    ${String(RATE_LIMIT_COOLDOWN_MS / 1000)}s, applied to the NEXT case; the failed case is never retried`,
    '  nara pacing            none; this pacer is Groq-only',
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
  /**
   * The NON-SECRET owner-supplied Nara candidate aliases, in the order they were typed (JF-5B-R3).
   *
   * Repeatable, never comma-delimited, and deliberately not a file or an environment variable: this is
   * a decision a person makes about one run, and it belongs where a person can see it. It carries no
   * secret and may appear in a shell history.
   *
   * Empty means "no owner decision", and the metadata-driven shortlist applies exactly as before.
   */
  readonly naraCandidates: readonly string[];
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
  const naraCandidates: string[] = [];
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
    // REPEATABLE, and never split on a comma: a model id may legitimately contain punctuation, and a
    // delimiter here would be this lane inventing a syntax the endpoint never uses. An empty value is
    // collected rather than dropped, so the validator refuses it by name instead of silently
    // shortening the set.
    if (arg === NARA_CANDIDATE_FLAG) {
      const next = argv[index + 1];
      if (next !== undefined) {
        naraCandidates.push(next);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith(`${NARA_CANDIDATE_FLAG}=`)) {
      naraCandidates.push(arg.slice(NARA_CANDIDATE_FLAG.length + 1));
      continue;
    }
    unknown.push(arg);
  }
  return Object.freeze({
    executeLive,
    outputDirectory,
    groqSmokeConfig,
    naraCandidates: Object.freeze(naraCandidates),
    unknown: Object.freeze(unknown),
  });
}
