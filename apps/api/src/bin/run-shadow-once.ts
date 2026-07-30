/**
 * The `qfj-run-shadow-once` process entry (QFJ-S2-E-B).
 *
 * The ONLY module that reads `process.argv` or sets an exit code. It delegates immediately, so importing
 * the CLI module itself runs nothing and a spec can drive it without a process.
 */
import { defaultShadowCliIo, runShadowOnceCli } from '../cli/run-shadow-once.js';

process.exitCode = await runShadowOnceCli(process.argv.slice(2), defaultShadowCliIo());
