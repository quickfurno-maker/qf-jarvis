/**
 * `@qf-jarvis/riya-model-interaction` — the Riya half of the ONE structured model call
 * (RWC-P4B, ADR-0099).
 *
 * ### What it is for
 *
 * A single inference must produce both the reply draft material and this turn's bounded discovery
 * observations. The generic M4 adapter provides an opt-in structured-output profile seam and knows
 * nothing about Riya; this package fills that seam with everything Riya-specific and invokes
 * nothing itself.
 *
 * ### Why it is its own package
 *
 * `agent-runtime` stays business-neutral. `model-reply-adapter` stays generic M4 infrastructure.
 * `jarvis-runtime` is composition, not the home of an agent's model semantics. The continuity
 * package is a contract, and RWC-P4A's reducer must stay PURE and model-independent — it is
 * re-runnable during a compare-and-set reconciliation precisely because no model can reach it.
 * `riya-agent` must remain structurally unable to depend on the model adapter (ADR-0067).
 *
 * And it is ONE Riya: a future WhatsApp surface reuses this contract rather than copying a
 * WEB-shaped schema.
 *
 * ### The boundaries it holds
 *
 * The model may claim only `user_stated` or `model_inferred` — never `server_runtime`,
 * `user_selected` or `user_confirmed` — and a `CLEAR` must be `user_stated`, because an inference
 * may not withdraw a fact. Its claimed question plan is CHECKED against the RWC-P4A reducer and a
 * disagreement refuses the whole answer: the model never becomes phase authority.
 *
 * A model-produced opaque reference is a conversational CANDIDATE, never proof that a service is
 * sold, a city is served or a catalogue id exists. RWC-P5 owns location authority; QuickFurno Core
 * remains the commercial authority.
 *
 * No gateway invoker, provider, database, HTTP, Core adapter, transcript, evidence quote, raw model
 * result, contact detail, consent, `canSubmit`, lead, vendor, package, price or payment.
 */

export { RIYA_CONVERSATION_EVOLUTION_TASK_CLASS } from './contracts/task-class.js';
export type { RiyaConversationEvolutionTaskClass } from './contracts/task-class.js';

export { createRiyaConversationModelProfile, parseRiyaModelProfileDetail } from './profile.js';
export type { RiyaModelProfileDetailV1 } from './profile.js';

export { MAX_RIYA_USER_CONTENT_CHARS } from './internal/input-projection.js';
export { MAX_RIYA_REPLY_BODY_CHARS, RIYA_MODEL_PROVENANCES } from './internal/output-schema.js';
