import { executionIntentV1Schema, type ExecutionIntentV1 } from '@qf-jarvis/contracts';

import { type ExecutionDispatchReason } from '../protocol/reason-codes.js';

/**
 * Decode and validate the raw body as exactly one `ExecutionIntentV1` (QFJ-P09.02, ADR-0090).
 *
 * ### This runs ONLY after authenticity is proven
 *
 * Parsing is the expensive, attack-surface-rich step, so it happens last. Until the Ed25519
 * signature verifies, the bytes are just bytes: they are hashed and compared, never interpreted.
 *
 * ### One schema, never a second copy
 *
 * `executionIntentV1Schema` from `@qf-jarvis/contracts` is the single authority. This package does
 * not redefine the shape, does not relax it, and does not "repair" a near-miss. A second copy of a
 * contract is how two systems come to disagree about what was authorised -- and the disagreement
 * would be discovered by an effect nobody approved.
 *
 * ### Strict decoding, and why the BOM is refused explicitly
 *
 * The decoder is fatal: a lone surrogate or an invalid sequence is a refusal, not a replacement
 * character. A leading U+FEFF is rejected on its own reason code rather than being stripped,
 * because stripping it would mean the bytes that were SIGNED are not the bytes that were PARSED --
 * the exact gap this boundary exists to close.
 */

/** UTF-8 byte-order mark, as the code point a fatal decode produces. */
const BOM = '\u{FEFF}';

export type IntentBodyParseResult =
  | { readonly ok: true; readonly intent: ExecutionIntentV1 }
  | { readonly ok: false; readonly reason: ExecutionDispatchReason };

export function parseExecutionIntentBody(rawBody: Uint8Array): IntentBodyParseResult {
  let text: string;
  try {
    // `fatal` turns malformed UTF-8 into a throw rather than U+FFFD. Silent replacement would let
    // a body that is not what the signer wrote still parse.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rawBody);
  } catch {
    return { ok: false, reason: 'body-not-utf8' };
  }

  if (text.startsWith(BOM)) {
    return { ok: false, reason: 'body-has-bom' };
  }

  let json: unknown;
  try {
    // Ordinary JSON semantics also reject trailing content, so `{...}garbage` is refused here.
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'body-not-json' };
  }

  const parsed = executionIntentV1Schema.safeParse(json);
  if (!parsed.success) {
    // The zod issue list can quote received values -- parameter contents, identifiers. It is
    // deliberately discarded: the caller gets a countable reason, not the payload back.
    return { ok: false, reason: 'intent-contract-invalid' };
  }

  return { ok: true, intent: parsed.data };
}
