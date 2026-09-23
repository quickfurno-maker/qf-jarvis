/**
 * The certification runner contract: what must actually execute, and through what.
 *
 * ### The orchestration lock, expressed as a type
 *
 * Every method below runs CONVERSATIONAL turns, and the owner has locked the path those must take:
 *
 * ```
 * Jarvis internal turn boundary
 *   -> the EXISTING Mastra one-step workflow (runCustomerTurnWorkflow)
 *   -> the EXISTING Jarvis runtime and its deterministic agent assignment
 *   -> governed context / RAG where the case calls for it
 *   -> the EXISTING model reply adapter
 *   -> the QF Model Gateway, which alone selects the provider
 *   -> the real provider
 *   -> structured validation
 *   -> the existing Core/Jarvis output authorization
 * ```
 *
 * So the runner is handed the composed three-agent runtime rather than a provider, and there is no
 * method here that takes a message and a host. A hand-written request to a provider transport is not
 * agent certification, however green the result looks.
 *
 * ### Infrastructure is deliberately NOT in here
 *
 * Groq connectivity and Nara `/v1/models` are infrastructure operations and take the direct bounded
 * path; forcing them through Mastra would be symmetry for its own sake, and would put a credential in
 * the one place the orchestration lock says a credential must never be.
 *
 * ### Why this is an interface and the implementation is composed at `bin`
 *
 * The implementation needs the real composition, the real gateway and real providers. A spec needs a
 * deterministic fake that records what it was asked to do. Both satisfy this contract, so every
 * ordering, counting and refusal rule in the CLI is assertable with zero network.
 */
