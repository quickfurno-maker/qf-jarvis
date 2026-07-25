/**
 * The M5 Jarvis runtime composition root (QFJ-M5, ADR-0059 §A, §B, §G).
 *
 * `createJarvisRuntime(config)` validates the mandatory injected dependencies (fail closed at
 * construction), then returns a frozen runtime whose async `processInbound` composes M1–M4 for one
 * envelope behind the ONE authoritative state source. It holds no global mutable state, no database,
 * and no persistence; it exposes only `processInbound` — no send/deliver/execute/persist/callN8n
 * method. QuickFurno Core remains the only business authority; model output is a draft only.
 */
import type { InboundEnvelope } from '@qf-jarvis/agent-runtime';

import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type { JarvisRuntimeResult } from '../contracts/runtime-result.js';
import { assertMandatoryDependencies } from './validate-composition.js';
import { composeAndProcess } from './process-inbound.js';

/** The immutable Jarvis runtime: one async pre-transport composition entry point. */
export interface JarvisRuntime {
  processInbound(envelope: InboundEnvelope): Promise<JarvisRuntimeResult>;
}

/** Build a frozen Jarvis runtime from injected collaborators. Missing mandatory deps fail closed. */
export function createJarvisRuntime(config: JarvisRuntimeConfig): JarvisRuntime {
  assertMandatoryDependencies(config);
  return Object.freeze({
    processInbound(envelope: InboundEnvelope): Promise<JarvisRuntimeResult> {
      return composeAndProcess(config, envelope);
    },
  });
}
