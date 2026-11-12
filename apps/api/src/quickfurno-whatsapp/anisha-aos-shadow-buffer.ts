import type { AnishaVerifiedAosAccountSignal } from './anisha-core-context.js';

/**
 * Transient, bounded in-process AOS SHADOW observations from signed vendor Core reads.
 * No vendor conversation text, phone, customer contact, documents or monetary data.
 * No persistence, sends, model invocation or business mutations.
 */
export interface AnishaAosShadowBuffer {
  observe(signal: AnishaVerifiedAosAccountSignal): void;
  drain(asOf: string): readonly AnishaVerifiedAosAccountSignal[];
}

export function createAnishaAosShadowBuffer(
  options: { readonly capacity?: number; readonly maxAgeMs?: number } = {},
): AnishaAosShadowBuffer {
  const capacity = options.capacity ?? 512;
  const maxAgeMs = options.maxAgeMs ?? 15 * 60_000;
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > 10_000 ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs < 1_000 ||
    maxAgeMs > 3_600_000
  )
    throw new TypeError('anisha-aos-shadow-buffer-config-invalid');

  const pending = new Map<string, AnishaVerifiedAosAccountSignal>();
  return Object.freeze({
    observe(signal: AnishaVerifiedAosAccountSignal): void {
      const source: unknown = Reflect.get(signal, 'source');
      if (source !== 'QUICKFURNO_CORE_SANITIZED_VENDOR_CONTEXT') return;
      const observedAt = Date.parse(signal.observedAt);
      if (!Number.isFinite(observedAt)) return;
      if (pending.has(signal.subjectRef)) pending.delete(signal.subjectRef);
      if (pending.size >= capacity) {
        const oldest = pending.keys().next().value;
        if (typeof oldest === 'string') pending.delete(oldest);
      }
      pending.set(signal.subjectRef, signal);
    },
    drain(asOf: string): readonly AnishaVerifiedAosAccountSignal[] {
      const now = Date.parse(asOf);
      if (!Number.isFinite(now)) throw new TypeError('anisha-aos-shadow-buffer-asof-invalid');
      const items = [...pending.values()].filter((item) => {
        const age = now - Date.parse(item.observedAt);
        return Number.isFinite(age) && age >= -60_000 && age <= maxAgeMs;
      });
      pending.clear();
      return Object.freeze(items);
    },
  });
}
