import type { AosPriority } from './contracts.js';

const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;
const REASON = /^[A-Z0-9_:-]{1,128}$/u;

export function validRef(value: string): boolean {
  return REF.test(value);
}

export function validReasonCode(value: string): boolean {
  return REASON.test(value);
}

export function validInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function validUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validNonNegativeInt(value: number, max = 1_000_000_000): boolean {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

export const PRIORITY_ORDER: Readonly<Record<AosPriority, number>> = Object.freeze({
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
});
