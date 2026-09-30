export const REF = /^[A-Za-z0-9._:-]{1,128}$/u;

export function assertRef(value: string, code: string): void {
  if (!REF.test(value)) throw new TypeError(code);
}

export function assertUniqueRefs(values: readonly string[], code: string): void {
  if (values.length !== new Set(values).size) throw new TypeError(code);
  for (const value of values) assertRef(value, code);
}

export function assertInstant(value: string, code: string): number {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new TypeError(code);
  return millis;
}

export function assertUnit(value: number, code: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(code);
}

export function freezeRefs(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}
