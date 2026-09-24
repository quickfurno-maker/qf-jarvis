const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

export interface RetrievedContextHit {
  readonly chunkId: string;
  readonly content: string;
  readonly citationRef: string;
  readonly score: number;
}

export interface CompressedContext {
  readonly items: readonly (RetrievedContextHit & { readonly truncated: boolean })[];
  readonly omittedCount: number;
  readonly coverageScore: number;
  readonly compressionMode: 'EXTRACTIVE_ONLY';
}

/**
 * Deterministic extractive-only context compression.
 *
 * Truncation uses an exact source substring and adds no synthetic summary. Citations stay attached
 * to the source chunk, so compression cannot create uncited prose.
 */
export function compressRetrievedContext(input: {
  readonly hits: readonly RetrievedContextHit[];
  readonly maxChars: number;
  readonly maxItems: number;
  readonly minScore: number;
}): CompressedContext {
  if (
    !Number.isInteger(input.maxChars) ||
    input.maxChars < 1 ||
    input.maxChars > 262_144 ||
    !Number.isInteger(input.maxItems) ||
    input.maxItems < 1 ||
    input.maxItems > 64 ||
    !Number.isFinite(input.minScore) ||
    input.minScore < 0 ||
    input.minScore > 1 ||
    input.hits.length > 512
  ) {
    throw new TypeError('context-compression-request-invalid');
  }

  const seenChunks = new Set<string>();
  const seenContent = new Set<string>();

  const ranked = [...input.hits]
    .filter((hit) => {
      if (
        !REF.test(hit.chunkId) ||
        seenChunks.has(hit.chunkId) ||
        !REF.test(hit.citationRef) ||
        hit.content.length < 1 ||
        hit.content.length > 65_536 ||
        !Number.isFinite(hit.score) ||
        hit.score < 0 ||
        hit.score > 1
      ) {
        throw new TypeError('context-hit-invalid');
      }

      seenChunks.add(hit.chunkId);
      const contentKey = hit.content.trim().replace(/s+/gu, ' ').toLowerCase();
      if (seenContent.has(contentKey) || hit.score < input.minScore) return false;
      seenContent.add(contentKey);
      return true;
    })
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));

  let remainingChars = input.maxChars;
  const items: (RetrievedContextHit & { readonly truncated: boolean })[] = [];

  for (const hit of ranked) {
    if (items.length >= input.maxItems || remainingChars <= 0) break;

    const content = hit.content.slice(0, remainingChars);
    if (content.length === 0) break;

    items.push(
      Object.freeze({
        ...hit,
        content,
        truncated: content.length !== hit.content.length,
      }),
    );
    remainingChars -= content.length;
  }

  const totalScore = ranked.reduce((sum, hit) => sum + hit.score, 0);
  const selectedScore = items.reduce((sum, hit) => sum + hit.score, 0);

  return Object.freeze({
    items: Object.freeze(items),
    omittedCount: Math.max(0, ranked.length - items.length),
    coverageScore: totalScore === 0 ? 0 : Math.min(1, selectedScore / totalScore),
    compressionMode: 'EXTRACTIVE_ONLY',
  });
}
