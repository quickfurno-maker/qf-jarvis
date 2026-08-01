/**
 * Configured prompt-identity selection (QFJ-S3-I-B, ADR-0073).
 *
 * INTERNAL. Not exported from the orchestration barrel or the package root: selecting which prompt a
 * deployment configured is a step inside the pipeline, not a capability callers should reach for.
 *
 * Why this exists. Once a `PromptDefinition` is scope-bound and `(promptId, promptVersion)` is
 * globally unique, a single global `promptFamily` can serve exactly one agent scope — so a runtime
 * configured for Riya would refuse every Anisha turn. The alternative on offer was one runtime
 * instance per scope, which would duplicate composition and, worse, put the choice of "which agent is
 * this?" outside M1. Instead M2 reuses the assignment it has ALREADY made and asks the one port which
 * prompt is configured for that actor.
 *
 * This is not a second router. `assignAgent` decided the actor; nothing here can change it, and the
 * selector cannot see the party type, the envelope or the conversation.
 */
import type { RuntimeActor } from '../contracts/vocabularies.js';
import type { ModelPromptIdentity, ModelReplyPort } from './model-reply-port.js';

/** An exact identifier: no wildcard, no `latest`, matching the plan/gateway grammar. */
const EXACT_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

function isExactIdentity(value: unknown): value is ModelPromptIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ModelPromptIdentity>;
  if (
    typeof candidate.promptFamily !== 'string' ||
    !EXACT_IDENTIFIER.test(candidate.promptFamily) ||
    candidate.promptFamily === '*' ||
    candidate.promptFamily.toLowerCase() === 'latest'
  ) {
    return false;
  }
  if (
    typeof candidate.promptVersion !== 'number' ||
    !Number.isInteger(candidate.promptVersion) ||
    candidate.promptVersion < 1 ||
    candidate.promptVersion > 1_000_000
  ) {
    return false;
  }
  if (candidate.evaluationRef !== undefined) {
    if (
      typeof candidate.evaluationRef !== 'string' ||
      !EXACT_IDENTIFIER.test(candidate.evaluationRef)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Resolve the configured prompt identity for one model-backed turn, or `undefined` to refuse.
 *
 * Two shapes, never mixed:
 *
 * - a port with `selectPromptIdentity` is asked EXACTLY ONCE, and its answer is authoritative. If it
 *   returns `undefined` the turn fails closed — falling back to the legacy fields here would let a
 *   scope with no configured prompt quietly borrow another agent's;
 * - a port without a selector uses its legacy `promptFamily`/`promptVersion`, exactly as before.
 *
 * A selector that THROWS is treated exactly like one that returned `undefined`. `ModelReplyPort` is a
 * structural interface any deployment may implement, and this call happens before the orchestrator's
 * model try/catch — so an unnormalized throw would escape `orchestrateInbound` as a rejected promise
 * instead of the closed refusal every other injected-boundary failure produces. The thrown value is
 * discarded rather than inspected, logged or reported: it comes from foreign code and could carry
 * conversation content, and no reason code here depends on WHY the selector failed.
 */
export function selectModelPromptIdentity(
  modelPort: ModelReplyPort,
  assignedActor: RuntimeActor,
  taskClass: string,
): ModelPromptIdentity | undefined {
  if (typeof modelPort.selectPromptIdentity === 'function') {
    let selected: unknown;
    try {
      // The one call. A throw is a refusal, not a reason to ask again.
      selected = modelPort.selectPromptIdentity({ assignedActor, taskClass });
    } catch {
      return undefined;
    }
    if (selected === undefined || !isExactIdentity(selected)) {
      return undefined;
    }
    // `exactOptionalPropertyTypes`: an absent evaluation reference must be an ABSENT key, not an
    // explicit `undefined` -- the two mean different things to every downstream strict schema.
    return Object.freeze({
      promptFamily: selected.promptFamily,
      promptVersion: selected.promptVersion,
      ...(selected.evaluationRef === undefined ? {} : { evaluationRef: selected.evaluationRef }),
    });
  }

  // Typed `unknown` on purpose. The legacy fields are OPTIONAL on the port, so asserting them into
  // existence would hide the one case this branch has to handle: a port that declares neither shape.
  const legacy: unknown = {
    promptFamily: modelPort.promptFamily,
    promptVersion: modelPort.promptVersion,
    ...(modelPort.evaluationRef === undefined ? {} : { evaluationRef: modelPort.evaluationRef }),
  };
  return isExactIdentity(legacy) ? Object.freeze(legacy) : undefined;
}
