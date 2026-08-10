/**
 * The measurement ENVIRONMENT: enough to compare, never enough to identify (RMB-A).
 *
 * ### Why this contract is mostly a list of refusals
 *
 * A latency number is meaningless without the machine it was measured on, so the temptation is to
 * record everything the harness can see. That produces an artifact carrying a hostname, a username in
 * a path, a cloud instance id and a GPU serial — committed to Git, shared with a vendor, indexed
 * forever.
 *
 * The fields below are the ones that make two runs comparable: architecture family, accelerator
 * family and count, memory, runtime engine and its config digest. There is no DEDICATED field for a
 * hostname, a username, a path, a serial, a MAC, an IP or a credential, and `.strict()` does the rest
 * — an extra key is a refusal, not a passthrough.
 *
 * ### The honest limit of that
 *
 * `acceleratorRef`, `runtimeEngineId` and `runtimeEngineVersion` are opaque identifier-shaped fields,
 * and a determined caller could put something meaningful into one. The grammar keeps out URLs, paths
 * and email addresses; it cannot keep out a machine name that happens to look like an identifier.
 *
 * So the guarantee is precise: no dedicated identity field, no arbitrary extra keys, and non-
 * identifying opaque refs by authoring and harness governance. Closing the remaining gap in code would
 * mean a closed hardware registry, which this slice deliberately does not build — and claiming the
 * stronger guarantee without one would be the kind of overstatement this package exists to avoid.
 *
 * ### Hosted opacity is honest, not incomplete
 *
 * Behind a provider API nobody knows the hardware. `HOSTED_OPAQUE` therefore forbids the hardware
 * fields outright rather than leaving them optional and hoping. An invented accelerator count is
 * worse than an absent one: absent is a known unknown, invented is a number somebody will later
 * compare against.
 */
import { z } from 'zod';

import { RiyaBenchmarkError } from './errors.js';
import {
  RIYA_BENCHMARK_ACCELERATOR_FAMILIES,
  RIYA_BENCHMARK_ARCHITECTURE_FAMILIES,
  RIYA_BENCHMARK_ENVIRONMENT_KINDS,
  RIYA_BENCHMARK_MAX_BYTES,
} from './vocabularies.js';
import type {
  RiyaBenchmarkAcceleratorFamily,
  RiyaBenchmarkArchitectureFamily,
  RiyaBenchmarkEnvironmentKind,
} from './vocabularies.js';

export interface RiyaBenchmarkEnvironmentV1 {
  readonly version: 1;
  readonly kind: RiyaBenchmarkEnvironmentKind;
  /** LOCAL_EXPLICIT only. Coarse family, never a CPU model string. */
  readonly architectureFamily?: RiyaBenchmarkArchitectureFamily;
  readonly acceleratorFamily?: RiyaBenchmarkAcceleratorFamily;
  /** An opaque reference, e.g. `accelerator.alpha`. Never a serial or a device path. */
  readonly acceleratorRef?: string;
  readonly acceleratorCount?: number;
  readonly acceleratorMemoryBytesPerDevice?: number;
  readonly hostMemoryBytes?: number;
  /** The engine that executed the run, when known. `HOSTED_OPAQUE` may omit it. */
  readonly runtimeEngineId?: string;
  readonly runtimeEngineVersion?: string;
  /** A digest of the engine configuration. Never the configuration itself. */
  readonly runtimeConfigDigest?: string;
}

export type RiyaBenchmarkEnvironmentInput = RiyaBenchmarkEnvironmentV1;

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const BYTES = z.int().min(1).max(RIYA_BENCHMARK_MAX_BYTES);

const environmentSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(RIYA_BENCHMARK_ENVIRONMENT_KINDS),
    architectureFamily: z.enum(RIYA_BENCHMARK_ARCHITECTURE_FAMILIES).optional(),
    acceleratorFamily: z.enum(RIYA_BENCHMARK_ACCELERATOR_FAMILIES).optional(),
    acceleratorRef: IDENTIFIER.optional(),
    acceleratorCount: z.int().min(0).max(1_024).optional(),
    acceleratorMemoryBytesPerDevice: BYTES.optional(),
    hostMemoryBytes: BYTES.optional(),
    runtimeEngineId: IDENTIFIER.optional(),
    runtimeEngineVersion: IDENTIFIER.optional(),
    runtimeConfigDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
  })
  .strict();

/** The hardware fields a hosted environment must NOT claim. */
const HARDWARE_FIELDS = [
  'architectureFamily',
  'acceleratorFamily',
  'acceleratorRef',
  'acceleratorCount',
  'acceleratorMemoryBytesPerDevice',
  'hostMemoryBytes',
] as const;

/** Validate and freeze an environment profile. Throws `ENVIRONMENT_INVALID`. */
export function createRiyaBenchmarkEnvironment(
  input: RiyaBenchmarkEnvironmentInput,
): RiyaBenchmarkEnvironmentV1 {
  const parsed = environmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaBenchmarkError('ENVIRONMENT_INVALID');
  }
  const e = parsed.data;

  if (e.kind === 'HOSTED_OPAQUE') {
    for (const field of HARDWARE_FIELDS) {
      if (e[field] !== undefined) {
        throw new RiyaBenchmarkError('ENVIRONMENT_INVALID');
      }
    }
  } else {
    // A local run that cannot say what it ran on is not a local run worth comparing.
    if (e.architectureFamily === undefined || e.acceleratorFamily === undefined) {
      throw new RiyaBenchmarkError('ENVIRONMENT_INVALID');
    }
    // Accelerator count and family have to agree. "NONE, four of them" is a harness bug, and it is
    // the kind that survives review because each field looks fine alone.
    const hasAccelerator = e.acceleratorFamily !== 'NONE' && e.acceleratorFamily !== 'CPU_ONLY';
    const count = e.acceleratorCount ?? 0;
    if (hasAccelerator !== count > 0) {
      throw new RiyaBenchmarkError('ENVIRONMENT_INVALID');
    }
    // Per-device memory without a device is meaningless.
    if (e.acceleratorMemoryBytesPerDevice !== undefined && count === 0) {
      throw new RiyaBenchmarkError('ENVIRONMENT_INVALID');
    }
  }

  return Object.freeze({
    version: 1 as const,
    kind: e.kind,
    ...(e.architectureFamily === undefined ? {} : { architectureFamily: e.architectureFamily }),
    ...(e.acceleratorFamily === undefined ? {} : { acceleratorFamily: e.acceleratorFamily }),
    ...(e.acceleratorRef === undefined ? {} : { acceleratorRef: e.acceleratorRef }),
    ...(e.acceleratorCount === undefined ? {} : { acceleratorCount: e.acceleratorCount }),
    ...(e.acceleratorMemoryBytesPerDevice === undefined
      ? {}
      : { acceleratorMemoryBytesPerDevice: e.acceleratorMemoryBytesPerDevice }),
    ...(e.hostMemoryBytes === undefined ? {} : { hostMemoryBytes: e.hostMemoryBytes }),
    ...(e.runtimeEngineId === undefined ? {} : { runtimeEngineId: e.runtimeEngineId }),
    ...(e.runtimeEngineVersion === undefined
      ? {}
      : { runtimeEngineVersion: e.runtimeEngineVersion }),
    ...(e.runtimeConfigDigest === undefined ? {} : { runtimeConfigDigest: e.runtimeConfigDigest }),
  });
}
