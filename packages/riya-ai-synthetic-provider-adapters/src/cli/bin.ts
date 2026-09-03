#!/usr/bin/env node
/**
 * The executable entry point (AS3A, ADR-0143 §14).
 *
 * Deliberately thin: it supplies the three things a real process has that a spec must not — argv, the
 * environment and a clock — and hands them to `runRiyaSyntheticPilotCli`, which holds all the
 * behaviour. Everything testable lives on the other side of that call, so the CLI's decisions can be
 * proved without spawning a process or touching the real environment.
 *
 * Output goes through `process.stdout.write` rather than `console`, which is banned in governed
 * packages and is the wrong tool anyway: this writes lines somebody reads, not diagnostics.
 */
import { runRiyaSyntheticPilotCli } from './pilot.js';

const exitCode = await runRiyaSyntheticPilotCli({
  argv: process.argv.slice(2),
  environment: process.env,
  now: () => Date.now(),
  write: (line: string) => {
    process.stdout.write(`${line}\n`);
  },
});

process.exitCode = exitCode;
