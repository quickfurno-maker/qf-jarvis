/**
 * The vendor assignment policy, asserted rule by rule.
 *
 * The table-driven fixture suite already refuses every invalid batch. These tests exist
 * anyway, and they are not redundant: a fixture proves *this particular payload* is
 * refused, while these prove the *rule* holds at its boundary — three passes and four
 * fails, six passes and seven fails. A cap is only a cap if it is tested at the edge.
 *
 * Each rule traces to ADR-0015 and to
 * docs/architecture/quickfurno-compatibility-directive.md.
 */

import { describe, expect, it } from 'vitest';

import {
  CLIENT_CONFIRMATION_CONTRACT_VERSION,
  INITIAL_BATCH_NUMBER,
  MAX_VENDORS_PER_BATCH,
  MAX_VENDORS_PER_LEAD_CATEGORY,
  REPLACEMENT_BATCH_NUMBER,
  safeParseAdditionalServiceRequest,
  safeParseAssignmentBatch,
  safeParseClientConfirmation,
  safeParseClientReassignmentRequest,
  safeParseLinkedLeadCreated,
} from '../index.js';
import {
  cloneFixture,
  validAdditionalServiceRequest,
  validClientConfirmation,
  validInitialBatch,
  validLinkedLeadCreated,
  validReassignmentRequest,
  validReplacementBatch,
} from '../fixtures/index.js';

/** Build N distinct, obviously-synthetic vendor references. */
function vendors(count: number, offset = 0): { entityType: string; entityId: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    entityType: 'vendor',
    entityId: `CORE-VENDOR-${String(offset + index).padStart(5, '0')}`,
  }));
}

describe('ClientConfirmationV1 is a fully versioned public contract', () => {
  it('parses standalone, before it is embedded in anything', () => {
    // Core validates a confirmation at the moment it captures one — not later, once it is
    // already inside a reassignment request. A contract that can only be checked from
    // inside its parent cannot be checked where it is created.
    const result = safeParseClientConfirmation(cloneFixture(validClientConfirmation));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contractVersion).toBe(CLIENT_CONFIRMATION_CONTRACT_VERSION);
    }
  });

  it('refuses a confirmation with no version — the version is never defaulted', () => {
    const confirmation = cloneFixture(validClientConfirmation);
    const { contractVersion: _removed, ...unversioned } = confirmation;

    expect(safeParseClientConfirmation(unversioned).success).toBe(false);
  });

  it('refuses an unknown future version, and does not fall back to v1', () => {
    const future = { ...cloneFixture(validClientConfirmation), contractVersion: 2 };
    expect(safeParseClientConfirmation(future).success).toBe(false);
  });

  it('refuses an unknown field', () => {
    const extra = { ...cloneFixture(validClientConfirmation), transcript: 'they said yes' };
    expect(safeParseClientConfirmation(extra).success).toBe(false);
  });

  it('survives a JSON round trip unchanged', () => {
    const original = cloneFixture(validClientConfirmation);
    const roundTripped: unknown = JSON.parse(JSON.stringify(original));

    expect(safeParseClientConfirmation(roundTripped).success).toBe(true);
    expect(roundTripped).toStrictEqual(original);
  });

  it('is embedded at the same version inside a reassignment request', () => {
    const result = safeParseClientReassignmentRequest(cloneFixture(validReassignmentRequest));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientConfirmation.contractVersion).toBe(
        CLIENT_CONFIRMATION_CONTRACT_VERSION,
      );
    }
  });
});

describe('the policy constants say what the approved policy says', () => {
  it('is three per batch, two batches, six unique per lead-category', () => {
    expect(MAX_VENDORS_PER_BATCH).toBe(3);
    expect(MAX_VENDORS_PER_LEAD_CATEGORY).toBe(6);
    expect(INITIAL_BATCH_NUMBER).toBe(1);
    expect(REPLACEMENT_BATCH_NUMBER).toBe(2);
  });
});

describe('batch size: three passes, four fails', () => {
  it.each([1, 2, 3])('accepts an initial batch of %i vendors', (count) => {
    const batch = { ...cloneFixture(validInitialBatch), vendors: vendors(count) };
    expect(safeParseAssignmentBatch(batch).success).toBe(true);
  });

  it('refuses a fourth vendor in the initial batch', () => {
    const batch = { ...cloneFixture(validInitialBatch), vendors: vendors(4) };
    expect(safeParseAssignmentBatch(batch).success).toBe(false);
  });

  it('refuses a fourth vendor in the replacement batch', () => {
    const batch = {
      ...cloneFixture(validReplacementBatch),
      vendors: vendors(4, 10),
      previousBatchVendors: vendors(3, 0),
    };
    expect(safeParseAssignmentBatch(batch).success).toBe(false);
  });

  it('refuses an empty batch — a batch that offers nobody is not an assignment', () => {
    const batch = { ...cloneFixture(validInitialBatch), vendors: [] };
    expect(safeParseAssignmentBatch(batch).success).toBe(false);
  });
});

describe('batch number: one and two exist, and nothing else does', () => {
  it.each([0, 3, 4, -1, 1.5])('refuses batchNumber %s', (batchNumber) => {
    const batch = { ...cloneFixture(validReplacementBatch), batchNumber };
    expect(safeParseAssignmentBatch(batch).success).toBe(false);
  });
});

