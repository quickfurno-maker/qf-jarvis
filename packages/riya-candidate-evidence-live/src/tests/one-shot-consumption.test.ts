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
  isOneShotDiagnosticRunGoal,
  ONE_SHOT_DIAGNOSTIC_RUN_GOALS,
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

/**
 * Marker-path fixtures.
 *
 * Deliberately NOT `FULL_EVIDENCE` or `SAFETY_REPLICATION`. An earlier revision used the default as
 * the "fresh" goal, which both misrepresented production eligibility and asserted the very behaviour
 * that would have taken the main operator offline.
 *
 * Synthetic tokens rather than a real goal, and now necessarily so. Every eligible goal on this head
 * is ALSO tombstoned -- SFD2 consumed the last pending one -- so a real goal reaches the tombstone
 * branch and never touches the marker at all. That is the correct production state, not a gap: the
 * synthetic tokens keep the marker MECHANICS (digest naming, exclusive create, durability,
 * unwritable directory) testable without any production goal being left launchable to suit a test.
 *
 * They simulate a HYPOTHETICAL pending one-shot. Nothing in the production vocabulary is pending.
 */
const FRESH_GOAL = 'SYNTHETIC_FUTURE_ONE_SHOT_DIAGNOSTIC' as unknown as Parameters<
  ReturnType<typeof createOneShotConsumptionGuard>['claim']
