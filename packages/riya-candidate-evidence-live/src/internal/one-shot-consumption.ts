/**
 * One-shot consumption integrity for governed live diagnostics (POST-SFD1).
 *
 * ### The incident this exists for
 *
 * SFD1 was authorized as ONE human-interactive execution. The operator was then accidentally
 * launched a second time with the same governed goal, and the second execution reached the provider:
 * a live request outside the authorization, against a run whose canonical evidence was already
 * recorded. The instruction "run once" was the only control, and an instruction is not a control.
 *
 * Two failures, and both are addressed here.
 *
 * **A goal already consumed by history could be launched at all.** RLD1, RBD1 and SFD1 are recorded
 * CONSUMED with RERUN=NO, and nothing in the code knew that. {@link STATICALLY_CONSUMED_RUN_GOALS}
 * is that knowledge, written down, with the proof for each entry beside it.
 *
 * **A goal consumed by THIS workstation could be launched again minutes later.** The marker below
 * makes the first accepted launch claim the goal atomically, so a second launch fails closed.
 *
 * ### The marker is content-free, and that is not negotiable
 *
 * It carries a format version and the goal token — nothing else. No credential, no message, no
 * schema, no provider output, no header, no error body, no timestamp that could correlate a run with
 * an owner's session. The filename is a digest of the goal token, so even a directory listing
 * discloses only that *some* governed goal was consumed.
 *
 * ### Atomicity comes from the filesystem, not from a read-then-write
 *
 * `openSync(path, 'wx')` fails if the path exists, and the check-and-create is one syscall. A
 * `existsSync` followed by a write would have a window between them, and the incident was two
 * launches seconds apart.
 *
 * ### Where the marker lives, and why not in the repository
 *
 * Outside it, always. A marker inside the working tree would show up in `git status`, break the
 * exact-worktree preflight every live authorization depends on, and risk being committed. The
 * directory is INJECTED so specs never touch a developer's real staging area.
 *
 * ### There is deliberately no override
 *
 * No `--force`, no `--rerun`, no `--clear-consumed`. A flag that unblocks a consumed one-shot is the
 * same control as no control at all: it would have been reached for in the incident. Re-running a
 * consumed goal is a governance decision, made by editing the tombstone list in a reviewed PR.
 */
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type { OperatorRunGoal } from './run-goal.js';

/** The marker format. Bumping it would deliberately orphan older markers; nothing does today. */
export const ONE_SHOT_MARKER_FORMAT_VERSION = 1;

/**
 * Run goals the repository's own immutable evidence records as CONSUMED, with the proof.
 *
 * Each entry names the live RUN LABEL that consumed it and where that is recorded. Two kinds of
 * proof appear, and the difference is stated rather than smoothed over:
 *
 * - **OWNER-LOCKED**: the owner's governance directly records `<label>_CONSUMED=YES` /
 *   `<label>_RERUN=NO` against this exact goal token.
 * - **REPOSITORY-DERIVED**: `docs/reports/` records `<label>_CONSUMED=YES` / `<label>_RERUN=NO`, and
 *   the merged `run-goal.ts` docblock for the SUCCESSOR goal states which label used this one.
 *
 * A derived entry rests on one reading step, so each is listed with the sentence that supports it and
 * is auditable in review. Blocking is the safe direction: a wrongly-listed goal fails closed and is
 * lifted by a reviewed edit here, whereas a missing entry is the incident.
 */
