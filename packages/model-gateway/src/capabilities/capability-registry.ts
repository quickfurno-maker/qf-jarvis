/**
 * The immutable model capability registry (QFJ-P04.02, ADR-0050).
 *
 * An injected, non-global, immutable registry of capability profiles keyed by exact release identity. It
 * rejects a duplicate release id or a duplicate exact provider/model/version/config tuple at construction,
 * orders profiles deterministically, and resolves a provider RELEASE (exact, with config digest) or a
 * provider DESCRIPTOR (identity without digest) against a requirement — fail-closed, returning a bounded
 * reason and a FROZEN content-free summary. It exposes no provider instance, no secret, and no mutation.
 */
import type { ProviderCapabilities } from '../contracts/capabilities.js';
import type { ProviderExecutionClass, ModelResultMode } from '../contracts/enums.js';
import type { ProviderReleaseRef } from '../operations/provider-release.js';
import { profileTupleKey, type ModelCapabilityProfile } from './capability-profile.js';
import { matchDescriptor, matchRequirement } from './capability-match.js';
import type { ModelCapabilityRequirement } from './capability-requirement.js';
import type { CapabilityMatchReason } from './capability-reasons.js';
import type { ModelTaskClass, StructuredOutputMode } from './task-classes.js';

/** A frozen, content-free summary of a resolved profile. Ids/versions/modes/limits only — no secret. */
export interface ModelCapabilityProfileSummary {
  readonly releaseId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly executionClass: ProviderExecutionClass;
  readonly configDigest: string;
  readonly taskClasses: readonly ModelTaskClass[];
  readonly resultModes: readonly ModelResultMode[];
  readonly structuredOutputMode: StructuredOutputMode;
  readonly maxInputTokens: number;
  readonly maxCompletionTokens: number;
  readonly supportsTimeout: boolean;
  readonly supportsCancellation: boolean;
  readonly supportsNonStreaming: boolean;
  readonly supportsStreaming: boolean;
  readonly promptProfileRef: string | undefined;
  readonly costProfileRef: string | undefined;
  readonly evaluationApprovalRef: string | undefined;
}

export type CapabilityResolution =
  | { readonly ok: true; readonly summary: ModelCapabilityProfileSummary }
  | { readonly ok: false; readonly reason: CapabilityMatchReason };

/** The immutable registry handle. */
export interface ModelCapabilityRegistry {
  /** The exact profile for a release id, or undefined. */
  getByReleaseId(releaseId: string): ModelCapabilityProfile | undefined;
  /** Resolve an exact release (with config digest) against a requirement; optional descriptor cross-check. */
  resolveRelease(
    release: ProviderReleaseRef,
    requirement: ModelCapabilityRequirement,
    descriptor?: ProviderCapabilities,
  ): CapabilityResolution;
  /** Resolve a provider descriptor (identity without digest) against a requirement; ambiguity fails closed. */
  resolveDescriptor(
    descriptor: ProviderCapabilities,
    requirement: ModelCapabilityRequirement,
  ): CapabilityResolution;
  /** The release ids present, in deterministic order. */
  releaseIds(): readonly string[];
  /** A frozen, content-free snapshot of every profile, in deterministic order. */
  snapshot(): readonly ModelCapabilityProfileSummary[];
}

function summarize(profile: ModelCapabilityProfile): ModelCapabilityProfileSummary {
  const r = profile.release;
  return Object.freeze({
    releaseId: r.releaseId,
    providerId: r.providerId,
    modelId: r.modelId,
    modelVersion: r.modelVersion,
    executionClass: r.executionClass,
    configDigest: r.configDigest,
    taskClasses: profile.taskClasses,
    resultModes: profile.resultModes,
    structuredOutputMode: profile.structuredOutputMode,
    maxInputTokens: profile.maxInputTokens,
    maxCompletionTokens: profile.maxCompletionTokens,
    supportsTimeout: profile.supportsTimeout,
    supportsCancellation: profile.supportsCancellation,
    supportsNonStreaming: profile.supportsNonStreaming,
    supportsStreaming: profile.supportsStreaming,
    promptProfileRef: profile.promptProfileRef,
    costProfileRef: profile.costProfileRef,
    evaluationApprovalRef: profile.evaluationApprovalRef,
  });
}