>[0];
const OTHER_FRESH_GOAL = 'SYNTHETIC_OTHER_ONE_SHOT_DIAGNOSTIC' as unknown as typeof FRESH_GOAL;

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

  it('does NOT tombstone the default or the replication purpose', () => {
    // Blocking either would take the repository's main purpose -- or its repeatable safety
    // replication -- offline to fix a diagnostic incident.
    expect(Object.keys(STATICALLY_CONSUMED_RUN_GOALS)).not.toContain('FULL_EVIDENCE');
    expect(Object.keys(STATICALLY_CONSUMED_RUN_GOALS)).not.toContain('SAFETY_REPLICATION');
  });

  it('holds all TWELVE tombstones', () => {
    expect(Object.keys(STATICALLY_CONSUMED_RUN_GOALS)).toHaveLength(12);
  });

  it('records SFD2 as OWNER-LOCKED, by the run label that consumed it', () => {
    // SFD2 was authorized once, launched once, and returned HTTP 413 --
    // `STRUCTURED_REPLY_PROVIDER_REQUEST_REJECTED`, with NEITHER local stage run. It is tombstoned
    // anyway: the authorization was for one launch, not for one finding.
    expect(
      STATICALLY_CONSUMED_RUN_GOALS['POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE'],
    ).toBe('SFD2');
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

describe('one-shot ELIGIBILITY is a closed set, not a naming rule', () => {
  it('excludes the repeatable evidence purposes', () => {
    // The defect owner review found: the guard was wired to every goal, which made the repository's
    // DEFAULT operator one-shot per workstation and would have blocked a second safety replication
    // whose disagreement an owner is meant to interpret.
    expect(isOneShotDiagnosticRunGoal('FULL_EVIDENCE')).toBe(false);
    expect(isOneShotDiagnosticRunGoal('SAFETY_REPLICATION')).toBe(false);
    expect(ONE_SHOT_DIAGNOSTIC_RUN_GOALS).not.toContain('FULL_EVIDENCE');
    expect(ONE_SHOT_DIAGNOSTIC_RUN_GOALS).not.toContain('SAFETY_REPLICATION');
  });

  it('is a SUPERSET of the tombstones -- history cannot consume an ungoverned goal', () => {
    // The durable invariant, and the one that does NOT move as diagnostics are wired and consumed.
    // Equality has held at some heads and failed at others; containment always holds, because a goal
    // history records as consumed must be one the guard actually governs.
    for (const tombstoned of Object.keys(STATICALLY_CONSUMED_RUN_GOALS)) {
      expect(ONE_SHOT_DIAGNOSTIC_RUN_GOALS, tombstoned).toContain(tombstoned);
      expect(isOneShotDiagnosticRunGoal(tombstoned), tombstoned).toBe(true);
    }
    for (const goal of ONE_SHOT_DIAGNOSTIC_RUN_GOALS) {
      expect(isOneShotDiagnosticRunGoal(goal), goal).toBe(true);
      expect(OPERATOR_RUN_GOALS, goal).toContain(goal);
    }
  });

  it('has NO pending diagnostic at this head, and pins that as a SNAPSHOT', () => {
    // A SNAPSHOT of this exact head, not a law. This difference has already held three values: empty
    // before POST-SFD1 was wired, one entry between wiring and SFD2 running, and empty again now.
    // An empty difference does NOT mean the mechanism is unused -- it means nothing is pending.
    //
    // The PR that wires the next bounded one-shot diagnostic makes it non-empty and edits this line;
    // the PR that records that run's consumption empties it and edits this line again. That edit is
    // the review moment where "has this been consumed?" gets asked out loud.
    const pending = ONE_SHOT_DIAGNOSTIC_RUN_GOALS.filter(
      (goal) => !Object.prototype.hasOwnProperty.call(STATICALLY_CONSUMED_RUN_GOALS, goal),
    );
    expect(pending).toStrictEqual([]);
    expect(ONE_SHOT_DIAGNOSTIC_RUN_GOALS).toHaveLength(12);
    expect(Object.keys(STATICALLY_CONSUMED_RUN_GOALS)).toHaveLength(12);
  });

  it('DOES tombstone SFD2 now that it has run, while keeping it eligible', () => {
    // Both halves matter. Eligible keeps the guard governing it at all; tombstoned is what refuses
    // it on a FRESH workstation, where no local marker exists to consult.
    expect(
      Object.prototype.hasOwnProperty.call(
        STATICALLY_CONSUMED_RUN_GOALS,
        'POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE',
      ),
    ).toBe(true);
    expect(isOneShotDiagnosticRunGoal('POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE')).toBe(
      true,
    );
  });

  it('refuses SFD2 on the REAL guard, without touching the filesystem', () => {
    // The cross-workstation control. A fresh machine has no marker; the tombstone is what stops it,
    // and it stops it before `mkdirSync` or `openSync` is reached at all.
    const directory = markerDirectory();
    const guard = createOneShotConsumptionGuard({
      markerDirectory: directory,
      claimExclusive: () => {
        throw new Error('MARKER-MUST-NOT-BE-TOUCHED-FOR-A-TOMBSTONED-GOAL');
      },
    });
    // No cast: this is a real member of the closed goal vocabulary, unlike the synthetic fixtures.
    const claim = guard.claim('POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE');
    expect(claim.ok).toBe(false);
    expect(claim.ok ? undefined : claim.reason).toBe('statically-consumed-goal');
    expect(readdirSync(directory)).toStrictEqual([]);
  });

  it('is NOT derived from a name prefix', () => {
    // A prefix rule would silently enrol the next badly-named goal and exclude a well-named one.
    expect(isOneShotDiagnosticRunGoal('POST_SOMETHING_NOT_IN_THE_SET')).toBe(false);
    // And two eligible members do not share one prefix, so no prefix rule could reproduce the set.
    expect(isOneShotDiagnosticRunGoal('REQUEST_CONTRACT_DIAGNOSTIC')).toBe(true);
    expect(isOneShotDiagnosticRunGoal('POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL')).toBe(true);
    // And a `POST_SFD1_` prefix does not confer eligibility either: this exact token is eligible
    // because it is listed, and a near neighbour that is not listed is not.
    expect(isOneShotDiagnosticRunGoal('POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE')).toBe(
      true,
    );
    expect(isOneShotDiagnosticRunGoal('POST_SFD1_SOMETHING_ELSE')).toBe(false);
  });

  it('accounts for every member of the closed goal vocabulary', () => {
    // Every goal is either a repeatable purpose or a bounded one-shot. A goal that is neither would
    // be a governance question nobody answered.
    const eligible = new Set(ONE_SHOT_DIAGNOSTIC_RUN_GOALS);
    const repeatable = new Set(['FULL_EVIDENCE', 'SAFETY_REPLICATION']);
    for (const goal of OPERATOR_RUN_GOALS) {
      expect(eligible.has(goal) || repeatable.has(goal), goal).toBe(true);
    }
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

  it('takes exits 34, 35 and 36, and 0-33 keep meaning exactly what they meant', () => {
    expect(OPERATOR_EXIT_CODES.RUN_GOAL_STATICALLY_CONSUMED).toBe(34);
    expect(OPERATOR_EXIT_CODES.RUN_GOAL_ALREADY_CONSUMED).toBe(35);
    // A THIRD code: "the marker could not be written" is a different problem with a different fix
    // from "you already ran this", and collapsing them sends an owner looking for the wrong thing.
    expect(OPERATOR_EXIT_CODES.RUN_GOAL_CONSUMPTION_MARKER_UNAVAILABLE).toBe(36);
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
    expect(OPERATOR_OUTCOMES).toContain('RUN_GOAL_CONSUMPTION_MARKER_UNAVAILABLE');
    const three = [
      OPERATOR_EXIT_CODES.RUN_GOAL_STATICALLY_CONSUMED,
      OPERATOR_EXIT_CODES.RUN_GOAL_ALREADY_CONSUMED,
      OPERATOR_EXIT_CODES.RUN_GOAL_CONSUMPTION_MARKER_UNAVAILABLE,
    ];
    expect(new Set(three).size).toBe(3);
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
