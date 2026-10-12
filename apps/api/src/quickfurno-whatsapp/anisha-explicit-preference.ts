import type { AnishaPreference } from './anisha-memory-lifecycle.js';

/** Exact small allowlist only; no LLM interpretation, raw transcript or auto-learning. */
export function parseExplicitAnishaPreference(input: unknown): AnishaPreference | null {
  if (
    typeof input !== 'string' ||
    input.length < 8 ||
    input.length > 140 ||
    /[\r\n\t]/u.test(input) ||
    /[\d@₹$]/u.test(input)
  )
    return null;
  const text = input
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/gu, '')
    .replace(/\s+/gu, ' ');
  if (
    [
      'please reply in hinglish',
      'reply in hinglish',
      'always reply in hinglish',
      'mujhse hinglish mein baat karo',
      'please remember speak in hinglish',
    ].includes(text)
  )
    return { kind: 'language', value: 'hinglish' };
  if (
    [
      'please reply in hindi',
      'reply in hindi',
      'always reply in hindi',
      'mujhse hindi mein baat karo',
      'please remember speak in hindi',
    ].includes(text)
  )
    return { kind: 'language', value: 'hi' };
  if (
    [
      'please reply in english',
      'reply in english',
      'always reply in english',
      'please remember speak in english',
    ].includes(text)
  )
    return { kind: 'language', value: 'en' };
  if (
    [
      'please keep replies short',
      'keep replies short',
      'reply briefly',
      'please reply briefly',
    ].includes(text)
  ) {
    return { kind: 'reply-style', value: 'short' };
  }
  if (
    [
      'please explain in detail',
      'explain in detail',
      'please give detailed replies',
      'give detailed replies',
    ].includes(text)
  ) {
    return { kind: 'reply-style', value: 'detailed' };
  }
  return null;
}
