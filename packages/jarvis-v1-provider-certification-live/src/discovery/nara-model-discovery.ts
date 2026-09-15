/**
 * Bounded authenticated NaraRouter model discovery, and the deterministic selection of ONE model.
 *
 * ### The one thing JF-5B actually adds
 *
 * The repository already had a Groq connectivity smoke, a masked-TTY secret primitive, a Nara chat
 * transport with router-alias refusal, a gateway that owns provider selection, and an evaluation
 * framework. A repository-wide audit found no authenticated `/v1/models` call anywhere, and no way to
 * learn which models a plan actually entitles. That is the gap this file closes, and it is the whole of
 * what JF-5B adds to production-shaped code.
 *
 * ### Why discovery must be bounded, and refused rather than guessed
 *
 * A discovery endpoint is an unbounded list controlled by someone else. Treating it as trustworthy
 * input is how a certification run ends up locking a model nobody chose: the first alias returned, or a
 * name that looked familiar from a documentation example, or whichever one happened to sort first.
 *
 * So the parser refuses rather than repairs. A malformed payload selects nothing. A router alias is
 * dropped by the provider's OWN `isNaraRouterAlias`, not by a second list written here. And when the
 * authenticated metadata is too thin to form a truthful shortlist, this module says so and stops
 * instead of inventing a ranking from brand names.
 *
 * ### It performs no I/O
 *
 * Everything here is pure: parse, filter, shortlist, score. The single HTTP call lives at the operator
 * boundary, where the budget and the credential are. A pure core is what lets every rule below be
 * tested against recorded payloads with zero network.
 */
import { isNaraRouterAlias } from '@qf-jarvis/model-gateway';
import { z } from 'zod';

/** The ONE discovery URL. Fixed in code; never read from configuration, argv or an environment. */
export const NARA_MODELS_ENDPOINT = 'https://router.bynara.id/v1/models';

/** The response byte ceiling. A discovery list is small; anything larger is not a discovery list. */
export const MAX_DISCOVERY_RESPONSE_BYTES = 1_048_576;

/** The page ceiling, if the documented API ever paginates. One call is the expected case. */
export const MAX_DISCOVERY_PAGES = 4;

/**
 * Selection words that may not appear as any `/` segment of a model id.
 *
 * The provider config's `isNaraRouterAlias` already covers the named aliases and the first/last segment
 * shape. This is the stricter rule discovery adds: a selection word ANYWHERE in the path. A middle
 * segment is not a shape the provider had to worry about, because the provider only ever sees an id a
 * human chose; discovery sees whatever the endpoint returns.
 */
const SELECTION_WORDS: ReadonlySet<string> = new Set([
  'auto',
  'bynara',
  'router',
  'default',
  'latest',
  'any',
  'combo',
]);

/** The exact provider-model-id grammar a certification release may pin. */
const MODEL_ID = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:\-/]*$/);

/**
 * True when a string could be a model id at all.
 *
 * The SAME grammar the parser applies to every alias the endpoint returns, exported so the owner
 * candidate path can reuse it rather than restate it. A second grammar would be a second answer to
 * "what is a model id", and the two would diverge the first time either was corrected.
 */
export function isDiscoverableModelId(value: string): boolean {
  return MODEL_ID.safeParse(value.trim()).success;
}

/**
 * One entry of the authenticated model list.
 *
 * Deliberately permissive about EXTRA fields and strict about the ones it reads. The endpoint is not
 * ours and may grow fields; refusing the whole payload because it gained one would make discovery
 * brittle for no safety gain. What must not happen is inferring a capability the response did not
 * state, so every optional field below stays `undefined` when absent rather than defaulting to a value.
 */
