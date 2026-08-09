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
 *
 * ### The public surface is THREE runtime values
 *
 * The task class a composition must bind, the profile factory it hands to M4, and the guard it uses
 * instead of casting M4's generic `unknown` detail. That is everything a composition can do with
 * this package.
 *
 * The bounds (`MAX_RIYA_USER_CONTENT_CHARS`, `MAX_RIYA_REPLY_BODY_CHARS`) and the producer
 * vocabulary (`RIYA_MODEL_PROVENANCES`) are deliberately INTERNAL. They are policy this package
 * enforces, not capabilities a caller invokes: nothing in production reads them, and exporting them
 * for the convenience of tests would put three more values under change control for no consumer.
 * Package-local specs import them relatively, which is what they are for.
 */

export { RIYA_CONVERSATION_EVOLUTION_TASK_CLASS } from './contracts/task-class.js';
export type { RiyaConversationEvolutionTaskClass } from './contracts/task-class.js';

export {
  RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_REPLY_TASK_CLASS,
} from './contracts/task-class.js';
export type {
  RiyaGroundedConversationEvolutionTaskClass,
  RiyaGroundedReplyTaskClass,
} from './contracts/task-class.js';

export { createRiyaConversationModelProfile, parseRiyaModelProfileDetail } from './profile.js';
export { createRiyaGroundedReplyModelProfile } from './profile.js';
export type { RiyaModelProfileDetailV1 } from './profile.js';

// TYPES only. The grounded context is BUILT by the RWC-P7 per-run bridge in `jarvis-runtime`, from a
// real governed retrieval; exporting a constructor here would let any caller hand this package a
// hand-assembled "governed" record that never passed QFJ-P04.03's lifecycle, permission, freshness or
// privacy rules. The bounds, the shape schema and the plan cross-check stay internal for the same
// reason.
export type {
  RiyaGroundedKnowledgeContextV1,
  RiyaGroundedKnowledgeItemV1,
} from './internal/grounded-context.js';