export const STATICALLY_CONSUMED_RUN_GOALS: Readonly<Record<string, string>> = Object.freeze({
  // REPOSITORY-DERIVED. `S11_RERUN=NO` (docs/reports/QFJ_POST_S11_...REPORT.md). The
  // SCHEMA_DIFFERENTIAL_DIAGNOSTIC docblock names "S11's historical eight-canary D1-D8 matrix" as
  // having run under this goal.
  REQUEST_CONTRACT_DIAGNOSTIC: 'S11',
  // REPOSITORY-DERIVED. `SDH4_CONSUMED=YES` / `SDH4_RERUN=NO`. The POST_SDH4 docblock says "SDH4's
  // R0-R8 matrix ran against the pre-repair schema".
  SCHEMA_DIFFERENTIAL_DIAGNOSTIC: 'SDH4',
  // REPOSITORY-DERIVED. `SRV1_RERUN=NO`. The POST_SRV1 docblock says "SRV1 answered the schema
  // question at the low control cap".
  POST_SDH4_SCHEMA_REPAIR_VERIFICATION: 'SRV1',
  // REPOSITORY-DERIVED. `OAD1_CONSUMED=YES`, `OAD2_CONSUMED=YES`, `OAD3_CONSUMED=YES`, all
  // `RERUN=NO`. The POST_OAD3 docblock says "OAD3 answered most of the question".
  POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC: 'OAD1/OAD2/OAD3',
  // REPOSITORY-DERIVED. `RA1_CONSUMED=YES` / `RA1_RERUN=NO`, and the POST_RA1 docblock opens
  // "RA1 used the goal above".
  POST_OAD3_REPRESENTATIVE_ACCEPTANCE: 'RA1',
  // REPOSITORY-DERIVED. `NRA1_CONSUMED=YES` / `NRA1_RERUN=NO`; the POST_NRA1 docblock describes what
  // "NRA1 sent" under this goal.
  POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE: 'NRA1',
  // REPOSITORY-DERIVED. `MD120B1/2/3_CONSUMED=YES`, all `RERUN=NO`, and the POST_MD120B3 docblock
  // opens "MD120B3 used the goal above".
  POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL: 'MD120B1/MD120B2/MD120B3',
  // REPOSITORY-DERIVED. The POST_RSP20B2 docblock opens "RSP20B2 used the goal above"; RSP20B2's
  // receipt is quoted throughout the merged accounting and emitter sources.
  POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL: 'RSP20B1/RSP20B2',
  // OWNER-LOCKED. `RLD1_CONSUMED=YES` / `RLD1_RERUN=NO`, completed exit 31. The POST_RLD1 docblock
  // also opens "RLD1 used the goal above".
  POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL: 'RLD1',
  // OWNER-LOCKED. `RBD1_CONSUMED=YES` / `RBD1_RERUN=NO`, completed exit 32.
  POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL: 'RBD1',
  // OWNER-LOCKED. `SFD1_CONSUMED=YES` / `SFD1_RERUN=NO`, completed exit 33. This is the goal whose
  // accidental second execution is the reason this module exists.
  POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL: 'SFD1',
  // OWNER-LOCKED. `SFD2_CONSUMED=YES` / `SFD2_RERUN=NO`, completed exit 37.
  //
  // Canonical classification `STRUCTURED_REPLY_PROVIDER_REQUEST_REJECTED`, canonical HTTP 413. The
  // provider judged the REQUEST and refused it, so `providerCompleted=false` and NEITHER local
  // validation stage ran -- the 413 localized nothing, and nothing here may be read as a wire-schema
  // or production-projector verdict.
  //
  // It is tombstoned anyway, and that is the point: the authorization was for one launch, not for
  // one finding. Re-running it would spend a second authorization to ask a question the provider has
  // already declined to accept.
  POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE: 'SFD2',
});

/**
 * The run goals the one-shot guard governs AT ALL.
 *
 * ### Why this exists, and why it is a list rather than a rule
 *
 * The first revision of this module wired the guard to EVERY goal. That made `FULL_EVIDENCE` -- the
 * default, the repository's ordinary evidence purpose -- consumable once per workstation, which
 * would have taken the main operator offline to fix a diagnostic incident. `SAFETY_REPLICATION` too,
 * whose whole design is that a later replication may legitimately disagree with an earlier one and
 * an owner interprets the difference.
 *
 * So eligibility is an explicit closed set, and it is deliberately NOT derived from the `POST_`
 * prefix or any other spelling. A naming rule would silently enrol the next goal somebody names
 * badly, and silently exclude one named well. Adding a bounded one-shot diagnostic means adding it
 * here, in the same PR that adds the goal -- which is exactly the review moment where "is this
 * runnable more than once?" should be asked.
 *
 * Everything here is a BOUNDED ONE-SHOT DIAGNOSTIC: a single governed live question, whose answer is
 * recorded and whose re-execution would spend an authorization to learn nothing.
 *
 * ### Eligible is a SUPERSET of tombstoned, and the gap is where a pending run lives
 *
 * The durable invariants are these, and a spec asserts each:
 *
 * - every tombstone is eligible -- history cannot have consumed a goal the guard does not govern;
 * - `FULL_EVIDENCE` and `SAFETY_REPLICATION` are repeatable and appear in neither list;
 * - every member of the closed goal vocabulary is one or the other, so nothing is unaccounted for.
 *
 * The CONTENT of the eligible-minus-tombstoned difference is a SNAPSHOT of whichever head you are
 * reading, never a law. It has held three values already:
 *
 * - EMPTY, when every eligible goal had been consumed and none was pending;
 * - ONE ENTRY, between `POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE` being wired and SFD2
 *   running it -- a state that existed on purpose, so a wired-but-unrun diagnostic could be launched;
 * - EMPTY again, at THIS head, because SFD2 ran and the goal above is now tombstoned.
 *
 * So an empty difference does not mean the mechanism is unused, and a non-empty one is not a defect.
 * The next PR that wires a bounded one-shot diagnostic makes it non-empty again, and the PR that
 * records that run's consumption empties it -- which is exactly the review moment where "has this
 * been consumed?" gets asked out loud.
 */
