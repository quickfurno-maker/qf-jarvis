/**
 * **The machine-readable record must agree with the decision it claims to record.**
 *
 * ### The failure this exists to stop
 *
 * The compatibility manifest carried `adrStatus: "Proposed"` for ADR-0025 **after the owner had
 * accepted it**. The ADR file said `Accepted`; the manifest said `Proposed`; and the manifest is
 * the artifact a machine reads.
 *
 * Nothing broke, and that is precisely why it is worth a test. **A stale governance field does not
 * fail — it is believed.** A future automation asking *"is the compatibility boundary decided?"*
 * would have got `Proposed` and behaved as though nothing had been agreed, or a reviewer would have
 * concluded the opposite of the truth from a file that looked authoritative.
 *
 * It also hid well: a **different** field in the same manifest (`stageStatus.adr_0025`) already
 * said `Accepted`. **Two fields describing one fact is how one of them goes stale**, and this suite
 * is the thing that now notices.
 *
 * ### So the ADR files are the source of truth, and they are read
 *
 * These tests do not compare the manifest against a hardcoded string — that would just move the
 * stale copy into a test file. They **parse the ADR documents** and require the manifest to agree
 * with them. If an ADR's status changes and the manifest is not updated, **this fails**.
 */

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { RETIRED_EVENT_VERSIONS } from '../index.js';

interface Manifest {
  readonly adr: string;
  readonly adrStatus: string;
  readonly adrAcceptedOn?: string;
  readonly stage_3_1_4: {
    readonly adr: string;
    readonly adrStatus: string;
    readonly adrAcceptedOn?: string;
    readonly adrAcceptedBy?: string;
  };
  readonly stageStatus: Record<string, string>;
  readonly phaseGates: Record<
    string,
    {
      readonly blockedBy: readonly string[];
      readonly satisfiedBy?: readonly string[];
      readonly started?: boolean;
      readonly effectiveOn?: string;
    }
  >;
  readonly securityFindings: readonly Record<string, unknown>[];
  readonly retiredCanonicalVersions: Record<string, unknown>;
}

const MANIFEST_URL = new URL(
  '../../../../docs/compatibility/quickfurno-compatibility-manifest.json',
  import.meta.url,
);

const ADR_0025_URL = new URL(
  '../../../../docs/decisions/ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md',
  import.meta.url,
);

const ADR_0026_URL = new URL(
  '../../../../docs/decisions/ADR-0026-canonical-payload-privacy-boundary.md',
  import.meta.url,
);

const manifest = JSON.parse(await readFile(MANIFEST_URL, 'utf8')) as Manifest;
const adr0025 = await readFile(ADR_0025_URL, 'utf8');
const adr0026 = await readFile(ADR_0026_URL, 'utf8');

/**
 * The declared status of an ADR, read from the document itself.
 *
 * The `**Status:**` line is the first line of every ADR in this repository, and it is the thing a
 * human reads. Parsing it — rather than restating it — is what makes this test capable of catching
 * a disagreement instead of merely asserting a constant.
 */
function declaredStatus(document: string): string {
  const line = /^\*\*Status:\*\*\s*\*\*(\w+)\*\*/m.exec(document);

  if (line?.[1] === undefined) {
    throw new Error('An ADR must declare its status on a **Status:** line');
  }

  return line[1];
}

describe('the manifest agrees with the ADR it names', () => {
  it('names ADR-0025 as the decision that governs it', () => {
    expect(manifest.adr).toBe('ADR-0025');
  });

  it('records ADR-0025 as Accepted — the status the ADR itself declares', () => {
    // Read from the document, not restated from memory. A hardcoded 'Accepted' here would simply
    // relocate the stale copy into the test suite, where it would go stale just as quietly.
    expect(declaredStatus(adr0025)).toBe('Accepted');
    expect(manifest.adrStatus).toBe(declaredStatus(adr0025));
    expect(manifest.adrStatus).toBe('Accepted');
  });

  it('records who accepted ADR-0025, and when', () => {
    expect(manifest.adrAcceptedOn).toBe('2026-07-13');
    expect(adr0025).toContain('Keshav Sharma');
  });

  it('does not disagree with itself: every field describing ADR-0025 says the same thing', () => {
    // The original bug. `stageStatus.adr_0025` said Accepted while `adrStatus` said Proposed —
    // two fields describing one fact, and that is how one of them goes stale unnoticed.
    expect(manifest.stageStatus['adr_0025']).toBe(manifest.adrStatus);
  });
});