describe('vendor uniqueness', () => {
  it('refuses the same vendor twice within one batch', () => {
    const [first] = vendors(1);
    const batch = {
      ...cloneFixture(validInitialBatch),
      vendors: [first, first, ...vendors(1, 5)],
    };
    expect(safeParseAssignmentBatch(batch).success).toBe(false);
  });

  it('refuses a vendor who appears in both batches', () => {
    const previous = vendors(3, 0);
    const batch = {
      ...cloneFixture(validReplacementBatch),
      previousBatchVendors: previous,
      // The first "replacement" vendor is one the client already rejected.
      vendors: [previous[0], ...vendors(2, 10)],
    };

    const result = safeParseAssignmentBatch(batch);
    expect(result.success).toBe(false);
  });

  it('accepts three genuinely new vendors in the replacement batch', () => {
    const batch = {
      ...cloneFixture(validReplacementBatch),
      previousBatchVendors: vendors(3, 0),
      vendors: vendors(3, 10),
    };
    expect(safeParseAssignmentBatch(batch).success).toBe(true);
  });
});

describe('the lifetime cap: six unique vendors, and never a seventh', () => {
  it('accepts exactly six unique vendors across the two batches', () => {
    const batch = {
      ...cloneFixture(validReplacementBatch),
      previousBatchVendors: vendors(3, 0),
      vendors: vendors(3, 10),
    };

    const result = safeParseAssignmentBatch(batch);
    expect(result.success).toBe(true);
  });

  it('refuses a seventh — the previous batch cannot have held four', () => {
    // Four in the previous batch would already have been refused when it was created;
    // this asserts the replacement refuses to build on an over-sized history too.
    const batch = {
      ...cloneFixture(validReplacementBatch),
      previousBatchVendors: vendors(4, 0),
      vendors: vendors(3, 10),
    };
    expect(safeParseAssignmentBatch(batch).success).toBe(false);
  });
});

describe('a replacement requires the client to have asked, and Core to have agreed', () => {
  it('refuses a replacement with no client confirmation', () => {
    const batch = cloneFixture(validReplacementBatch);
    const { clientConfirmationId: _removed, ...withoutConfirmation } = batch;

    expect(safeParseAssignmentBatch(withoutConfirmation).success).toBe(false);
  });

  it('refuses a replacement with no Core authorization', () => {
    const batch = cloneFixture(validReplacementBatch);
    const { reassignmentDecisionId: _removed, ...withoutDecision } = batch;

    expect(safeParseAssignmentBatch(withoutDecision).success).toBe(false);
  });

  it('refuses an initial batch that carries replacement fields', () => {
    const batch = {
      ...cloneFixture(validInitialBatch),
      clientConfirmationId: validReplacementBatch.clientConfirmationId,
    };
    expect(safeParseAssignmentBatch(batch).success).toBe(false);
  });
});

describe('authority: only QuickFurno Core creates a batch', () => {
  it.each(['qf-jarvis', 'n8n', 'qf-communications-runtime'])(
    'refuses a batch issued by %s',
    (issuer) => {
      const batch = { ...cloneFixture(validInitialBatch), issuer };
      expect(safeParseAssignmentBatch(batch).success).toBe(false);
    },
  );

  it('has no field in which Riya could name a replacement vendor', () => {
    const request = {
      ...cloneFixture(validReassignmentRequest),
      proposedVendors: vendors(3, 10),
    };

    // Strict object: the unknown key is refused. Riya never assigns.
    expect(safeParseClientReassignmentRequest(request).success).toBe(false);
  });
});

describe('cross-category needs become separate, linked leads', () => {
  it('refuses an additional service in the same category', () => {
    const request = {
      ...cloneFixture(validAdditionalServiceRequest),
      proposedCategory: validAdditionalServiceRequest.originatingCategory,
    };
    expect(safeParseAdditionalServiceRequest(request).success).toBe(false);
  });

  it('accepts an additional service in a different category', () => {
    expect(
      safeParseAdditionalServiceRequest(cloneFixture(validAdditionalServiceRequest)).success,
    ).toBe(true);
  });

  it('refuses a linked lead that reuses the originating lead identity', () => {
    const link = {
      ...cloneFixture(validLinkedLeadCreated),
      newLead: validLinkedLeadCreated.originatingLead,
    };
    expect(safeParseLinkedLeadCreated(link).success).toBe(false);
  });

  it('refuses a linked lead in the same category', () => {
    const link = {
      ...cloneFixture(validLinkedLeadCreated),
      newCategory: validLinkedLeadCreated.originatingCategory,
    };
    expect(safeParseLinkedLeadCreated(link).success).toBe(false);
  });

  it.each([
    'independentConsent',
    'independentVerification',
    'independentScoring',
    'independentMatching',
  ])('refuses a linked lead that inherits the parent %s', (field) => {
    const link = cloneFixture(validLinkedLeadCreated);
    const independence = { ...link.independence, [field]: false };

    expect(safeParseLinkedLeadCreated({ ...link, independence }).success).toBe(false);
  });

  it('refuses a linked lead with no client confirmation', () => {
    const link = cloneFixture(validLinkedLeadCreated);
    const { clientConfirmation: _removed, ...withoutConfirmation } = link;

    expect(safeParseLinkedLeadCreated(withoutConfirmation).success).toBe(false);
  });

  it('gives the new lead-category its own fresh initial batch of three', () => {
    // The linked lead starts at batch one. It does not inherit the parent's consumed
    // batches, and it does not contribute to them.
    const freshBatch = {
      ...cloneFixture(validInitialBatch),
      lead: validLinkedLeadCreated.newLead,
      category: validLinkedLeadCreated.newCategory,
      batchNumber: 1,
      vendors: vendors(3, 20),
    };

    expect(safeParseAssignmentBatch(freshBatch).success).toBe(true);
  });
});
