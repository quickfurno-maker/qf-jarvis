/**
 * The closed set of model task classes (QFJ-P04.02, ADR-0050).
 *
 * A task class describes the TECHNICAL purpose a model release is configured to serve. It is orthogonal
 * to the agent scope (Riya=CLIENT, Anisha=VENDOR, Jarvis=COORDINATION): capability matching by task class
 * never blurs an authority boundary. There is no tool-execution, embedding, or RAG task class here.
 */
export const MODEL_TASK_CLASSES = [
  'INTENT_CLASSIFICATION',
  'STRUCTURED_EXTRACTION',
  'RESPONSE_GENERATION',
  'CONVERSATION_SUMMARY',
  'TOOL_INTENT_PROPOSAL',
  'RESPONSE_EVALUATION',
] as const;
export type ModelTaskClass = (typeof MODEL_TASK_CLASSES)[number];

/** The closed set of structured-output modes a release may declare. */
export const STRUCTURED_OUTPUT_MODES = [
  'strict-json-schema',
  'json-object',
  'unsupported',
] as const;
export type StructuredOutputMode = (typeof STRUCTURED_OUTPUT_MODES)[number];
