/**
 * The OWNER-SUPPLIED Nara candidate shortlist (JF-5B-R3).
 *
 * ### The gap this closes, and only this one
 *
 * A real authenticated run reached `/v1/models`, got HTTP 200, and found 50 eligible aliases. The
 * endpoint stated no context length, so `buildNaraShortlist` refused with
 * `metadata-insufficient-for-truthful-shortlist` and the operator printed the aliases and stopped.
 *
 * That refusal is CORRECT and stays the default. Its own doc says the run "stops for an owner
 * decision" — and the CLI had no way to carry that decision into the next run. This module is that
 * channel, and nothing more.
 *
 * ### The owner chooses the candidate SET; the probes still choose the winner
 *
 * Everything here answers exactly one question: *which models are worth probing?* It performs no
 * ranking, reads no brand name, infers no context length and picks no winner. The existing
 * `selectNaraModel` scorer — hard gates, then quality, then p95 latency, then tokens, then lexical
 * tie-break — is untouched and still decides.
 *
 * ### Authenticated discovery stays authoritative
 *
 * A candidate is not a way to name a model; it is a way to name one of the models the ACCOUNT was just
 * told it may use. Every candidate is re-verified against `discovered.eligible` on every run, by exact
 * case-sensitive match, and the object that goes forward is the one the endpoint returned — never one
 * synthesised from argv. So an alias that stops being entitled, or starts being rejected as a router
 * alias or a non-chat model, refuses the run instead of silently pinning something stale.
 */
import { isNaraRouterAlias } from '@qf-jarvis/model-gateway';

import { MAX_SHORTLIST, isDiscoverableModelId } from './nara-model-discovery.js';
import type { DiscoveredNaraModel } from './nara-model-discovery.js';

/** Why an owner candidate set was refused. Closed, sanitized, and never a free-text message. */
export const OWNER_CANDIDATE_REFUSALS = [
  'owner-candidate-empty',
  'owner-candidate-malformed',
  'owner-candidate-router-alias',
  'owner-candidate-duplicate',
  'owner-candidate-too-many',
  'owner-candidate-not-currently-eligible',
] as const;
export type OwnerCandidateRefusal = (typeof OWNER_CANDIDATE_REFUSALS)[number];

export type OwnerCandidateCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: OwnerCandidateRefusal; readonly modelId: string };

/**
 * Check the SHAPE of an owner candidate set, before any credential or network.
 *
 * Shape only: whether these strings could name a model at all, and whether the owner asked for a set
 * this lane can afford to probe. Whether any of them is currently entitled is a question only the
 * authenticated endpoint can answer, and {@link resolveOwnerCandidateShortlist} asks it later.
 *
 * An empty set is legal and means "no owner decision" — the metadata-driven path then applies exactly
 * as before.
 */
export function checkOwnerCandidates(candidates: readonly string[]): OwnerCandidateCheck {
  if (candidates.length > MAX_SHORTLIST) {
    // The ceiling is the shortlist ceiling, not a new number: five probes across three agents is
    // already a real spend, and the owner does not get a bigger budget by naming the models.
    return Object.freeze({
      ok: false as const,
      refusal: 'owner-candidate-too-many' as const,
      modelId: String(candidates.length),
    });
  }
  const seen = new Set<string>();
  for (const raw of candidates) {
    if (raw.trim().length === 0) {
      return Object.freeze({
        ok: false as const,
        refusal: 'owner-candidate-empty' as const,
        modelId: '',
      });
    }
    // The SAME grammar the discovery parser applies to an alias the endpoint returned. A second
    // grammar here would be a second answer to "what is a model id", and the two would diverge.
    if (!isDiscoverableModelId(raw)) {
      return Object.freeze({
        ok: false as const,
        refusal: 'owner-candidate-malformed' as const,
        modelId: raw,
      });
    }
    // The PROVIDER's own refusal, reused. There is no second router-alias list anywhere in this lane.
    if (isNaraRouterAlias(raw)) {
      return Object.freeze({
        ok: false as const,
        refusal: 'owner-candidate-router-alias' as const,
        modelId: raw,
      });
    }
    // Case-INSENSITIVELY, because the endpoint treats a duplicate alias that way and because naming
    // the same model twice would buy it two probes' worth of evidence.
    const key = raw.toLowerCase();
    if (seen.has(key)) {
      return Object.freeze({
        ok: false as const,
        refusal: 'owner-candidate-duplicate' as const,
        modelId: raw,
      });
    }
    seen.add(key);
  }
  return Object.freeze({ ok: true as const });
}

export type OwnerShortlistResult =
  | { readonly ok: true; readonly shortlist: readonly DiscoveredNaraModel[] }
  | { readonly ok: false; readonly refusal: OwnerCandidateRefusal; readonly modelId: string };

/**
 * Resolve owner candidates against THIS run's authenticated eligible list.
 *
 * Exact and case-SENSITIVE. A case-only mismatch is refused rather than repaired: the endpoint is the
 * authority on how an alias is spelled, and quietly correcting the owner's spelling would mean the
 * receipt named a model the owner never typed.
 *
 * Owner ORDER is preserved, because the owner typed it and nothing here has a better idea. Order does
 * not decide anything — every candidate is probed and the scorer picks the winner — but preserving it
 * keeps the probe log readable against the command that produced it.
 *
 * Context length is NOT required here, and that is the point of the whole module. The metadata rule
 * exists so that an AUTOMATIC shortlist cannot be built by guessing from brand names; an owner naming
 * five aliases from the authenticated list is not a guess, and demanding a field the endpoint does not
 * publish would make the continuation channel useless in exactly the case it was built for.
 */
export function resolveOwnerCandidateShortlist(
  candidates: readonly string[],
  eligible: readonly DiscoveredNaraModel[],
): OwnerShortlistResult {
  const shape = checkOwnerCandidates(candidates);
  if (!shape.ok) {
    return shape;
  }
  const byExactId = new Map(eligible.map((model) => [model.modelId, model]));
  const shortlist: DiscoveredNaraModel[] = [];
  for (const candidate of candidates) {
    const discovered = byExactId.get(candidate);
    if (discovered === undefined) {
      // Absent, rejected by the filters, or no longer entitled. All three are the same answer: this
      // run may not probe it.
      return Object.freeze({
        ok: false as const,
        refusal: 'owner-candidate-not-currently-eligible' as const,
        modelId: candidate,
      });
    }
    // The object the ENDPOINT returned, never `{ modelId: candidate }`. A synthesised model would
    // carry no capability fields and would quietly claim the endpoint said nothing about it.
    shortlist.push(discovered);
  }
  return Object.freeze({ ok: true as const, shortlist: Object.freeze(shortlist) });
}