export const ONE_SHOT_DIAGNOSTIC_RUN_GOALS: readonly string[] = Object.freeze([
  'REQUEST_CONTRACT_DIAGNOSTIC',
  'SCHEMA_DIFFERENTIAL_DIAGNOSTIC',
  'POST_SDH4_SCHEMA_REPAIR_VERIFICATION',
  'POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC',
  'POST_OAD3_REPRESENTATIVE_ACCEPTANCE',
  'POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE',
  'POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL',
  'POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL',
  'POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL',
  'POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL',
  'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL',
  // POST-SFD1. Eligible AND tombstoned: SFD2 ran it once, and the tombstone above now refuses it on
  // every workstation -- including a fresh one, where no local marker exists to consult.
  'POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE',
]);

/**
 * Whether the one-shot guard governs this goal at all.
 *
 * `false` for `FULL_EVIDENCE` and `SAFETY_REPLICATION`, which are repeatable evidence purposes
 * subject to their own live authorization -- not single historical differentials. A goal this
 * returns `false` for bypasses the guard entirely: no tombstone check, no marker, and no `one-shot`
 * line on the transcript, because a run that was never governed by the guard must not look as if it
 * was.
 */
export function isOneShotDiagnosticRunGoal(goal: string): boolean {
  return ONE_SHOT_DIAGNOSTIC_RUN_GOALS.includes(goal);
}

/** Why a launch was refused. Closed, and content-free. */
export const ONE_SHOT_REFUSALS = [
  /** Repository evidence already records this goal as consumed by a completed live run. */
  'statically-consumed-goal',
  /** This workstation already claimed this goal. The marker is what says so. */
  'goal-already-consumed',
  /** The marker could not be written at all, so consumption cannot be guaranteed. Fail closed. */
  'consumption-marker-unavailable',
] as const;
export type OneShotRefusal = (typeof ONE_SHOT_REFUSALS)[number];

export type OneShotClaim =
  { readonly ok: true } | { readonly ok: false; readonly reason: OneShotRefusal };

/** The seam the operator holds. One method, and no way to release a claim. */
export interface OneShotConsumptionGuard {
  readonly claim: (goal: OperatorRunGoal) => OneShotClaim;
}

/**
 * The marker filename for a goal.
 *
 * A digest rather than the token itself, so a directory listing cannot disclose WHICH governed
 * diagnostic an owner ran. It is a name, never a secret: the goal token is a public closed
 * vocabulary member, and the digest exists for tidiness of disclosure rather than for secrecy.
 */
export function oneShotMarkerFileName(goal: string): string {
  return `qfj-one-shot-${createHash('sha256').update(goal).digest('hex').slice(0, 32)}.marker`;
}

/**
 * Build the guard over an INJECTED directory.
 *
 * The directory is a parameter with no default on purpose. A default would let a spec — or a
 * refactor — write into a developer's real staging area, and the whole point of the marker is that
 * it is durable.
 */
export function createOneShotConsumptionGuard(deps: {
  readonly markerDirectory: string;
  /** Injected for specs. Production passes nothing and gets real exclusive-create semantics. */
  readonly claimExclusive?: (path: string, contents: string) => void;
}): OneShotConsumptionGuard {
  const claimExclusive =
    deps.claimExclusive ??
    ((path: string, contents: string): void => {
      // `wx` is create-exclusive: it throws if the path exists, and the test-and-create is ONE
      // syscall. An `existsSync` then a write would leave a window between them, and the incident
      // was two launches seconds apart.
      const handle = openSync(path, 'wx');
      try {
        writeSync(handle, contents);
      } finally {
        closeSync(handle);
      }
    });

  return Object.freeze({
    claim: (goal: OperatorRunGoal): OneShotClaim => {
      // Repository evidence first. A goal history already records as consumed must refuse before the
      // marker is even consulted, so a fresh workstation cannot re-run a settled experiment.
      if (Object.prototype.hasOwnProperty.call(STATICALLY_CONSUMED_RUN_GOALS, goal)) {
        return { ok: false, reason: 'statically-consumed-goal' };
      }
      const path = join(deps.markerDirectory, oneShotMarkerFileName(goal));
      const contents = `${String(ONE_SHOT_MARKER_FORMAT_VERSION)}\n${goal}\n`;
      try {
        mkdirSync(deps.markerDirectory, { recursive: true });
      } catch {
        // The directory could not be prepared, so a claim cannot be guaranteed durable. Fail closed:
        // a guard that cannot record a claim must not permit the launch it is guarding.
        return { ok: false, reason: 'consumption-marker-unavailable' };
      }
      try {
        claimExclusive(path, contents);
      } catch (error: unknown) {
        // EEXIST is the ordinary second-launch case. Anything else means the marker could not be
        // written, which is equally a reason not to proceed -- but the two are reported apart so an
        // owner is not told "already consumed" when the real problem is a read-only directory.
        const code = (error as { code?: unknown } | null)?.code;
        return code === 'EEXIST'
          ? { ok: false, reason: 'goal-already-consumed' }
          : { ok: false, reason: 'consumption-marker-unavailable' };
      }
      return { ok: true };
    },
  });
}
