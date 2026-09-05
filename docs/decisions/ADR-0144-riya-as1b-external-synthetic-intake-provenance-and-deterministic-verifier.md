# ADR-0144 — AS1-B: external synthetic intake provenance and deterministic verifier support

- **Status:** Accepted — **implemented offline on branch
  `qfj-riya-as1b-external-synthetic-intake-provenance`.** Contract and test surface only.
  **Authorizes no generation, no training, no provider call and no model selection.**
- **Date:** 2026-09-05
- **Depends on:** ADR-0143 (AS0: the AI-synthetic training lane and automated quality gate), ADR-0107
  (RID-F1 dataset foundation and leakage firewall), ADR-0108 (HGV1-A Human Gold V1 authoring)
- **Baseline:** `main` at `f6d1216d28454afff54b75a8f60af826cb7cc0cd` — AS3A merged as PR #193.
  Migrations `0001`–`0013`. **AS1-B adds none.**
- **Supersedes:** nothing. ADR-0143 stands in full, and this document adds a second provenance mode
  under it rather than reinterpreting the first.

## Context

AS1 defined how a synthetic candidate earns acceptance: a scenario plan, a provenance record naming
the four generation roles, independent critic verdicts, and per-trajectory acceptance evidence bound
to the trajectory and scenario **digests**. AS2 built the harness that produces all of that in-repo.

A batch of 412 Riya synthetic candidates now exists that the AS2 harness did not produce. They were
generated manually, outside this repository, and delivered as files. They are real, they are
model-written, and the owner wants them able to participate in canonical AS1 acceptance evidence.

They cannot, as things stand, and the reason is precise rather than bureaucratic:
`RiyaAiSyntheticGenerationProvenanceV1` requires `scenarioPlannerConfigRef`,
`customerSimulatorConfigRef`, `riyaTeacherConfigRef` and `annotationVerifierConfigRef`. Those four
refs describe an allocation the AS2 harness made out of a config inventory. For an externally
generated row, no such allocation happened.

### The failure this ADR is written against

The cheap way to unblock the 412 is to fill those four refs with plausible strings — `cfg.planner`,
`cfg.simulator`, `cfg.teacher`, `cfg.verifier` — and let the rows through. Every existing gate would
pass. The digest would seal the record, the acceptance evidence would bind that digest, and the corpus
would permanently assert that an AS2 run produced conversations no AS2 run ever touched.

That is the same failure ADR-0143 was written against, one level down. AS0 refused to let model-written
dialogue wear the human lane's label. AS1-B refuses to let externally produced dialogue wear the AS2
harness's label. In both cases the artifact would be unfalsifiable afterwards: nobody could separate
the invented allocations from the real ones, and every downstream claim resting on "this row came from
a named harness configuration" would be false with no way to discover it.

The second cheap route is to grandfather the existing external critic artifacts. Those are KEEP/REJECT
decisions carrying neither `criticConfigRef` nor `satisfiedQualityDimensions`. Accepting them would
mean relaxing the critic contract for exactly the rows that were reviewed least rigorously.

## Decision

### 1. Generation provenance becomes an explicit closed set of two modes

`RIYA_AI_SYNTHETIC_PROVENANCE_MODES` names them:

| Mode                               | Record                                      | Produced by                         |
| ---------------------------------- | ------------------------------------------- | ----------------------------------- |
| `IN_REPO_GENERATED_SYNTHETIC`      | `RiyaAiSyntheticGenerationProvenanceV1`     | the AS2 harness, in this repository |
| `EXTERNAL_MANUAL_SYNTHETIC_INTAKE` | `RiyaAiSyntheticExternalIntakeProvenanceV1` | manually, outside this repository   |

They are **sibling record shapes**, not a widened one, and neither can be constructed as the other.
The external record carries `generationMode` as a stored literal its constructor assigns; both schemas
are `.strict()`, so an external record cannot claim an AS2 role ref and an in-repo record cannot carry
the external discriminant. Mutual unconstructibility is a stronger guarantee than a discriminant a
caller could copy across.

### 2. Historical V1 provenance did not change, and no discriminant was added to it

`RiyaAiSyntheticGenerationProvenanceV1` has exactly the fields it had. No rename, no addition, no
reinterpretation.

This is not politeness about churn. Acceptance evidence binds provenance solely through
`provenanceSha256`, so adding an `IN_REPO_GENERATED_SYNTHETIC` literal to that record would move its
canonical bytes and **every acceptance evidence record already issued would stop validating against
the exact provenance it was built from**. Evidence you have to reinterpret is evidence you cannot rely
on — the same reasoning ADR-0143 §6 used when it refused to add `reviewMode` to the release policy.

The in-repo mode is therefore identified by the ABSENCE of `generationMode`. The derivation is total:
the union has two members and one of them stores the literal.

