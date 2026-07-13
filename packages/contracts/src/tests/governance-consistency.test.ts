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

interface Manifest {
  readonly adr: string;
  readonly adrStatus: string;
  readonly adrAcceptedOn?: string;
  readonly stage_3_1_4: { readonly adr: string; readonly adrStatus: string };
  readonly stageStatus: Record<string, string>;
  readonly phaseGates: Record<string, { readonly blockedBy: readonly string[] }>;
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

describe('ADR-0026 remains Proposed, and the manifest says so', () => {
  it('the ADR document declares Proposed', () => {
    expect(declaredStatus(adr0026)).toBe('Proposed');
  });

  it('the manifest agrees, in both places it is recorded', () => {
    expect(manifest.stage_3_1_4.adr).toBe('ADR-0026');
    expect(manifest.stage_3_1_4.adrStatus).toBe(declaredStatus(adr0026));
    expect(manifest.stageStatus['adr_0026']).toBe(declaredStatus(adr0026));
    expect(manifest.stageStatus['adr_0026']).toBe('Proposed');
  });

  it('ADR-0025 and ADR-0026 are separate decisions and are not conflated', () => {
    // Accepting the compatibility baseline did not accept the payload hardening. They are
    // different decisions, taken at different times, and a manifest that blurred them would be
    // claiming an approval that was never given.
    expect(manifest.adr).not.toBe(manifest.stage_3_1_4.adr);
    expect(manifest.adrStatus).toBe('Accepted');
    expect(manifest.stage_3_1_4.adrStatus).toBe('Proposed');
  });
});

describe('the Stage 3.1.4 gate is not cleared by this correction', () => {
  it('Stage 3.1.4 remains implementation_complete_pending_owner_review', () => {
    expect(manifest.stageStatus['stage_3_1_4']).toBe(
      'in_progress / implementation_complete_pending_owner_review',
    );
  });

  it('Stage 3.2 remains blocked_by_stage_3_1_4', () => {
    expect(manifest.stageStatus['stage_3_2']).toBe('blocked_by_stage_3_1_4');
    expect(manifest.phaseGates['stage_3_2_signed_ingestion']?.blockedBy).toContain('stage-3.1.4');
  });

  it('correcting a stale status field does not accept a decision', () => {
    // Aligning the manifest with an ADR the owner already accepted is bookkeeping. It is not an
    // approval of anything else, and it must not become one by proximity.
    expect(manifest.stageStatus['adr_0026']).toBe('Proposed');
    expect(manifest.stageStatus['stage_3_2']).not.toBe('unblocked');
  });
});