import type { GroqApiKey, NaraApiKey } from '@qf-jarvis/model-gateway';
import type {
  CallLedger,
  DiscoveredNaraModel,
  Jf5bCoverageManifest,
  LiveCaseRecord,
  NaraProbeScore,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';

export interface NaraSelectionInput {
  readonly shortlist: readonly DiscoveredNaraModel[];
  readonly apiKey: NaraApiKey;
  readonly runId: string;
  readonly ledger: CallLedger;
}

/**
 * What ONE shortlisted alias scored, and what each of its probes did (JF-5B-R4).
 *
 * Two existing vocabularies, reused rather than joined by a third: `NaraProbeScore` is what the scorer
 * ranks on, and `LiveCaseRecord` is the sanitized per-case record the whole lane already writes. There
 * is no new diagnostic type here, and deliberately so — a second vocabulary would be a second answer to
 * "what happened", and the two would disagree the first time either was corrected.
 *
 * `LiveCaseRecord` is content-free by construction: identities, counts, timings, closed outcome tokens
 * and a DIGEST of the output. No reply text, no response body, no header, no credential can reach it.
 */
export interface NaraProbeSummary {
  readonly score: NaraProbeScore;
  readonly cases: readonly LiveCaseRecord[];
  /** Existing sanitized JF5B diagnostics for NON-PASS probe rows only. Never authorizing. */
  readonly diagnostics?: readonly Jf5bCaseDiagnostic[];
}

/**
 * The selection answer, now carrying the per-candidate evidence either way.
 *
 * On a REFUSAL especially. Two live runs ended with `no-shortlisted-alias-passed-the-hard-gates` and
 * nothing else, which is true and almost useless: it says five aliases failed without saying what any
 * of them did. The summaries travel on both branches so a stop is diagnosable from its own output.
 */
export type NaraSelectionResult =
  | { readonly ok: true; readonly modelId: string; readonly probes: readonly NaraProbeSummary[] }
  | { readonly ok: false; readonly reason: string; readonly probes: readonly NaraProbeSummary[] };

export interface CertifyGroqInput {
  /**
   * The Groq holder the connectivity phase already resolved.
   *
   * JF-5B-R25 current production certification is Groq-only: no Nara model/key is accepted by this
   * input, so the direct certification path cannot accidentally reconstruct hosted fallback.
   */
  readonly groqApiKey: GroqApiKey;
  readonly runId: string;
  readonly headSha: string;
  /** Exact governed knowledge release exercised by this certification. */
  readonly knowledgeRevision: string;
  readonly ledger: CallLedger;
}

/** Historical v1 dual-provider input retained for old deterministic tests/audit helpers only. */
export interface CertifyAllInput {
  /** The exact alias discovery selected. Never a router alias; never a documentation example. */
  readonly naraModelId: string;
  readonly naraApiKey: NaraApiKey;
  /**
   * The Groq holder the connectivity phase already resolved.
   *
   * Passed rather than re-read: the masked resolver admits one entry per process, so asking again
   * would mean a second prompt for one secret. A holder, never a string.
   */
  readonly groqApiKey: GroqApiKey;
  /** This run's identity, and the exact head it ran at. Both travel into the manifest. */
  readonly runId: string;
  readonly headSha: string;
  readonly ledger: CallLedger;
}

/**
 * ONE case's sanitized phase-3 diagnostics (JF-5B-R8).
 *
 * A JF-5B-only, readonly, NON-AUTHORIZING structure. It exists because `LiveCaseRecord` is the canonical
 * evidence shape — validated by a strict schema, written into receipts and read by JF-5C — and widening
 * it for a diagnostic would make every consumer of that schema a consumer of this lane's debugging.
 * Nothing here is validated by the manifest, sealed, approved, or allowed to decide an outcome: the
 * outcome on the matching `LiveCaseRecord` is computed before any of these fields is filled in.
 *
 * `excerpt` is the ONLY field that carries model text, it is bounded to 240 code points, it appears in
 * the owner-local review file alone, and it is absent entirely for a `SECRET_AND_PII_LEAKAGE` case.
 */
export interface Jf5bCaseDiagnostic {
  readonly provider: string;
  readonly agent: string;
  readonly caseId: string;
  /** The sanitized wire line for a provider failure. Structure and numbers only. */
  readonly wireDiagnostic?: string;
  /** `path:code` tokens for a structured rejection, at most eight. */
  readonly schemaIssues?: readonly string[];
  /** The exact governed claim token the matcher fired on. A corpus string, never model text. */
  readonly matchedClaim?: string;
  /** The bounded local excerpt around the exact unrefused occurrence. Review file only. */
  readonly excerpt?: string;
  /** Why no excerpt was produced, when the case dimension forbids one. */
  readonly excerptOmitted?: string;
}

export interface CertifyAllResult {
  readonly ok: boolean;
  readonly reason: string;
  /** One record per executed case, content-free. Raw text lives only in `rawBundle`. */
  readonly cases: readonly LiveCaseRecord[];
  /** The six-binding manifest. Non-authorizing by construction. */
  readonly manifest: Jf5bCoverageManifest | undefined;
  /** Serialized raw outputs, written ONLY outside the repository. */
  readonly rawBundle: string;
  /** Blinded items for human review, written ONLY outside the repository. */
  readonly reviewBundle: string;
  /**
   * One sanitized diagnostic row per NON-PASS case (JF-5B-R8), in execution order.
   *
   * Empty when every case passed. Never consulted by `ok`, by the manifest, or by any approval.
   */
  readonly diagnostics: readonly Jf5bCaseDiagnostic[];
}

export interface AutoRoutingInput {
  readonly naraModelId: string;
  readonly naraApiKey: NaraApiKey;
  readonly groqApiKey: GroqApiKey;
  readonly runId: string;
  readonly ledger: CallLedger;
}

export interface AutoRoutingResult {
  readonly ok: boolean;
  readonly reason: string;
  /** AUTO with a healthy Groq: one attempt, and Nara must be untouched. */
  readonly groqSuccessNaraCalls: number;
  /** AUTO with an injected pre-network Groq fault: two attempts, the second a real Nara call. */
  readonly forcedFallbackAttempts: number;
  readonly forcedFallbackNaraCalls: number;
  /** A non-fallback class must NOT reach Nara. */
  readonly nonFallbackNaraCalls: number;
  /** Same-provider retry, which is zero everywhere in this repository. */
  readonly retryCount: number;
}

/**
 * What the executable needs performed, all of it through the existing composition.
 *
 * Three methods, because there are three genuinely different jobs: pick one model, certify six
 * provider/prompt pairs, and measure routing. A fourth would be a job nothing asked for.
 */
export interface CertificationRunner {
  /**
   * Current JF-5B-R25 path: Groq against Riya, Anisha and Aarohi with no fallback provider.
   * This is the only method the live CLI is permitted to call.
   */
  certifyGroqOnly(input: CertifyGroqInput): Promise<CertifyAllResult>;

  /** Historical v1 helpers retained for non-production audit/regression coverage only. */
  selectNaraModel(input: NaraSelectionInput): Promise<NaraSelectionResult>;
  certifyAllSix(input: CertifyAllInput): Promise<CertifyAllResult>;
  certifyAutoRouting(input: AutoRoutingInput): Promise<AutoRoutingResult>;
}
