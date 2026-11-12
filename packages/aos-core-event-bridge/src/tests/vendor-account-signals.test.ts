import { describe, expect, it } from 'vitest';
import {
  bridgeVerifiedVendorAccountSignalsToAos,
  type AosVerifiedVendorAccountSignals,
} from '../index.js';

const BASE: AosVerifiedVendorAccountSignals = {
  source: 'QUICKFURNO_CORE_SANITIZED_VENDOR_CONTEXT',
  subjectRef: 'vendor:opaque-anisha-1',
  evidenceRef: 'core:signed-vendor-context:opaque-evidence',
  observedAt: '2026-11-12T13:30:00.000Z',
  packageReadinessBand: 'READY',
  pendingBadLeadReportCount: 0,
};

describe('AOS bridge for verified, partial Anisha vendor Core facts', () => {
  it('does not turn unknown/inactive/no-package into low credits or invent absent demand', () => {
    for (const packageReadinessBand of ['UNKNOWN', 'NOT_ACTIVE', 'NO_PACKAGE', 'READY'] as const) {
      expect(bridgeVerifiedVendorAccountSignalsToAos({ ...BASE, packageReadinessBand })).toEqual(
        [],
      );
    }
  });

  it('emits only known readiness and bad-lead-report events, with Core provenance', () => {
    const result = bridgeVerifiedVendorAccountSignalsToAos({
      ...BASE,
      packageReadinessBand: 'LOW_CREDITS',
      pendingBadLeadReportCount: 2,
    });
    expect(result).toHaveLength(2);
    expect(result.map((one) => one.behaviour.trigger)).toEqual([
      'VENDOR_PACKAGE_READINESS_LOW',
      'VENDOR_COMPLAINT_RECORDED',
    ]);
    expect(result.map((one) => one.observation.input.reasonCode)).toEqual([
      'CORE_VENDOR_PACKAGE_READINESS_LOW',
      'CORE_VENDOR_PENDING_BAD_LEAD_REPORT',
    ]);
    for (const item of result) {
      expect(item.observation.input.subjectRef).toBe(BASE.subjectRef);
      expect(item.observation.input.evidenceRefs).toContain(BASE.evidenceRef);
      expect(item.policyRefs).toEqual(['core:sanitized-vendor-context:v1']);
      expect(item.facts).toHaveLength(2);
      expect(JSON.stringify(item)).not.toMatch(
        /phone|clientName|matchingDemand|inactiveDays|balance|price|payment/iu,
      );
    }
  });

  it('fails closed for invalid provenance, an invalid instant, counts or unexpected private fields', () => {
    const invalid = [
      { ...BASE, source: 'SPOOFED' },
      { ...BASE, observedAt: 'tomorrow' },
      { ...BASE, pendingBadLeadReportCount: -1 },
      { ...BASE, pendingBadLeadReportCount: 1.3 },
      { ...BASE, packageReadinessBand: 'CRITICAL' },
      { ...BASE, phone: '9999999999' },
    ];
    for (const one of invalid) {
      expect(() =>
        bridgeVerifiedVendorAccountSignalsToAos(one as AosVerifiedVendorAccountSignals),
      ).toThrow('aos-vendor-account-signals-invalid');
    }
  });
});