### 3. External provenance binds only identity that actually exists

`RiyaAiSyntheticExternalIntakeProvenanceV1` names:

- `generationMode` — the stored discriminant;
- `generationRef` — the intake bundle identity, and the teacher binding
  (`trajectory.source.teacherRef` must equal it, exactly as on the in-repo route);
- `intakeContractRef` / `intakeContractVersion` — which external intake contract admitted the row;
- `batchRef` — the delivery;
- `producerFamilyRef` — an opaque, non-secret family handle for whatever produced the dialogue;
- `producerTeacherRef` — the producer's identifier for the teacher that wrote it;
- `scenarioRef` / `scenarioSha256` — the canonical scenario, by ref and by digest;
- `sourceCandidateSha256` — the delivered candidate record, as received (a **claim**, see §4);
- `sourceTrajectoryArtifactSha256` — the trajectory artifact derived from that source;
- `sourceBundleSha256` — the delivered bundle, so a swapped member is not invisible (a **claim**).

**No AS2 run id. No config inventory ref. No planner config. No simulator config.** None of them
existed, and a field somebody has to invent a value for is a field that stops meaning anything.

`producerFamilyRef` is REQUIRED here, unlike the optional family handles on the in-repo record: there,
the inventory already knows the family; here, this is the only statement of what wrote the words.

`producerTeacherRef` is what the critic-independence rule compares against on this route. Without it,
the gate could only prove a critic was not the intake bundle — which every critic trivially is not —
and "the thing that wrote it also approved it" would stop being detectable.

There is no source file path. A path is a location, not an identity: a moved file would look like a
different candidate, and a file swapped in place would look like the same one.

### 4. A source-digest CLAIM is not a source-digest PROOF

Owner review of PR #195 found the blocker this section exists to close. `sourceCandidateSha256` and
`sourceBundleSha256` were sealed into `provenanceSha256` and compared to nothing, so a caller could
supply any two well-formed 64-hex strings and the gate would accept a row asserting a delivery that
never existed. The claim that these fields "prevent substitution" was not true as implemented.

The two ideas must be kept apart, because conflating them is what produced the gap:

| Mechanism                          | What it actually proves                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `provenanceSha256`                 | the source-binding claims have not changed since acceptance evidence was built              |
| external source-binding validation | those claims equal the digests observed from the actual intake delivery, at validation time |

`provenanceSha256` alone is **not** evidence that `sourceCandidateSha256` or `sourceBundleSha256` are
accurate. It never was.

So `RiyaAiSyntheticExternalSourceBindingV1` carries what an intake reader OBSERVED in the files:
`generationRef`, `observedSourceCandidateSha256`, `observedSourceBundleSha256`. The validator takes a
collection of them and, for every external-intake row, requires exactly one for that `generationRef`
whose observed digests equal the claimed ones. A missing binding and a duplicated binding are each
their own blocking finding — a missing observation is not silently reported as a mismatch, because
the two have different remedies.

**The observation must come from the files, not from the provenance record.** A binding copied out of
the record it corroborates makes the comparison `x === x`. No contract can enforce where a caller got
its numbers; what this one does is make the boundary explicit, so the future intake implementation has
a single deterministic place to hand over digests computed from bytes.

`sourceTrajectoryArtifactSha256` and `scenarioSha256` are NOT in the binding. They are recomputed by
the validator from the records in hand, which is strictly stronger than an observation a caller
reports, and adding a reported copy would weaken them.

#### The hashing conventions, pinned

"Byte identity" is ambiguous until the bytes are named, so both are named here and are **raw byte**
digests, deliberately not canonical JSON — canonicalizing would make two differently-formatted
deliveries hash the same, which is the opposite of what a substitution check needs.

- **Candidate:** SHA-256 over the exact UTF-8 bytes of the individual delivered JSONL record,
  EXCLUDING its line terminator (no `
`, no `
`). No trimming, no re-serialization, no key
  reordering.
- **Bundle:** SHA-256 over the exact bytes of the delivered bundle file, as received.

#### No member digest

The bundle digest already fixes every byte of the delivery, so a member file's bytes are determined by
it rather than independently attested — a member digest would be derivable from the very thing it
claims to corroborate, and the actual external bundle layout is not recorded anywhere in this
repository to justify one on reproducibility grounds. If a future delivery layout makes the
bundle → member → candidate relationship genuinely non-reproducible, adding one is a contract change
with its own justification, not a field added on suspicion.

### 5. Deterministic verifier support is an explicit identity plus run evidence

The in-repo route binds an annotation verifier through `annotationVerifierConfigRef`, which is
meaningful there because the harness really ran that configuration. The external route has no such
run. What it can have is a pass by this repository's own deterministic validation stack.