const entrySchema = z.looseObject({
  id: z.string(),
  object: z.string().optional(),
  /** Whether the provider says this is a reasoning model. Recorded, never used as a quality signal. */
  reasoning: z.boolean().optional(),
  /** The context window, when stated. Used only to exclude models too small for Jarvis's bounds. */
  context_length: z.number().int().positive().optional(),
  /** What the provider says the model is for, when stated. */
  modality: z.string().optional(),
  type: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

const listSchema = z.looseObject({
  object: z.string().optional(),
  data: z.array(entrySchema).max(4096),
});

/** One discovered model, normalized to the fields this lane may act on. */
export interface DiscoveredNaraModel {
  readonly modelId: string;
  /** `undefined` when the endpoint did not say. Never defaulted. */
  readonly reasoning: boolean | undefined;
  readonly contextLength: number | undefined;
  readonly modality: string | undefined;
  readonly capabilities: readonly string[] | undefined;
}

/** Why one alias was dropped. Closed, so a report can count reasons without free text. */
export const DISCOVERY_REJECTIONS = [
  'malformed-model-id',
  'router-alias',
  'selection-word-segment',
  'combo-model',
  'duplicate-alias',
  'not-a-chat-model',
] as const;
export type DiscoveryRejection = (typeof DISCOVERY_REJECTIONS)[number];

export interface RejectedAlias {
  readonly modelId: string;
  readonly reason: DiscoveryRejection;
}

export interface NaraDiscoveryResult {
  readonly eligible: readonly DiscoveredNaraModel[];
  readonly rejected: readonly RejectedAlias[];
  readonly totalReturned: number;
}

/** Modalities and types that are not a chat model, however they are spelled. */
const NON_CHAT_MARKERS = ['embedding', 'embed', 'rerank', 'image', 'video', 'audio', 'moderation'];

function looksNonChat(entry: DiscoveredNaraModel): boolean {
  const haystack = [entry.modality ?? '', ...(entry.capabilities ?? [])].join(' ').toLowerCase();
  if (haystack.length > 0 && NON_CHAT_MARKERS.some((marker) => haystack.includes(marker))) {
    // Only when the marker is the model's STATED purpose, not when `chat` also appears.
    return !haystack.includes('chat') && !haystack.includes('text');
  }
  const id = entry.modelId.toLowerCase();
  return NON_CHAT_MARKERS.some((marker) => id.includes(marker));
}

/**
 * Parse and filter one authenticated discovery payload.
 *
 * Returns `undefined` for a payload that is not a model list at all — a redirect body, an error page, a
 * truncated response. `undefined` selects nothing, which is the point: a malformed discovery must not
 * be able to choose a model.
 */
export function parseNaraModelDiscovery(payload: unknown): NaraDiscoveryResult | undefined {
  const parsed = listSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  const eligible: DiscoveredNaraModel[] = [];
  const rejected: RejectedAlias[] = [];
  const seen = new Set<string>();

  for (const entry of parsed.data.data) {
    const raw = entry.id.trim();
    if (!MODEL_ID.safeParse(raw).success) {
      rejected.push({ modelId: raw, reason: 'malformed-model-id' });
      continue;
    }
    if (seen.has(raw.toLowerCase())) {
      rejected.push({ modelId: raw, reason: 'duplicate-alias' });
      continue;
    }
    seen.add(raw.toLowerCase());

    // The PROVIDER's own refusal, reused rather than restated. A second alias list here would be a
    // second answer to "may Jarvis pin this", and the two would diverge.
    if (isNaraRouterAlias(raw)) {
      rejected.push({ modelId: raw, reason: 'router-alias' });
      continue;
    }
    const segments = raw.toLowerCase().split('/');
    if (segments.includes('combo')) {
      rejected.push({ modelId: raw, reason: 'combo-model' });
      continue;
    }
    if (segments.some((segment) => SELECTION_WORDS.has(segment))) {
      rejected.push({ modelId: raw, reason: 'selection-word-segment' });
      continue;
    }

    const model: DiscoveredNaraModel = {
      modelId: raw,
      reasoning: entry.reasoning,
      contextLength: entry.context_length,
      modality: entry.modality ?? entry.type,
      capabilities:
        entry.capabilities === undefined ? undefined : Object.freeze([...entry.capabilities]),
    };
    if (looksNonChat(model)) {
      rejected.push({ modelId: raw, reason: 'not-a-chat-model' });
      continue;
    }
    eligible.push(Object.freeze(model));
  }

  return Object.freeze({
    eligible: Object.freeze(eligible),
    rejected: Object.freeze(rejected),
    totalReturned: parsed.data.data.length,
  });
}

/** The shortlist ceiling. Five probes across three agents is already a real spend. */
export const MAX_SHORTLIST = 5;

/**
 * The minimum context window a Jarvis request needs.
 *
 * Derived from the gateway's own generic bound rather than guessed: a structured reply plan carries the
 * system prompt, the bounded turn payload and up to eight governed records. A model that cannot hold
 * that cannot serve any of the three agents, whatever else it is good at.
 */
export const MIN_CONTEXT_LENGTH = 8192;

export const SHORTLIST_REFUSALS = [
  'no-eligible-models',
  'metadata-insufficient-for-truthful-shortlist',
] as const;
export type ShortlistRefusal = (typeof SHORTLIST_REFUSALS)[number];

export type ShortlistResult =
  | { readonly ok: true; readonly shortlist: readonly DiscoveredNaraModel[] }
  | { readonly ok: false; readonly refusal: ShortlistRefusal };

/**
 * Build the shortlist, deterministically and BEFORE any model output is seen.
 *
 * The rule, declared here so it cannot be adjusted after results arrive:
 *
 * 1. every eligible model must state a context length, and it must meet {@link MIN_CONTEXT_LENGTH};
 * 2. order by stated context length DESCENDING, then by exact alias lexical order;
 * 3. take at most {@link MAX_SHORTLIST}.
 *
 * Rule 1 is the honest stop. If the endpoint states no context length, there is no stable capability
 * field to rank on, and the only alternative would be guessing from brand names — which is how a
 * certification run silently becomes someone's opinion about which vendor sounds better. In that case
 * this refuses with `metadata-insufficient-for-truthful-shortlist` and the operator stops for an owner
 * decision, printing the sanitized eligible aliases.
 *
 * Context length is a CAPACITY signal, not a quality signal, and is used only to order candidates for
 * probing. Which one wins is decided by the probe scores, never by this ordering.
 */
export function buildNaraShortlist(eligible: readonly DiscoveredNaraModel[]): ShortlistResult {
  if (eligible.length === 0) {
    return Object.freeze({ ok: false as const, refusal: 'no-eligible-models' as const });
  }
  const withContext = eligible.filter(
    (model) => model.contextLength !== undefined && model.contextLength >= MIN_CONTEXT_LENGTH,
  );
  if (withContext.length === 0) {
    return Object.freeze({
      ok: false as const,
      refusal: 'metadata-insufficient-for-truthful-shortlist' as const,
    });
  }
  const ordered = [...withContext].sort((a, b) => {
    const left = a.contextLength ?? 0;
    const right = b.contextLength ?? 0;
    if (left !== right) {
      return right - left;
    }
    return a.modelId < b.modelId ? -1 : a.modelId > b.modelId ? 1 : 0;
  });
  return Object.freeze({
    ok: true as const,
    shortlist: Object.freeze(ordered.slice(0, MAX_SHORTLIST)),
  });
}

/**
 * What one shortlisted model scored across the probe set.
 *
 * Every field is a measurement, not a judgement. `hardGatesPassed` is the only thing that can disqualify
 * a model; the rest only order the ones that already passed.
 */
export interface NaraProbeScore {
  readonly modelId: string;
  /** Every required structured output validated, every scope served, nothing forbidden claimed. */
  readonly hardGatesPassed: boolean;
  /** Deterministic task-quality checks passed, out of the probes attempted. */
  readonly qualityPassed: number;
  readonly qualityAttempted: number;
  readonly p95LatencyMs: number;
  readonly totalTokens: number;
}

/**
 * Rank scored models by the formula declared BEFORE execution.
 *
 * 1. hard safety/contract pass is REQUIRED — a model that failed one is not ranked, it is excluded;
 * 2. higher deterministic task-quality score;
 * 3. lower p95 latency;
 * 4. lower measured token consumption;
 * 5. exact alias lexical order, as the final tie-break only.
 *
 * Returns `undefined` when nothing passed the hard gates, which is a stop rather than a winner.
 */
export function selectNaraModel(scores: readonly NaraProbeScore[]): NaraProbeScore | undefined {
  const passed = scores.filter((score) => score.hardGatesPassed);
  if (passed.length === 0) {
    return undefined;
  }
  const ranked = [...passed].sort((a, b) => {
    const qualityA = a.qualityAttempted === 0 ? 0 : a.qualityPassed / a.qualityAttempted;
    const qualityB = b.qualityAttempted === 0 ? 0 : b.qualityPassed / b.qualityAttempted;
    if (qualityA !== qualityB) {
      return qualityB - qualityA;
    }
    if (a.p95LatencyMs !== b.p95LatencyMs) {
      return a.p95LatencyMs - b.p95LatencyMs;
    }
    if (a.totalTokens !== b.totalTokens) {
      return a.totalTokens - b.totalTokens;
    }
    return a.modelId < b.modelId ? -1 : a.modelId > b.modelId ? 1 : 0;
  });
  return ranked[0];
}
