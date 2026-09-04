/**
 * SHA-256 over canonical bytes (AS3A).
 *
 * A local copy rather than an import: `riya-ai-synthetic-generation` keeps its digest helper
 * internal, and reaching into another package's `internal/` would make its private surface a public
 * one by accident. The function is four lines and has no notion of what it is hashing -- deliberately.
 * Trajectory identity belongs to the dataset package and is never recomputed here.
 */
import { createHash } from 'node:crypto';

export const SHA256_HEX = /^[0-9a-f]{64}$/;

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
