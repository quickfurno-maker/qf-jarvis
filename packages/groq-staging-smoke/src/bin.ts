#!/usr/bin/env node
/**
 * The one-shot executable composition root (QFJ-S1A, ADR-0061 §C).
 *
 * The ONLY place the real capabilities are constructed: the fixed-origin Groq fetch transport, the
 * masked interactive terminal, the system clock, and one `setTimeout`. It wires them into `runSmokeCli`,
 * writes the sanitized report, sets an exit code, and ends. There is no loop, no prompt for a second
 * run, no interactive session, and no path that reaches QuickFurno Core, the Jarvis runtime, n8n,
 * WhatsApp, a database, a rollout, or a provider activation.
 *
 * No test imports this file — every test drives `runSmokeCli`/`runGroqStagingSmokeOnce` with injected
 * fakes instead, so the suite never opens a terminal and never touches the network.
 */
import { createSystemClock } from '@qf-jarvis/model-gateway';

import { runSmokeCli } from './cli.js';
import { createNodeMaskedSecretSource } from './masked-tty-credential-resolver.js';
import { createSystemSmokeTimer } from './run-once.js';
import { createSystemSmokeWireDeps } from './system-wire.js';

// ONE recorder for the whole run, shared by the transport and the runner so the wire milestones and
// the run milestones sit on a single timeline. Its origin is this moment.
//
// HF4-R4: built by the shared helper rather than assembled here. This file used to be the only place
// the pairing was written down, and the candidate evidence operator — the other composition root —
// got it wrong, which is how RUN S5 printed a PASSING smoke with every wire milestone ABSENT.
const wire = createSystemSmokeWireDeps();

const exitCode = await runSmokeCli(
  process.argv.slice(2),
  {
    write: (line: string): void => {
      process.stdout.write(`${line}\n`);
    },
    nowIso: (): string => new Date().toISOString(),
  },
  {
    ...wire,
    credentialSource: createNodeMaskedSecretSource(),
    clock: createSystemClock(),
    timer: createSystemSmokeTimer(),
  },
);

process.exitCode = exitCode;
