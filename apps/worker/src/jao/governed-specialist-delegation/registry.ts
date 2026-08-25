/**
 * The JAO-2 governed specialist registry and the authority ceiling (ADR-0116).
 *
 * ### Local by design, and staying local
 *
 * This is a small closed lookup, not a plugin system. There is no dynamic registration, no discovery,
 * no nearest match, no fallback specialist, no model-selected substitute and no agent spawning: a
 * delegation either names a specialist that is registered, governed for that exact capability, and
 * available -- or it is refused. The lookup never consults model output.
 *
 * It stays inside the worker JAO composition rather than becoming a shared package. One consumer
 * does not justify an abstraction, and a capability-broker package invented before its second caller
 * would harden guesses into a contract.
 *
 * ### The registry does not grant governance, it consumes it
 *
 * Riya is independently governed by her own ADR and behaviour version. `governanceRef` points at
 * that decision. JAO-2 cannot make a specialist safe by listing it; it can only refuse to delegate
 * to one that its own governance has not made available.
 *
 * ### ACTIVE is scoped, and the scope matters
 *
 * `ACTIVE` means available to THIS shadow delegation adapter. It says nothing about whether Riya's
 * production channel is rolled out -- that posture is owned elsewhere and is untouched here. A
 * reader who mistakes this table for rollout truth would be reading a shadow proof as a launch.
 *
 * Pure: no clock, no network, no filesystem, no environment, no storage.
 */
import {
  JAO2_AUTONOMY_RANK,
  jao2SpecialistDescriptorSchema,
  type Jao2DelegationEnvelope,
  type Jao2RefusalReason,
  type Jao2SpecialistDescriptor,
} from './contracts.js';

/**
 * The ONE production specialist JAO-2 ships.
 *
 * Parsed rather than asserted, so every literal in the descriptor schema is enforced at module load:
 * a descriptor claiming business effect, model use, proposal creation or execution authority cannot
 * exist even momentarily.
 *
 * PLANNED and DISABLED descriptors are deliberately absent. Their refusal is proved with test
 * fixtures rather than by shipping fake specialists nobody governs.
 */
export const JAO2_RIYA_SPECIALIST: Jao2SpecialistDescriptor = Object.freeze(
  jao2SpecialistDescriptorSchema.parse({
    specialistId: 'RIYA',
    capabilityId: 'riya.analyze-client-sales-signals',
    governanceRef: 'ADR-0067.riya-client-sales-behaviour',
    availability: 'ACTIVE',
    maxAutonomyLevel: 'L0_REASON',
    dataClass: 'SYNTHETIC_CLIENT_SALES_SIGNALS',
    readOnly: true,
    businessEffect: false,
    maxCallsPerRun: 1,
    timeoutMs: 1_000,
    mayCallModel: false,
    mayCreateProposal: false,
    mayExecute: false,
  }),
);

export const JAO2_PRODUCTION_SPECIALISTS: readonly Jao2SpecialistDescriptor[] = Object.freeze([
  JAO2_RIYA_SPECIALIST,
]);

export type Jao2RegistryLookup =
  | { readonly ok: true; readonly descriptor: Jao2SpecialistDescriptor }
  | { readonly ok: false; readonly refusal: Jao2RefusalReason };

export interface Jao2SpecialistRegistry {
  readonly descriptors: readonly Jao2SpecialistDescriptor[];
  lookup(specialistId: string, capabilityId: string): Jao2RegistryLookup;
}

/**
 * Build the registry over an explicit descriptor list.
 *
 * The list is a parameter so a spec can register a PLANNED or DISABLED specialist and prove it is
 * refused. Production callers pass nothing and get the single ACTIVE Riya adapter.
 *
 * Availability is checked BEFORE anything invokes the specialist, and the three unavailable
 * outcomes stay distinct: "there is no such specialist", "it is planned" and "it is switched off"
 * are different facts and an operator reading a refusal deserves the right one.
 */
