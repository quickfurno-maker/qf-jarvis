/**
 * The `qfj-jf5b-certify` process entry (JF-5B, ADR-0152).
 *
 * The ONLY module in this lane that reads `process.argv` or sets an exit code, and the only one that
 * assembles the real terminal, network and filesystem seams. It delegates immediately, so importing the
 * CLI module runs nothing and a spec can drive the whole phase sequence without a process.
 *
 * Same shape as `run-shadow-once`, deliberately: a second process pattern would be a second place where
 * argv handling and exit codes could drift.
 */
import { createDefaultJf5bCliDeps } from '../composition/jf5b-live-composition.js';
import { runJf5bLiveCertificationCli } from '../cli/run-jf5b-live-certification.js';

const outcome = await runJf5bLiveCertificationCli(
  process.argv.slice(2),
  createDefaultJf5bCliDeps(process.argv.slice(2)),
);

process.exitCode = outcome.exitCode;
