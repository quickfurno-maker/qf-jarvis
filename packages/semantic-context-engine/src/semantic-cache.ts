const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

export interface SemanticAuthorityBinding {
  readonly knowledgeRevision: string;
  readonly policyRevision: string;
  readonly agentScope: string;
  readonly purpose: string;
  readonly dataClass: 'HOSTED_ALLOWED' | 'LOCAL_ONLY';
}

export interface SemanticContextCacheEntry {
  readonly entryId: string;
  readonly queryText: string;
  readonly binding: SemanticAuthorityBinding;
  readonly context: string;
  readonly citationRefs: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly approvedForReuse: boolean;
}

export interface SemanticSimilarityPort {
  score(
    queryText: string,
    candidates: readonly { readonly entryId: string; readonly queryText: string }[],
  ): Promise<ReadonlyMap<string, number>>;
}

function exactInstant(value: string): number | undefined {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return undefined;
  return parsed;
}

function validBinding(value: SemanticAuthorityBinding): boolean {
  return (
    REF.test(value.knowledgeRevision) &&
    REF.test(value.policyRevision) &&
    REF.test(value.agentScope) &&
    REF.test(value.purpose) &&
    (value.dataClass === 'HOSTED_ALLOWED' || value.dataClass === 'LOCAL_ONLY')
  );
}

function sameBinding(a: SemanticAuthorityBinding, b: SemanticAuthorityBinding): boolean {
  return (
    a.knowledgeRevision === b.knowledgeRevision &&
    a.policyRevision === b.policyRevision &&
    a.agentScope === b.agentScope &&
    a.purpose === b.purpose &&
    a.dataClass === b.dataClass
  );
}

function cloneEntry(entry: SemanticContextCacheEntry): SemanticContextCacheEntry {
  return Object.freeze({
    ...entry,
    binding: Object.freeze({ ...entry.binding }),
    citationRefs: Object.freeze([...entry.citationRefs]),
  });
}

/**
 * Reuse only approved retrieved context under an exact authority binding.
 *
 * A final model reply or a Core business fact is intentionally not representable by this contract.
 */
export async function findReusableSemanticContext(input: {
  readonly queryText: string;
  readonly binding: SemanticAuthorityBinding;
  readonly asOf: string;
  readonly similarityThreshold: number;
  readonly entries: readonly SemanticContextCacheEntry[];
  readonly similarity: SemanticSimilarityPort;
}): Promise<{
  readonly hit: boolean;
  readonly entry?: SemanticContextCacheEntry;
  readonly similarity?: number;
  readonly reusedArtifact: 'CONTEXT_ONLY';
}> {
  if (
    input.queryText.length < 1 ||
    input.queryText.length > 4096 ||
    !validBinding(input.binding) ||
    input.similarityThreshold < 0.8 ||
    input.similarityThreshold > 1 ||
    input.entries.length > 2048
  ) {
    throw new TypeError('semantic-cache-request-invalid');
  }

  const asOf = exactInstant(input.asOf);
  if (asOf === undefined) throw new TypeError('semantic-cache-request-invalid');

  const seen = new Set<string>();
  const eligible = input.entries.filter((entry) => {
    const createdAt = exactInstant(entry.createdAt);
    const expiresAt = exactInstant(entry.expiresAt);
    const citationSet = new Set(entry.citationRefs);

    if (
      !REF.test(entry.entryId) ||
      seen.has(entry.entryId) ||
      entry.queryText.length < 1 ||
      entry.queryText.length > 4096 ||
      entry.context.length < 1 ||
      entry.context.length > 65_536 ||
      !validBinding(entry.binding) ||
      entry.citationRefs.length < 1 ||
      entry.citationRefs.length > 64 ||
      citationSet.size !== entry.citationRefs.length ||
      entry.citationRefs.some((ref) => !REF.test(ref)) ||
      createdAt === undefined ||
      expiresAt === undefined ||
      expiresAt <= createdAt ||
      typeof entry.approvedForReuse !== 'boolean'
    ) {
      throw new TypeError('semantic-cache-entry-invalid');
    }

    seen.add(entry.entryId);
    return (
      entry.approvedForReuse &&
      sameBinding(entry.binding, input.binding) &&
      createdAt <= asOf &&
      expiresAt > asOf
    );
  });

  if (eligible.length === 0) {
    return Object.freeze({ hit: false, reusedArtifact: 'CONTEXT_ONLY' });
  }

  const scores = await input.similarity.score(
    input.queryText,
    eligible.map((entry) => ({ entryId: entry.entryId, queryText: entry.queryText })),
  );

  let best: { readonly entry: SemanticContextCacheEntry; readonly score: number } | undefined;
  for (const entry of eligible) {
    const score = scores.get(entry.entryId);
    if (score === undefined || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new TypeError('semantic-similarity-result-invalid');
    }
    if (
      score >= input.similarityThreshold &&
      (best === undefined ||
        score > best.score ||
        (score === best.score && entry.entryId.localeCompare(best.entry.entryId) < 0))
    ) {
      best = { entry, score };
    }
  }

  return best === undefined
    ? Object.freeze({ hit: false, reusedArtifact: 'CONTEXT_ONLY' })
    : Object.freeze({
        hit: true,
        entry: cloneEntry(best.entry),
        similarity: best.score,
        reusedArtifact: 'CONTEXT_ONLY',
      });
}