`RiyaAiSyntheticDeterministicVerifierRunV1` binds `verifierRef`, `verifierImplementationRef` and its
version, `validationScopeRef` and its version, the `trajectoryArtifactSha256` the run actually
verified, the `deterministicReportSha256` the run produced, and a closed `verdict` of `PASSED` or
`FAILED`.

**A bare string like `cfg.verifier` is explicitly not sufficient.** A ref proves nothing about an
execution; a route with no verification would then look identical to one with a clean deterministic
pass. The report digest is what makes the run a fact.

It is a **sibling contract, not a model configuration**. `RiyaSyntheticModelConfigV1` requires a
`modelRef`, an `adapterRef`, an `instructionSha256`, a `maxOutputTokens`, a `samplingPolicyRef` and a
`retryPolicyRef`. A deterministic validator has none of those, and inventing them to fit the shape
would assert that a model ran when none did — the same fabrication this ADR refuses on the provenance
side. A model-config-shaped object is refused as verifier run evidence, and there is a test for it.

The verdict vocabulary is deliberately not `ACCEPTED`/`REJECTED`. A deterministic verifier does not
judge quality; it reports whether a fixed algorithm was satisfied. Sharing the word would make a
validator run readable as a review.

A `FAILED` run record is constructible on purpose. Refusing to represent one would mean the only run
evidence anybody could produce is a passing one, which is how "we did not run it" and "it passed"
become the same artifact. The gate refuses a failure, visibly, as a finding.

### 6. The acceptance evidence contract was not weakened

`RiyaAiSyntheticTrajectoryAcceptanceEvidenceV1` still binds the trajectory artifact digest, the
conversation fingerprint, the scenario ref and digest, the generation ref, the provenance digest and
the critic verdicts, and the validator still RECOMPUTES the content digests rather than trusting them.

One optional field was added: `deterministicVerifierRun`. Canonical JSON omits an absent optional, so
every evidence record already issued digests to exactly the byte string it digested to before.

Optional in the CONTRACT is not optional in the GATE:

- an external-intake row **must** carry the run — `VERIFIER_RUN_MISSING` otherwise;
- present on either route, it must be truthful — `PASSED`, bound to this trajectory's recomputed
  artifact digest, and not one of the generation roles;
- critic-versus-verifier separation is enforced in the evidence constructor, which is the one artifact
  holding both without a join.

### 7. Critic requirements are NOT weakened, and a fresh critic pass is still required

The external route inherits the critic contract unchanged: `criticConfigRef` is required,
`satisfiedQualityDimensions` is required, the verdict is closed, there is still no rationale and still
no score, and the policy's `requiredQualityDimensions` are enforced in full.

The historical external KEEP/REJECT artifacts do not satisfy this and are **not** grandfathered. A
fresh canonical critic pass over the external candidates, producing verdicts with a real critic config
identity and real satisfied dimensions, remains required before any external row can be accepted.
**AS1-B does not perform that pass** and fabricates no dimension for a historical review.

### 8. Required quality dimensions are unchanged

The enum is `RIYA_DATASET_QUALITY_DIMENSIONS`, reused, not forked. The external route does not get a
shorter list, an optional list or an empty list: an empty `satisfiedQualityDimensions` produces one
`CRITIC_DIMENSION_MISSING` finding per required dimension, and there is a test asserting exactly that.

### 9. Every AS1 invariant is preserved

`TEACHER_GENERATED_SYNTHETIC` stays truthful — an externally produced row is still model-written, so
it is still the teacher source kind, and `HUMAN_AUTHORED_SYNTHETIC` is still never applied to it.
`teacherRef` ↔ `generationRef` still binds. Critic ≠ teacher, verifier ≠ teacher and critic ≠ verifier
all hold on both routes. Canonical scenario and trajectory digests, closed verdicts, the privacy
firewall, authority and citation validation, duplicate and cross-split leakage blocking, and terminal
`QUARANTINED` are untouched — the external validator path is the same `validateRiyaIntelligenceDataset`
call it always was.

### 10. P10 remains deferred, and `trainingApproval` remains `false`

The protected exam reaches no AS1-B contract. Neither new constructor takes a protected index; neither
record has a field one could travel in. RWC-P10 stays exactly what it was on this lane: a
validation-time input to the generic validator, reached through the base release policy, after a
candidate already exists.

Protected-exam exposure for the external candidates is a **later release-gate concern**, not part of
AS1 acceptance, and this ADR does not open it. `trainingApproval` is still the literal `false`, and
nothing here starts a run.

### 11. The 412 existing candidates are preserved byte-for-byte

