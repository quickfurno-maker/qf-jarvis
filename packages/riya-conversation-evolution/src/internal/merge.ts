/**
 * The provenance merge (RWC-P4A, ADR-0098 §6).
 *
 * Pure. No clock, no randomness, no I/O. Nothing here mutates its inputs.
 *
 * ### The rules, and why each one is what it is
 *
 * **Same value.** A higher incoming rank STRENGTHENS the provenance and keeps the value; an equal or
 * lower rank is a semantic no-op. Repeating a fact you already hold is not news, and bumping a
 * revision for it would make every restated sentence look like a change to whoever reads the
 * revision history — and, under RWC-P4B, would cost a compare-and-set for nothing.
 *
 * **Different value.** Higher rank replaces. Lower rank is rejected and the existing value stands.
 * Equal rank: the LATER observation wins. Two statements of equal standing about the same field are
 * a person changing their mind, and the most recent thing they said is the one they meant. This
 * covers `user_stated → user_stated`, `user_selected ↔ user_stated`, `user_confirmed →
 * user_confirmed` and `model_inferred → model_inferred` alike.
 *
 * **`user_confirmed` is never overwritten from below.** The client was shown the value and agreed it
 * was right. Only another confirmation may change it. This is the rule that stops a model inference
 * silently rewriting something a person checked.
 *
 * **`CLEAR` requires a user origin.** Withdrawing a fact is an act only the person who could have
 * stated it may perform, and the ordinary rank rule still applies on top: `user_stated` cannot clear
 * a `user_confirmed` value, `user_confirmed` can.
 */
import type { DiscoveryField, NeedDiscovery } from '@qf-jarvis/riya-agent';
import type {
  RiyaContinuityFieldProvenanceMap,
  RiyaFieldProvenance,
} from '@qf-jarvis/riya-conversation-continuity';

import { DISCOVERY_VALUE_KEY, PROVENANCE_RANK, USER_ORIGIN_PROVENANCES } from './field-map.js';
import type { RiyaConversationObservationBatchV1 } from '../contracts/observation.js';

/** Why a field update did not apply. Closed, and deliberately carrying no value. */
export type RiyaObservationRejectionReason = 'lower-provenance' | 'clear-not-user-origin';

export interface MergeOutcome {
  /** The merged value per field: a string, or `undefined` for absent/cleared. */
  readonly values: Readonly<Partial<Record<DiscoveryField, string>>>;
  readonly provenance: RiyaContinuityFieldProvenanceMap;
  readonly appliedFields: readonly DiscoveryField[];
  readonly rejectedFields: readonly {
    readonly field: DiscoveryField;
    readonly reason: RiyaObservationRejectionReason;
  }[];
  /** True when at least one field's value or provenance actually moved. */
  readonly changed: boolean;
  /**
   * True when at least one field's VALUE moved — a different value stored, or a value cleared.
   *
   * Narrower than `changed` on purpose, and the distinction is load-bearing: it is what invalidates
   * a prior summary confirmation. A client confirmed the exact facts they were shown, so a changed
   * budget means the thing they agreed to no longer exists. Strengthening a provenance on an
   * IDENTICAL value changes nothing they read, so it must not throw their confirmation away.
   *
   * INTERNAL. Not reachable from the package root.
   */
  readonly valueChanged: boolean;
}

/** Read the current value of one discovery field out of a validated `NeedDiscovery`. */
function currentValue(discovery: NeedDiscovery, field: DiscoveryField): string | undefined {
  return discovery[DISCOVERY_VALUE_KEY[field]];
}

/** Apply one batch to one state's discovery + provenance. Neither input is touched. */
export function mergeObservations(
  discovery: NeedDiscovery,
  fieldProvenance: RiyaContinuityFieldProvenanceMap,
  batch: RiyaConversationObservationBatchV1,
): MergeOutcome {
  // Maps rather than plain objects: a CLEAR genuinely REMOVES a key, and under
  // `exactOptionalPropertyTypes` an object cannot express that by assignment -- only by deletion,
  // which is both awkward and easy to get subtly wrong. A map deletes cleanly and is converted to
  // the frozen record shape once, at the end.
  const values = new Map<DiscoveryField, string>();
  const provenance = new Map<DiscoveryField, RiyaFieldProvenance>();

  // Start from a COPY of what is already known. The batch names only the fields this turn touched;
  // every other field must survive unchanged, including one the current phase is nowhere near.
  for (const field of Object.keys(DISCOVERY_VALUE_KEY) as DiscoveryField[]) {
    const existing = currentValue(discovery, field);
    if (existing !== undefined) {
      values.set(field, existing);
    }
    const existingProvenance = fieldProvenance[field];
    if (existingProvenance !== undefined) {
      provenance.set(field, existingProvenance);
    }
  }

  const applied: DiscoveryField[] = [];
  const rejected: { field: DiscoveryField; reason: RiyaObservationRejectionReason }[] = [];
  let changed = false;
  let valueChanged = false;

  for (const observation of batch.observations) {
    const field = observation.field;
    const existingValue = values.get(field);
    const existingProvenance = provenance.get(field);
    const incomingRank = PROVENANCE_RANK[observation.provenance];
    // An absent field has no standing to defend: rank 0 loses to every real provenance.
    const existingRank = existingProvenance === undefined ? 0 : PROVENANCE_RANK[existingProvenance];

    if (observation.operation === 'CLEAR') {
      if (!USER_ORIGIN_PROVENANCES.includes(observation.provenance)) {
        rejected.push({ field, reason: 'clear-not-user-origin' });
        continue;
      }
      if (existingValue === undefined) {
        // Nothing to withdraw. Not a rejection -- the batch asked for a state that already holds.
        continue;
      }
      if (incomingRank < existingRank) {
        rejected.push({ field, reason: 'lower-provenance' });
        continue;
      }
      // Clearing removes the value AND its provenance: a provenance for a value that is gone would
      // describe nothing, and the continuity contract refuses provenance without a value.
      values.delete(field);
      provenance.delete(field);
      applied.push(field);
      changed = true;
      // A withdrawn value is a changed value: the summary the client agreed to said something here.
      valueChanged = true;
      continue;
    }

    // SET. The schema already guaranteed a value is present; an observation with none could not
    // have been built.
    const incomingValue = observation.value ?? '';

    if (existingValue === incomingValue) {
      if (incomingRank > existingRank) {
        // Same fact, told more strongly. Worth recording: it changes what may overwrite it later.
        provenance.set(field, observation.provenance);
        applied.push(field);
        changed = true;
      }
      // Equal or lower rank on an identical value is a semantic no-op -- not a rejection, because
      // nothing was refused; the state already says exactly this.
      continue;
    }

    if (incomingRank < existingRank) {
      rejected.push({ field, reason: 'lower-provenance' });
      continue;
    }

    // Higher rank replaces; EQUAL rank means the later observation wins.
    values.set(field, incomingValue);
    provenance.set(field, observation.provenance);
    applied.push(field);
    changed = true;
    valueChanged = true;
  }

  return {
    values: Object.freeze(Object.fromEntries(values) as Partial<Record<DiscoveryField, string>>),
    provenance: Object.freeze(Object.fromEntries(provenance) as RiyaContinuityFieldProvenanceMap),
    appliedFields: Object.freeze([...applied]),
    rejectedFields: Object.freeze(rejected.map((entry) => Object.freeze({ ...entry }))),
    changed,
    valueChanged,
  };
}
