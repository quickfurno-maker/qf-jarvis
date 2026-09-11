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
} from '@qf-jarvis/jarvis-v1-provider-certification-live';

export interface NaraSelectionInput {
  readonly shortlist: readonly DiscoveredNaraModel[];
  readonly apiKey: NaraApiKey;
  readonly runId: string;
  readonly ledger: CallLedger;
}

export type NaraSelectionResult =
  { readonly ok: true; readonly modelId: string } | { readonly ok: false; readonly reason: string };

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
  /** Phase 2c. Bounded probes per shortlisted alias, through the gateway, never a raw transport. */
  selectNaraModel(input: NaraSelectionInput): Promise<NaraSelectionResult>;
  /** Phase 3. The six direct certifications: Groq and Nara, each against all three agents. */
  certifyAllSix(input: CertifyAllInput): Promise<CertifyAllResult>;
  /** Phase 4. AUTO success, forced fallback and a non-fallback class. */
  certifyAutoRouting(input: AutoRoutingInput): Promise<AutoRoutingResult>;
}
