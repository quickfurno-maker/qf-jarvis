/**
 * `pnpm inspect:failures` — the process entry for the read-only projection-failure inspection CLI
 * (QFJ-P03.07G).
 *
 * This module IS the executable: running it is the point, and it is never imported. All of the testable
 * logic lives in {@link file://./projection-inspection-cli.ts}, which has no auto-run — the same split
 * the projection worker already uses, so the command can be unit-tested without a real process,
 * environment, or database.
 *
 * It sets `process.exitCode` rather than calling `process.exit()`, so Node flushes stdio before the
 * process ends and a large `--json` page is never truncated mid-write.
 */

import { randomUUID } from 'node:crypto';

import {
  defaultProjectionInspectionCliDeps,
  runProjectionInspectionCli,
} from './projection-inspection-cli.js';

// `process.argv.slice(2)` drops the node binary and this script path. The correlation id is generated
// HERE, by the repository — never taken from the environment or an argument, both of which are caller
// controlled and unbounded.
process.exitCode = await runProjectionInspectionCli(
  defaultProjectionInspectionCliDeps(process.argv.slice(2), randomUUID()),
);