describe('ADR-0026 is Accepted, and the manifest agrees', () => {
  it('the ADR document declares Accepted', () => {
    expect(declaredStatus(adr0026)).toBe('Accepted');
  });

  it('the manifest agrees, in both places it is recorded', () => {
    expect(manifest.stage_3_1_4.adr).toBe('ADR-0026');
    expect(manifest.stage_3_1_4.adrStatus).toBe(declaredStatus(adr0026));
    expect(manifest.stageStatus['adr_0026']).toBe(declaredStatus(adr0026));
    expect(manifest.stageStatus['adr_0026']).toBe('Accepted');
  });

  it('records acceptance provenance — who, and when', () => {
    expect(manifest.stage_3_1_4.adrAcceptedOn).toBe('2026-07-13');
    expect(manifest.stage_3_1_4.adrAcceptedBy).toContain('Keshav Sharma');
    expect(adr0026).toContain('Keshav Sharma');
  });

  it('the acceptance explicitly covers the zero-length migration window and immediate retirement', () => {
    // The one thing ADR-0026 §5 named as the owner's to decide. If the acceptance were silent on
    // it, the retirement would rest on an engineer's judgment rather than a decision.
    expect(adr0026).toContain('zero-length migration window');
    expect(adr0026).toContain('immediate retirement');
  });

  it('ADR-0025 and ADR-0026 remain separate decisions, both now Accepted', () => {
    expect(manifest.adr).not.toBe(manifest.stage_3_1_4.adr);
    expect(manifest.adrStatus).toBe('Accepted');
    expect(manifest.stage_3_1_4.adrStatus).toBe('Accepted');
  });
});

describe('all 41 retirement records are accepted', () => {
  it('the manifest records the retirement decision as accepted, with provenance', () => {
    expect(manifest.retiredCanonicalVersions['count']).toBe(41);
    expect(manifest.retiredCanonicalVersions['decisionStatus']).toBe('accepted');
    expect(manifest.retiredCanonicalVersions['acceptedOn']).toBe('2026-07-13');
  });

  it.each(RETIRED_EVENT_VERSIONS.map((r) => [r.eventType, r] as const))(
    '%s is accepted, not merely proposed',
    (_eventType, record) => {
      expect(record.decisionStatus).toBe('accepted');
      expect(record.acceptedOn).toBe('2026-07-13');
    },
  );
});

describe('the historical GPS evidence survives acceptance', () => {
  const finding = manifest.securityFindings.find(
    (candidate) => candidate['id'] === 'gps-value-shape-not-refused',
  );

  it('the finding is still present — resolved, never deleted', () => {
    expect(finding).toBeDefined();
    expect(finding?.['status']).toBe('resolved');
    expect(finding?.['implementation_status']).toBe('accepted');
  });

  it('its historical status remains contract_gap, permanently', () => {
    // Acceptance closes a gap. It does not erase the fact that there was one — and erasing it
    // would erase the reason the hardening exists, leaving the next person to widen a payload
    // with nothing to read.
    expect(finding?.['historical_status']).toBe('contract_gap');
    expect(finding?.['historicalEvidence']).toBeTypeOf('string');
    expect(String(finding?.['historicalEvidence'])).toContain('GPS');
  });
});

describe('Stage 3.1.4 is complete; Stage 3.2 is unblocked on merge and has NOT started', () => {
  it('Stage 3.1.4 is completed and accepted', () => {
    expect(manifest.stageStatus['stage_3_1_4']).toBe('completed_accepted');
  });

  it('Stage 3.2 is unblocked effective on the merge of PR #9', () => {
    expect(manifest.stageStatus['stage_3_2']).toBe('unblocked_effective_on_merge_of_pr_9');
    expect(manifest.phaseGates['stage_3_2_signed_ingestion']?.blockedBy).toStrictEqual([]);
    expect(manifest.phaseGates['stage_3_2_signed_ingestion']?.satisfiedBy).toContain('stage-3.1.4');
    expect(manifest.phaseGates['stage_3_2_signed_ingestion']?.effectiveOn).toBe('merge-of-pr-9');
  });

  it('does NOT claim Stage 3.2 has started', () => {
    // Unblocking a stage and beginning it are different acts, and conflating them is how a phase
    // quietly starts before anybody agreed it should.
    expect(manifest.phaseGates['stage_3_2_signed_ingestion']?.started).toBe(false);
    expect(manifest.stageStatus['stage_3_2_started']).toBe('false');
    expect(manifest.stageStatus['stage_3_2']).not.toContain('in_progress');
    expect(manifest.stageStatus['stage_3_2']).not.toContain('complete');
  });

  it('Phase 11 remains blocked by Stage 3.1.3', () => {
    // Payload hardening is accepted. The QuickFurno-side safety remediation is not, and Phase 11
    // is where real personal data first crosses the boundary.
    const gate = manifest.phaseGates['phase_11_live_core_integration'];

    expect(gate?.blockedBy).toContain('stage-3.1.3');
    expect(gate?.satisfiedBy).toContain('stage-3.1.4');
  });

  it('Phase 11A remains blocked by Stage 3.1.3 and Phase 11', () => {
    const gate = manifest.phaseGates['phase_11a_live_communication'];

    expect(gate?.blockedBy).toContain('stage-3.1.3');
    expect(gate?.blockedBy).toContain('phase-11');
  });
});
