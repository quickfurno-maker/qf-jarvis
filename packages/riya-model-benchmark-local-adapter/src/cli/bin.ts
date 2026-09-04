#!/usr/bin/env node
/**
 * The executable entry point (AS4-PREP-A).
 *
 * Deliberately thin: it supplies the two things a real process has that a spec must not -- argv and a
 * wall clock -- and hands them to `runRiyaLocalBenchmarkCli`, which holds all the behaviour. Everything
 * testable lives on the other side of that call, so the CLI's decisions are proved without spawning a
 * process.
 *
 * It reads no environment. There is no credential to find, no endpoint to inherit and no mode to be
 * switched on from outside the command somebody typed.
 *
 * Output goes through `process.stdout.write` rather than `console`, which is banned in governed
 * packages and is the wrong tool anyway: this writes lines somebody reads, not diagnostics.
 */
import { runRiyaLocalBenchmarkCli } from './local-benchmark.js';

const exitCode = await runRiyaLocalBenchmarkCli({
  argv: process.argv.slice(2),
  // The wall clock, for evidence `createdAt` only. The monotonic clock that measures latency is a
  // separate port and is never derived from this.
  nowIso: () => new Date().toISOString(),
  write: (line: string) => {
    process.stdout.write(`${line}\n`);
  },
});

process.exitCode = exitCode;