export function createJao2SpecialistRegistry(
  descriptors: readonly Jao2SpecialistDescriptor[] = JAO2_PRODUCTION_SPECIALISTS,
): Jao2SpecialistRegistry {
  const frozen = Object.freeze([...descriptors]);
  return Object.freeze({
    descriptors: frozen,
    lookup(specialistId: string, capabilityId: string): Jao2RegistryLookup {
      const byId = frozen.filter((one) => one.specialistId === specialistId);
      if (byId.length === 0) {
        // No nearest match and no substitute. An unknown specialist is a stop, not a routing problem.
        return Object.freeze({ ok: false as const, refusal: 'SPECIALIST_UNKNOWN' as const });
      }
      const descriptor = byId.find((one) => one.capabilityId === capabilityId);
      if (descriptor === undefined) {
        // Registered, but not governed for what was asked. Scope is the specialist's, not the caller's.
        return Object.freeze({ ok: false as const, refusal: 'CAPABILITY_MISMATCH' as const });
      }
      if (descriptor.availability === 'PLANNED') {
        return Object.freeze({ ok: false as const, refusal: 'SPECIALIST_PLANNED' as const });
      }
      if (descriptor.availability === 'DISABLED') {
        return Object.freeze({ ok: false as const, refusal: 'SPECIALIST_DISABLED' as const });
      }
      return Object.freeze({ ok: true as const, descriptor });
    },
  });
}

export type Jao2AuthorityVerdict =
  { readonly ok: true } | { readonly ok: false; readonly refusal: Jao2RefusalReason };

/**
 * The authority ceiling. THE central JAO-2 invariant.
 *
 * Delegation may narrow authority and may never widen it. Two different mechanisms enforce that, and
 * the split is deliberate rather than an accident of what was easy:
 *
 * **The absolutes are enforced by PARSING.** `businessEffect`, `mayCallModel`, `mayCreateProposal`
 * and `mayExecute` are `z.literal(false)` in the descriptor schema, and `businessEffectAllowed` and
 * `maxCalls` are literals in the envelope schema. A value claiming otherwise cannot survive
 * `safeParse`, so re-comparing those fields here would be dead code -- TypeScript can already prove
 * them false, and the linter says so. `z.literal(false)` is a RUNTIME check, not a type annotation:
 * the guarantee comes from the parse, which is why the descriptor is re-parsed below rather than
 * trusted because it arrived with the right type.
 *
 * **The RELATIONSHIP is enforced here**, because no schema can express it. Whether a requested level
 * outranks the supervisor's is a comparison between two independently supplied values:
 *
 * - the requested level must not outrank the SUPERVISOR's -- delegated <= parent;
 * - nor the SPECIALIST's own governed ceiling, because a supervisor holding `L1_READ` still cannot
 *   hand `L1_READ` to a specialist its own governance bounds at `L0_REASON`.
 *
 * Compared by RANK on parsed data. The envelope reached the workflow as `unknown` from a caller and
 * its type was gone long before this mattered.
 */
export function evaluateDelegationAuthority(
  envelope: Jao2DelegationEnvelope,
  descriptor: Jao2SpecialistDescriptor,
): Jao2AuthorityVerdict {
  // Re-parsed rather than trusted. A descriptor that reached here without ever being parsed would
  // carry the TYPE and not the guarantee, and this function must not be the place that assumes the
  // difference away.
  const governed = jao2SpecialistDescriptorSchema.safeParse(descriptor);
  if (!governed.success) {
    return Object.freeze({ ok: false as const, refusal: 'AUTHORITY_ESCALATION' as const });
  }

  const requested = JAO2_AUTONOMY_RANK[envelope.requestedAutonomyLevel];
  const parent = JAO2_AUTONOMY_RANK[envelope.parentAutonomyLevel];
  const specialistCeiling = JAO2_AUTONOMY_RANK[governed.data.maxAutonomyLevel];

  if (requested > parent || requested > specialistCeiling) {
    return Object.freeze({ ok: false as const, refusal: 'AUTHORITY_ESCALATION' as const });
  }
  return Object.freeze({ ok: true as const });
}
