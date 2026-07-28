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
import { createDiagnosticRecorder, createSystemMonotonicClock } from './diagnostic-telemetry.js';
import {
  createInstrumentedGroqTransport,
  createSystemFetchLike,
} from './instrumented-transport.js';
import { createNodeMaskedSecretSource } from './masked-tty-credential-resolver.js';
import { createSystemSmokeTimer } from './run-once.js';

// ONE recorder for the whole run, shared by the transport and the runner so the wire milestones and
// the run milestones sit on a single timeline. Its origin is this moment.
const recorder = createDiagnosticRecorder(createSystemMonotonicClock());

const exitCode = await runSmokeCli(
  process.argv.slice(2),
  {
    write: (line: string): void => {
      process.stdout.write(`${line}\n`);
    },
    nowIso: (): string => new Date().toISOString(),
  },
  {
    transport: createInstrumentedGroqTransport({
      fetchLike: createSystemFetchLike(),
      recorder,
    }),
    credentialSource: createNodeMaskedSecretSource(),
    clock: createSystemClock(),
    timer: createSystemSmokeTimer(),
    diagnostics: recorder,
  },
);

process.exitCode = exitCode;
