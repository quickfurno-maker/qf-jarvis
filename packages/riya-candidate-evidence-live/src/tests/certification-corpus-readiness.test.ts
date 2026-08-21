/**
 * TRACK A — safety and P10 corpus readiness, proved OFFLINE before either is ever authorized.
 *
 * ### The gap this closes
 *
 * The operator's ceilings are arithmetic over corpus sizes: `MAX_PROVIDER_REQUESTS` is
 * `1 smoke + 10 model-facing safety cases + 72 P10 captures`. Existing specs pin the arithmetic
 * (`1 + 10 + 72 === 83`) and pin the execution-health constants against the live safety manifest.
 *
 * What NOTHING pinned is the other half of the same claim: that the CORPORA actually have those
 * sizes. `P10_REQUESTS = 72` is a hand-written integer, and the P10 phase iterates
 * `RIYA_QUALITY_GOLDEN_FIXTURES`. If that corpus ever grows to 73, nothing fails at build time —
 * the run simply reserves 83 requests, spends them, and the ledger REFUSES the 84th. The receipt
 * would report a completed run over a silently truncated corpus, and a P10 verdict would be read
 * from 72 of 73 cases with nothing on the evidence saying so.
 *
 * That is a governance defect that only shows up during a live, paid, one-shot authorization. These
 * specs move it to build time, where it costs nothing.
 *
 * ### Why the counts are asserted from the CORPUS, not restated
 *
 * Every assertion below derives its expected value from the real exported corpus and compares it to
 * the governed constant. A spec that wrote `expect(fixtures).toHaveLength(72)` alone would pass
 * happily while the ledger constant said something else — it is the AGREEMENT between the two that
 * is load-bearing, so the agreement is what gets asserted.
 *
 * Nothing here executes safety, executes P10, reaches a provider, reads a credential or touches a
 * network. It reads two frozen fixture arrays and some integers.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  RIYA_SAFETY_FIXTURES,
  RIYA_SAFETY_FIXTURE_MANIFEST_ID,
  RIYA_SAFETY_FIXTURE_MANIFEST_VERSION,
} from '@qf-jarvis/riya-candidate-evaluation-runner';
import { RIYA_QUALITY_GOLDEN_FIXTURES } from '@qf-jarvis/riya-quality-evaluation/testing';
import { describe, expect, it } from 'vitest';

import {
  MAX_PROVIDER_REQUESTS,
  P10_REQUESTS,
  SAFETY_MODEL_REQUIRED_REQUESTS,
  SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS,
  SMOKE_REQUESTS,
} from '../accounting.js';
import {
  GOVERNED_EXPECTED_CANCELLATIONS,
  GOVERNED_MODEL_REQUIRED_CASES,
  GOVERNED_PRE_MODEL_REQUIRED_CASES,
} from '../internal/execution-health.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));

const modelRequired = (): readonly (typeof RIYA_SAFETY_FIXTURES)[number][] =>
  RIYA_SAFETY_FIXTURES.filter((one) => one.executionExpectation === 'MODEL_REQUIRED');

describe('the P10 ledger constant agrees with the corpus the P10 phase actually iterates', () => {
  it('P10_REQUESTS equals the golden fixture count', () => {
    // THE assertion this file exists for. `captureRiyaQualityCandidates` defaults to
    // `RIYA_QUALITY_GOLDEN_FIXTURES`, so this corpus IS the request volume. A corpus that grew past
    // the constant would be truncated by the ledger mid-run, during a paid one-shot authorization.
    expect(P10_REQUESTS).toBe(RIYA_QUALITY_GOLDEN_FIXTURES.length);
    expect(P10_REQUESTS).toBe(72);
  });

  it('the full-evidence ceiling is exactly smoke + safety + the real corpora', () => {
    // Derived from the corpora rather than restated, so a corpus change moves the expectation and
    // the ledger together — or fails here.
    expect(MAX_PROVIDER_REQUESTS).toBe(
      SMOKE_REQUESTS + modelRequired().length + RIYA_QUALITY_GOLDEN_FIXTURES.length,
    );
    expect(MAX_PROVIDER_REQUESTS).toBe(83);
  });

  it('the ledger has NO slack over the corpora — a 73rd P10 case could not run', () => {
    // The ceiling is exact by design: there is no retry anywhere in this operator, so a request past
    // it means a loop, a duplicate or a truncation. Proving the margin is ZERO is what makes the
    // truncation risk real rather than theoretical.
    const exact = SMOKE_REQUESTS + modelRequired().length + RIYA_QUALITY_GOLDEN_FIXTURES.length;
    expect(MAX_PROVIDER_REQUESTS - exact).toBe(0);
  });
});

describe('the SAFETY ledger constant agrees with the safety manifest', () => {
  it('SAFETY_MODEL_REQUIRED_REQUESTS equals the model-facing case count', () => {
    // Two independently authored constants mean the same thing — the accounting one and the
    // execution-health one — and nothing tied EITHER to the manifest. Now both are tied to it.
    expect(SAFETY_MODEL_REQUIRED_REQUESTS).toBe(modelRequired().length);
    expect(GOVERNED_MODEL_REQUIRED_CASES).toBe(modelRequired().length);
    expect(SAFETY_MODEL_REQUIRED_REQUESTS).toBe(GOVERNED_MODEL_REQUIRED_CASES);
  });

  it('the replication ceiling is exactly smoke + the model-facing cases', () => {
    expect(SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS).toBe(SMOKE_REQUESTS + modelRequired().length);
    expect(SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS).toBe(11);
  });

  it('a replication can never reach P10 volume', () => {
    // Second line of defence, stated as arithmetic: the narrow ceiling is below the first quality
    // reservation, so even if the operator's early return were removed the ledger would refuse.
    expect(SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS).toBeLessThan(MAX_PROVIDER_REQUESTS);
    expect(SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS + 1).toBeLessThanOrEqual(MAX_PROVIDER_REQUESTS);
  });
});

describe('the safety corpus identity has not drifted', () => {
  it('the manifest is the governed one, by ID as well as version', () => {
    // Only the VERSION was pinned before. A manifest that kept version 4 under a different ID would
    // be a different corpus wearing the same number.
    expect(RIYA_SAFETY_FIXTURE_MANIFEST_ID).toBe('riya.candidate.safety.v1');
    expect(RIYA_SAFETY_FIXTURE_MANIFEST_VERSION).toBe(4);
  });

  it('carries 17 cases, each with a unique id, split 10 model-facing / 7 pre-model', () => {
    expect(RIYA_SAFETY_FIXTURES).toHaveLength(17);
    expect(new Set(RIYA_SAFETY_FIXTURES.map((one) => one.request.caseId)).size).toBe(17);
    expect(modelRequired()).toHaveLength(GOVERNED_MODEL_REQUIRED_CASES);
    expect(
      RIYA_SAFETY_FIXTURES.filter((one) => one.executionExpectation === 'PRE_MODEL_REQUIRED'),
    ).toHaveLength(GOVERNED_PRE_MODEL_REQUIRED_CASES);
    // Total is covered exactly: no case sits outside the two governed execution layers.
    expect(GOVERNED_MODEL_REQUIRED_CASES + GOVERNED_PRE_MODEL_REQUIRED_CASES).toBe(
      RIYA_SAFETY_FIXTURES.length,
    );
  });

  it('exactly one case cancels, leaving the nine-case ordinary population', () => {
    const cancelling = RIYA_SAFETY_FIXTURES.filter((one) => one.request.cancelAfterAdmission);
    expect(cancelling).toHaveLength(GOVERNED_EXPECTED_CANCELLATIONS);
    // The population S9 and S10 measured, and the one the representative capture selects from.
    const ordinary = modelRequired().filter((one) => !one.request.cancelAfterAdmission);
    expect(ordinary).toHaveLength(9);
    expect(ordinary.length).toBe(modelRequired().length - GOVERNED_EXPECTED_CANCELLATIONS);
  });

  it('every case carries a non-empty synthetic turn', () => {
    for (const fixture of RIYA_SAFETY_FIXTURES) {
      expect(fixture.request.syntheticUserText.length).toBeGreaterThan(0);
    }
  });

  it('EVERY case that reaches a model is CLIENT-scoped, and the one VENDOR case never does', () => {
    // The corpus carries exactly one VENDOR case and it sits at PRE_MODEL_REQUIRED — it exists to
    // prove Riya REFUSES vendor work before any model is reached, which is why it is not one of the
    // ten model-facing cases.
    //
    // This is the corpus-level half of RIYA'S scope boundary: every model-facing case is
    // CLIENT-scoped, and the VENDOR case is refused before any Riya model invocation. A VENDOR case
    // that drifted into MODEL_REQUIRED would spend a governed Riya request on a turn Riya is not the
    // authority for.
    //
    // This assertion deliberately does NOT define ownership among CLIENT service lines. It proves
    // only that vendor work cannot drift into Riya's model-facing safety population; which agent
    // owns any particular client service line is an architecture question this spec has no business
    // answering, and naming one here would put a routing claim into a corpus test.
    for (const fixture of modelRequired()) {
      expect(fixture.request.agentScope).toBe('CLIENT');
    }
    const vendor = RIYA_SAFETY_FIXTURES.filter((one) => one.request.agentScope === 'VENDOR');
    expect(vendor).toHaveLength(1);
    for (const fixture of vendor) {
      expect(fixture.executionExpectation).toBe('PRE_MODEL_REQUIRED');
    }
  });

  it('the operator reports the real case count on the ELIGIBLE line', () => {
    // `cases: 17` is a literal in the operator. A manifest that grew would leave the authoritative
    // safety line understating what was evaluated, which is an evidence-integrity defect rather
    // than a cosmetic one.
    const operator = readFileSync(`${SRC}operator.ts`, 'utf8');
    expect(operator).toContain(`cases: ${String(RIYA_SAFETY_FIXTURES.length)},`);
  });
});

describe('the P10 corpus identity has not drifted', () => {
  it('carries 72 fixtures, each with a unique id', () => {
    expect(RIYA_QUALITY_GOLDEN_FIXTURES).toHaveLength(72);
    expect(new Set(RIYA_QUALITY_GOLDEN_FIXTURES.map((one) => one.fixtureId)).size).toBe(72);
  });

  it('stays BALANCED across languages and interaction kinds', () => {
    // 72 = 12 interaction kinds x 6, and 3 language modes x 24. The balance is the corpus design:
    // a quality verdict read from a corpus that had quietly skewed toward one language or one
    // interaction kind would measure something other than what it claims to.
    const byLanguage = new Map<string, number>();
    const byKind = new Map<string, number>();
    for (const fixture of RIYA_QUALITY_GOLDEN_FIXTURES) {
      byLanguage.set(fixture.languageMode, (byLanguage.get(fixture.languageMode) ?? 0) + 1);
      byKind.set(fixture.interactionKind, (byKind.get(fixture.interactionKind) ?? 0) + 1);
    }
    expect([...byLanguage.keys()].sort()).toStrictEqual(['ENGLISH', 'HINDI', 'HINGLISH']);
    for (const count of byLanguage.values()) {
      expect(count).toBe(24);
    }
    expect(byKind.size).toBe(12);
    for (const count of byKind.values()) {
      expect(count).toBe(6);
    }
    // Derived, so the two groupings cannot disagree with the total.
    expect([...byLanguage.values()].reduce((a, b) => a + b, 0)).toBe(P10_REQUESTS);
    expect([...byKind.values()].reduce((a, b) => a + b, 0)).toBe(P10_REQUESTS);
  });

  it('every fixture carries a non-empty synthetic turn', () => {
    for (const fixture of RIYA_QUALITY_GOLDEN_FIXTURES) {
      expect(fixture.syntheticUserText.length).toBeGreaterThan(0);
    }
  });

  it('the P10 corpus and the safety corpus share NO case identity', () => {
    // A diagnostic or safety case that leaked into the quality corpus would make a quality verdict
    // partly a re-measurement of safety, and vice versa.
    const safetyIds = new Set(RIYA_SAFETY_FIXTURES.map((one) => one.request.caseId));
    for (const fixture of RIYA_QUALITY_GOLDEN_FIXTURES) {
      expect(safetyIds.has(fixture.fixtureId)).toBe(false);
    }
  });
});
