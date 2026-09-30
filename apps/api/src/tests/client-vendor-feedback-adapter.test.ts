import { describe, expect, it } from 'vitest';
import { detectExplicitClientVendorFeedback } from '../quickfurno-whatsapp/client-vendor-feedback-adapter.js';

describe('client vendor feedback detector', () => {
  it('detects explicit no-contact by ordinal', () => {
    expect(detectExplicitClientVendorFeedback("Vendor 2 didn't call me")).toEqual({
      assignmentOrdinal: 2,
      eventType: 'client_reported_no_contact',
    });
  });

  it('detects explicit contact confirmation', () => {
    expect(detectExplicitClientVendorFeedback('The third vendor contacted me')).toEqual({
      assignmentOrdinal: 3,
      eventType: 'client_confirmed_contact',
    });
  });

  it('detects replacement request', () => {
    expect(detectExplicitClientVendorFeedback('Please replace vendor 1')).toEqual({
      assignmentOrdinal: 1,
      eventType: 'reassignment_requested',
    });
  });

  it('never guesses a vendor without an ordinal', () => {
    expect(detectExplicitClientVendorFeedback('One vendor did not call me')).toBeNull();
  });

  it('distinguishes explicit dissatisfaction', () => {
    expect(detectExplicitClientVendorFeedback('I am not happy with vendor 2')).toEqual({
      assignmentOrdinal: 2,
      eventType: 'client_dissatisfied',
    });
  });
});