Nothing in AS1-B reads, copies, rewrites or normalizes an external candidate. The external record
binds the delivered artifacts by digest — candidate, derived trajectory artifact, bundle — and the
validator compares each of those against something the record did not produce: the trajectory and
scenario digests recomputed here, the candidate and bundle digests against the intake reader's
observation. Any edit to the delivered bytes moves an observed digest and the row stops validating. No candidate data is committed by this slice, and no `.artifacts` evidence becomes
tracked.

## What AS1-B deliberately does not do

- No generation, no training, no benchmark, no model selection.
- No provider call of any kind, and no change to AS3 runtime or provider-adapter code.
- No regeneration, mutation or normalization of the 412 external candidates, and **no candidate data
  in this change**.
- No backfilled provenance, no fabricated critic dimension, no fabricated verifier attestation.
- No fresh critic pass and no fresh verifier pass — the contracts exist; running them is later work.
- No migration. Migrations remain `0001`–`0013`; **no `0014`**.
- No managed database change, no deployment, no activation.
- No change to D5, and no change to the blocked D6/D7/D8.
- No QuickFurno or OneDecore change, and no Human Gold revival or relabelling.
- No weakening of any safety, review, leakage, privacy or authority invariant.

## Change-control rule

Owner-locked. Changing any of these requires a new ADR:

- an externally produced row is `EXTERNAL_MANUAL_SYNTHETIC_INTAKE` and is never recorded as an AS2
  in-repo generation;
- the historical `RiyaAiSyntheticGenerationProvenanceV1` field set and its canonical bytes are not
  altered;
- external provenance never claims an AS2 run id, config inventory allocation, planner config or
  simulator config;
- `sourceCandidateSha256` and `sourceBundleSha256` are corroborated against an observed external
  source binding at validation time, and `provenanceSha256` is never presented as proof of them;
- the source-candidate digest convention is the raw UTF-8 bytes of the delivered JSONL record
  excluding its line terminator, and the bundle digest is the delivered bundle file's raw bytes;
- a deterministic verifier is bound by identity AND run evidence, never by a bare ref, and a model
  configuration is never accepted in its place;
- critic ≠ teacher, verifier ≠ teacher and critic ≠ verifier hold on both routes;
- `criticConfigRef` and `satisfiedQualityDimensions` remain required, and the required
  quality-dimension list is not reduced or made optional for the external route;
- the historical external KEEP/REJECT artifacts are not grandfathered into canonical acceptance;
- `QUARANTINED` remains terminal, and no external row is exempt from the leakage, privacy or authority
  gates;
- `trainingApproval` remains `false`, and no artifact on this route auto-triggers training.

## What this unblocks, and what it does not

**Unblocked:** recording truthful provenance for externally generated Riya synthetic candidates, and
recording deterministic verifier runs over them, in a form the AS1 acceptance gate can validate.

**Not unblocked:** intaking the 412 candidates, the fresh critic pass, the fresh verifier pass, corpus
release, benchmarking, training, certification or activation. Each is its own slice with its own
evidence, and none of them starts because this document merged.

## Owner-review correction — 2026-09-05

Owner review of PR #195 (head `7cbbafc9d9760dcb5a78d77ad820a1db02b901f0`, exact-head Linux CI green)
found one contract-level blocker: §3's source digests were claimed to prevent substitution, and the
validator never compared `sourceCandidateSha256` or `sourceBundleSha256` to anything. The finding was
re-proved from the code before any fix — a corpus with a fabricated candidate digest, and one with a
fabricated bundle digest, each produced **zero** findings and `eligible: true`.

§4 above is the correction, and it is a correction to an unmerged design rather than a change to the
owner-locked decision: the modes, the historical-compatibility rule, the critic requirements, the
verifier requirements, the P10 deferral and `trainingApproval: false` are all exactly as accepted. What
changed is that a claim this ADR already made is now enforceable.

## Implementation note — 2026-09-05

Confined to `@qf-jarvis/riya-intelligence-dataset/ai-synthetic` plus one additive error code. The
package root surface is unchanged, the AS2 and AS3A packages are untouched, and the AS2 harness
continues to construct in-repo provenance and acceptance evidence through the same functions with no
edit — the only change on its side of the boundary is that `riyaAiSyntheticProvenanceSha256` now
accepts either mode, which is a widened parameter type over a structural digest and returns the same
bytes for every record it accepted before.

The focused suite `ai-synthetic-external-intake.test.ts` pins the non-regression claims directly: an
AS1 provenance record and an already-serialized AS1 acceptance evidence record are both re-proved to
their exact historical field sets and digests, and a clean in-repo corpus with no verifier run and
**no `sourceBindings` argument at all** still validates with zero findings — that call is byte-for-byte
the call an AS2 caller already makes.

`ValidateRiyaAiSyntheticOptions.sourceBindings` is optional for exactly that reason. Optional in the
type is not optional in the gate: an external row with no binding for its `generationRef` is refused
rather than believed.