/** The identity key of a release/descriptor WITHOUT the config digest (for descriptor resolution). */
function identityKey(
  providerId: string,
  modelId: string,
  modelVersion: string,
  executionClass: ProviderExecutionClass,
): string {
  return [providerId, modelId, modelVersion, executionClass].join('|');
}

/**
 * Build an immutable capability registry from a set of profiles. Throws a fixed-message error on a
 * duplicate release id or a duplicate exact provider/model/version/config tuple. Profiles are ordered
 * deterministically by release id.
 */
export function createModelCapabilityRegistry(
  profiles: readonly ModelCapabilityProfile[],
): ModelCapabilityRegistry {
  const ordered = [...profiles].sort((a, b) =>
    a.release.releaseId < b.release.releaseId ? -1 : 1,
  );

  const byReleaseId = new Map<string, ModelCapabilityProfile>();
  const byTuple = new Map<string, ModelCapabilityProfile>();
  const byIdentity = new Map<string, ModelCapabilityProfile[]>();

  for (const profile of ordered) {
    const r = profile.release;
    if (byReleaseId.has(r.releaseId)) {
      throw new Error('A capability registry has a duplicate release id.');
    }
    const tuple = profileTupleKey(r);
    if (byTuple.has(tuple)) {
      throw new Error('A capability registry has a duplicate provider/model/version/config tuple.');
    }
    byReleaseId.set(r.releaseId, profile);
    byTuple.set(tuple, profile);
    const idKey = identityKey(r.providerId, r.modelId, r.modelVersion, r.executionClass);
    const bucket = byIdentity.get(idKey);
    if (bucket === undefined) {
      byIdentity.set(idKey, [profile]);
    } else {
      bucket.push(profile);
    }
  }

  const releaseIdList = Object.freeze(ordered.map((p) => p.release.releaseId));

  return Object.freeze({
    getByReleaseId(releaseId: string): ModelCapabilityProfile | undefined {
      return byReleaseId.get(releaseId);
    },

    resolveRelease(
      release: ProviderReleaseRef,
      requirement: ModelCapabilityRequirement,
      descriptor?: ProviderCapabilities,
    ): CapabilityResolution {
      const profile = byReleaseId.get(release.releaseId);
      if (profile === undefined) {
        return { ok: false, reason: 'registry-release-missing' };
      }
      // The supplied release must be the EXACT identity the profile is bound to (incl. config digest).
      const p = profile.release;
      const exact =
        p.providerId === release.providerId &&
        p.modelId === release.modelId &&
        p.modelVersion === release.modelVersion &&
        p.executionClass === release.executionClass &&
        p.configDigest === release.configDigest;
      if (!exact) {
        return { ok: false, reason: 'registry-descriptor-mismatch' };
      }
      if (descriptor !== undefined) {
        const d = matchDescriptor(profile, descriptor);
        if (!d.ok) {
          return { ok: false, reason: d.reason };
        }
      }
      const m = matchRequirement(profile, requirement);
      if (!m.ok) {
        return { ok: false, reason: m.reason };
      }
      return { ok: true, summary: summarize(profile) };
    },

    resolveDescriptor(
      descriptor: ProviderCapabilities,
      requirement: ModelCapabilityRequirement,
    ): CapabilityResolution {
      const idKey = identityKey(
        descriptor.providerId,
        descriptor.modelId,
        descriptor.modelVersion,
        descriptor.executionClass,
      );
      const bucket = byIdentity.get(idKey);
      if (bucket === undefined || bucket.length === 0) {
        return { ok: false, reason: 'registry-release-missing' };
      }
      if (bucket.length > 1) {
        // Ambiguous: the same identity maps to more than one config digest — fail closed.
        return { ok: false, reason: 'registry-descriptor-mismatch' };
      }
      const profile = bucket[0];
      if (profile === undefined) {
        return { ok: false, reason: 'registry-invariant' };
      }
      const d = matchDescriptor(profile, descriptor);
      if (!d.ok) {
        return { ok: false, reason: d.reason };
      }
      const m = matchRequirement(profile, requirement);
      if (!m.ok) {
        return { ok: false, reason: m.reason };
      }
      return { ok: true, summary: summarize(profile) };
    },

    releaseIds(): readonly string[] {
      return releaseIdList;
    },

    snapshot(): readonly ModelCapabilityProfileSummary[] {
      return Object.freeze(ordered.map(summarize));
    },
  });
}
