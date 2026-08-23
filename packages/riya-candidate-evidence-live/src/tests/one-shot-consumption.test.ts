/**
 * POST-SFD1 — one-shot consumption integrity, asserted OFFLINE.
 *
 * SFD1 was authorized as ONE human-interactive execution and was accidentally launched a second time
 * with the same governed goal. The second launch reached the provider. The only control was the
 * instruction "run once".
 *
 * Every spec here therefore checks the same two things about a refusal: that it happened, and that it
 * happened **before anything was spent** — no credential read, no smoke, no candidate request.
 *
 * The marker directory is injected into a per-test temp directory. Nothing here writes to a
 * developer's real staging area, and nothing couples a test to repository state.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { OPERATOR_EXIT_CODES, OPERATOR_OUTCOMES } from '../exit-codes.js';
import {
  createOneShotConsumptionGuard,
  ONE_SHOT_MARKER_FORMAT_VERSION,
  ONE_SHOT_REFUSALS,
  oneShotMarkerFileName,
  STATICALLY_CONSUMED_RUN_GOALS,
} from '../internal/one-shot-consumption.js';
import { OPERATOR_RUN_GOALS } from '../internal/run-goal.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function markerDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'qfj-one-shot-spec-'));
  scratch.push(directory);
  return directory;
}

/** A goal that is NOT statically consumed, so the marker path can be exercised. */
const FRESH_GOAL = 'FULL_EVIDENCE';
const OTHER_FRESH_GOAL = 'SAFETY_REPLICATION';

describe('the static tombstones', () => {
  it('every tombstoned token is a real member of the closed goal vocabulary', () => {
    // A tombstone naming a goal that does not exist would silently protect nothing.
    for (const goal of Object.keys(STATICALLY_CONSUMED_RUN_GOALS)) {
      expect(OPERATOR_RUN_GOALS, goal).toContain(goal);
    }
  });

  it('carries the three owner-locked consumed goals', () => {
    for (const goal of [
      'POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL',
      'POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL',
      'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL',
    ]) {
      expect(Object.keys(STATICALLY_CONSUMED_RUN_GOALS), goal).toContain(goal);
    }
  });

  it('names the live run LABEL that consumed each goal, so every entry is auditable', () => {
    // A tombstone without a named label could not be checked against the repository's evidence.
    for (const [goal, label] of Object.entries(STATICALLY_CONSUMED_RUN_GOALS)) {
      expect(typeof label, goal).toBe('string');
      expect(label.length, goal).toBeGreaterThan(0);
    }
    expect(STATICALLY_CONSUMED_RUN_GOALS['POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL']).toBe(
      'RLD1',
    );
    expect(
      STATICALLY_CONSUMED_RUN_GOALS[
        'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL'
      ],
    ).toBe('SFD1');
  });

  it('does NOT tombstone the default, so an ordinary evidence run stays available', () => {
    // FULL_EVIDENCE is the default and has never been recorded consumed. Blocking it would take the
    // repository's main purpose offline to fix a diagnostic incident.
    expect(Object.keys(STATICALLY_CONSUMED_RUN_GOALS)).not.toContain('FULL_EVIDENCE');
  });

  it('refuses a tombstoned goal before touching the filesystem at all', () => {
    const directory = markerDirectory();
    const guard = createOneShotConsumptionGuard({
      markerDirectory: directory,
      claimExclusive: () => {
        throw new Error('MARKER-MUST-NOT-BE-TOUCHED-FOR-A-TOMBSTONED-GOAL');
      },
    });
    const claim = guard.claim(
      'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL',
    );
    expect(claim.ok).toBe(false);
    expect(claim.ok ? undefined : claim.reason).toBe('statically-consumed-goal');
    expect(readdirSync(directory)).toStrictEqual([]);
  });
});

describe('the atomic marker', () => {
  it('claims on first launch and refuses the second, for the same goal', () => {
    const guard = createOneShotConsumptionGuard({ markerDirectory: markerDirectory() });
    expect(guard.claim(FRESH_GOAL)).toStrictEqual({ ok: true });
    const second = guard.claim(FRESH_GOAL);
    expect(second.ok).toBe(false);
    expect(second.ok ? undefined : second.reason).toBe('goal-already-consumed');
  });

  it('does not block a DIFFERENT goal', () => {
    const guard = createOneShotConsumptionGuard({ markerDirectory: markerDirectory() });
    expect(guard.claim(FRESH_GOAL).ok).toBe(true);
    expect(guard.claim(OTHER_FRESH_GOAL).ok).toBe(true);
  });

  it('survives a fresh guard over the same directory — the claim is durable, not in-memory', () => {
    // The incident was two separate PROCESSES minutes apart. An in-memory set would not have caught it.
    const directory = markerDirectory();
    expect(createOneShotConsumptionGuard({ markerDirectory: directory }).claim(FRESH_GOAL).ok).toBe(
      true,
    );
    const second = createOneShotConsumptionGuard({ markerDirectory: directory }).claim(FRESH_GOAL);
    expect(second.ok).toBe(false);
    expect(second.ok ? undefined : second.reason).toBe('goal-already-consumed');
  });

  it('writes a CONTENT-FREE marker: a format version and the goal token, nothing else', () => {
    const directory = markerDirectory();
    createOneShotConsumptionGuard({ markerDirectory: directory }).claim(FRESH_GOAL);
    const entries = readdirSync(directory);
    expect(entries).toHaveLength(1);
    const contents = readFileSync(join(directory, entries[0] ?? ''), 'utf8');
    expect(contents).toBe(`${String(ONE_SHOT_MARKER_FORMAT_VERSION)}\n${FRESH_GOAL}\n`);
    // Nothing that could carry a secret, a document, or an owner's session.
    for (const forbidden of ['key', 'Bearer', 'authorization', 'schema', 'message', 'prompt']) {
      expect(contents.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('names the marker by a digest, so a directory listing discloses no goal', () => {
    const directory = markerDirectory();
    createOneShotConsumptionGuard({ markerDirectory: directory }).claim(FRESH_GOAL);
    const entries = readdirSync(directory);
    expect(entries[0]).toBe(oneShotMarkerFileName(FRESH_GOAL));
    expect(entries[0]).not.toContain(FRESH_GOAL);
    // Distinct goals get distinct names.
    expect(oneShotMarkerFileName(FRESH_GOAL)).not.toBe(oneShotMarkerFileName(OTHER_FRESH_GOAL));
  });

  it('fails CLOSED when the marker cannot be written', () => {
    // A guard that cannot record a claim cannot guarantee one, so it refuses rather than assuming
    // first-use. Reported apart from "already consumed": an owner must not be told they already ran
    // something when the real problem is a read-only directory.
    const guard = createOneShotConsumptionGuard({
      markerDirectory: markerDirectory(),
      claimExclusive: () => {
        throw Object.assign(new Error('SECRET-DETAIL-MUST-NOT-APPEAR'), { code: 'EACCES' });
      },
    });
    const claim = guard.claim(FRESH_GOAL);
    expect(claim.ok).toBe(false);
    expect(claim.ok ? undefined : claim.reason).toBe('consumption-marker-unavailable');
  });

  it('lives OUTSIDE the repository', () => {
    const directory = markerDirectory();
    createOneShotConsumptionGuard({ markerDirectory: directory }).claim(FRESH_GOAL);
    // A marker inside the working tree would appear in `git status` and break the exact-worktree
    // preflight that every live authorization depends on.
    expect(directory.startsWith(REPO_ROOT)).toBe(false);
    expect(existsSync(join(REPO_ROOT, oneShotMarkerFileName(FRESH_GOAL)))).toBe(false);
  });
});

describe('the refusal vocabulary and its exit codes', () => {
  it('is exactly three closed, content-free reasons', () => {
    expect([...ONE_SHOT_REFUSALS]).toStrictEqual([
      'statically-consumed-goal',
      'goal-already-consumed',
      'consumption-marker-unavailable',
    ]);
  });

  it('takes exits 34 and 35, and 0-33 keep meaning exactly what they meant', () => {
    expect(OPERATOR_EXIT_CODES.RUN_GOAL_STATICALLY_CONSUMED).toBe(34);
    expect(OPERATOR_EXIT_CODES.RUN_GOAL_ALREADY_CONSUMED).toBe(35);
    // The consumed diagnostics keep their integers; those are immutable evidence.
    expect(OPERATOR_EXIT_CODES.POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL_COMPLETE).toBe(31);
    expect(
      OPERATOR_EXIT_CODES.POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL_COMPLETE,
    ).toBe(32);
    expect(
      OPERATOR_EXIT_CODES.POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL_COMPLETE,
    ).toBe(33);
    expect(OPERATOR_EXIT_CODES.AWAITING_P10_HUMAN_REVIEW).toBe(0);
    const codes = Object.values(OPERATOR_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('distinguishes the two refusals as separate outcomes', () => {
    // A shell must be able to tell "history settled this" from "this machine already spent it": the
    // first is lifted by a governance decision, the second by using a different workstation.
    expect(OPERATOR_OUTCOMES).toContain('RUN_GOAL_STATICALLY_CONSUMED');
    expect(OPERATOR_OUTCOMES).toContain('RUN_GOAL_ALREADY_CONSUMED');
    expect(OPERATOR_EXIT_CODES.RUN_GOAL_STATICALLY_CONSUMED).not.toBe(
      OPERATOR_EXIT_CODES.RUN_GOAL_ALREADY_CONSUMED,
    );
  });
});

describe('there is no override', () => {
  it('the guard exposes exactly one method, and no way to release a claim', () => {
    const guard = createOneShotConsumptionGuard({ markerDirectory: markerDirectory() });
    expect(Object.keys(guard)).toStrictEqual(['claim']);
    const asRecord = guard as unknown as Record<string, unknown>;
    for (const forbidden of ['release', 'clear', 'reset', 'force', 'unclaim', 'delete']) {
      expect(asRecord[forbidden], forbidden).toBeUndefined();
    }
  });
});
