# SDH4 — schema differential result, and the observation schema repair

Working label only; no permanent roadmap number is claimed.

Baseline SDH4 ran on: `b20ccf31a83d3f0075aa00fa86ed516278708517`.

This document records live evidence and the repair it justified. It contains no credential, no prompt
text, no client or vendor content, no provider response body and no schema document — only closed
tokens, counts and HTTP status classes.

---

## 1. RUN SDH4 — `SCHEMA_DIFFERENTIAL_DIAGNOSTIC`

Executed once under owner authorization. Process exit `24`. Credential source: tty. Smoke: PASS
(1 request). Every probe used `max_completion_tokens=512`.

| Probe                         | Derived from                   | Result                               |
| ----------------------------- | ------------------------------ | ------------------------------------ |
| `R0_MINIMAL_CONTROL`          | —                              | HTTP 200                             |
| `R1_NUMERIC_ENUM_AS_NUMBER`   | numeric enum                   | HTTP 200                             |
| `R2_SCALAR_ARRAY`             | scalar array                   | HTTP 200                             |
| `R3_OBJECT_ARRAY`             | object array                   | HTTP 200                             |
| **`R4_ANYOF_ARRAY_ITEMS`**    | **`$.evolution.observations`** | **HTTP 400 `INVALID_REQUEST_ERROR`** |
| `R5_NESTED_OBJECT_GROUP`      | nested object                  | HTTP 200                             |
| `R6_REPLY_GROUP`              | reply group                    | HTTP 200                             |
| **`R7_EVOLUTION_GROUP`**      | evolution group                | **HTTP 400 `INVALID_REQUEST_ERROR`** |
| **`R8_EXACT_PROJECTED_RIYA`** | exact document                 | **HTTP 400 `INVALID_REQUEST_ERROR`** |

Classification: `ISOLATED_SCHEMA_FEATURE_REJECTION`. Inconclusive: none.

### Accounting

| Field                         | Value      |
| ----------------------------- | ---------- |
| `totalProviderRequests`       | 10         |
| `smokeRequests`               | 1          |
| `schemaDiagnosticRequests`    | 9          |
| `successfulProviderResponses` | 7          |
| `providerFailures`            | 3          |
| `inputTokensTotal`            | 1,179,842  |
| `outputTokensTotal`           | 589,982    |
| `estimatedCostUsd`            | 0.26548275 |
| `usageBoundViolated`          | false      |
| `safetyEvaluated`             | false      |
| `reviewBundleWritten`         | false      |

Repository containment held: `main` and `origin/main` remained `b20ccf31…`, divergence `0 0`, only the
two protected untracked names present.

`SDH4_CONSUMED=YES`, `SDH4_RERUN=NO`. SDH1/SDH2/SDH3 remain consumed; `S11_RERUN=NO`.

---

## 2. WHAT THE EVIDENCE ESTABLISHES — AND WHAT IT DOES NOT

**Established.** The real fragment R4 carried — the observations ARRAY whose ITEMS are the projected
SET/CLEAR `anyOf` object union — was rejected by Groq strict structured output at the controlled
512-token cap. R7 and R8 both contain that same area and were rejected too. Everything else the matrix
isolated was accepted.

**NOT established, and explicitly not claimed:**

> "Groq does not support `anyOf`."

That is false and overbroad. S11's D3 probe accepted a nullable `anyOf` scalar union, and the provider
documents `anyOf` as a supported composition. The defensible statement is narrower:

> Groq rejected this specific real `anyOf`-in-array-items SET/CLEAR object-union composition.

No claim is made about other providers or other implementations.

`D5_ROOT_CAUSE` is therefore **narrowed** to this schema representation — not resolved, and not a
statement about model quality. `20B_MODEL_QUALITY_VERDICT` remains `UNRESOLVED`.

---

## 3. THE REPAIR

Representational only, at the model/provider boundary.

**Before** — `evolution.observations: z.array(z.union([SET, CLEAR]))`, projecting to an `anyOf` object
union directly under array `items`.

**After** — a closed container with two separately typed arrays:

```
evolution.observations = { sets: [...], clears: [...] }
```

The containing array is the operation discriminator, so neither item carries an `operation` property:
a member of `sets` is a SET, a member of `clears` is a CLEAR. Both items and the container are closed;
both arrays are required, with an empty array meaning "none this turn".

No `anyOf` under either array's items. No `oneOf`. No JSON Object Mode. No best-effort output. No
optional properties emulating branch absence. No retry. `strict: true` throughout.

### Domain semantics preserved

Every RWC-P4A rule the union expressed structurally is still expressed structurally:

- a SET carries a required value;
- a SET may be `user_stated` or `model_inferred`;
- a CLEAR has **no** `value` property at all, so `.strict()` refuses one — including `value: null`;
- a CLEAR's provenance is the literal `user_stated`: an inference may not withdraw a fact.

`projectStructuredResult` re-projects both arrays into the canonical tagged form and passes the
**combined** list through `createRiyaConversationObservationBatch`, which remains the authority for
field validity, duplicates, bounds and every other invariant. Order is deterministic: sets, then
clears.

### The combined bound

Splitting one bounded array into two creates a gap the schema cannot close — two independent `max(7)`
constraints do not prove a combined `max(7)`, and the documented strict subset offers no supported
cross-sibling total-count constraint. Each array stays individually bounded, and the canonical
constructor re-proves the combined list: its own `max(7)` and its one-observation-per-field check
refuse the **whole** model answer rather than truncating it. Both cases are tested.

---

## 4. OWNER-VISIBLE CONSEQUENCE — THE PROMPT DIGEST MOVED

The system prompt instructed the model to record `"SET"` and `"CLEAR"` — strings the repaired schema
no longer has anywhere. One paragraph was rewritten to name the two arrays instead.

|                 |                                                                    |
| --------------- | ------------------------------------------------------------------ |
| Previous digest | `b8ae461c855358caf9c389bd0b21a44c3f697955f9d9d09fe593f38f362657b8` |
| **New digest**  | `d0c2da57f53c2541274e090b8dec997c885f65f60c6bd8467e98d0be684b71fb` |

Nothing else in the prompt changed: no personality, sales strategy, safety instruction, knowledge
policy or business authority. Every rule the old wording carried is still stated.

**Consequence:** this candidate's prompt identity is no longer byte-identical to the one S11 and SDH4
ran behind. Their evidence remains comparable on the _request contract_; it is not comparable on
_prompt bytes_. This is the single governance lock this PR deliberately breaks, under §15 of the
authorization.

---

## 4A. SECOND OWNER-VISIBLE CONSEQUENCE — THE OPERATIONAL BUDGET MOVED

`RIYA_COMPLETION_BUDGET_TOKENS`: **14,336 → 14,848**.

The budget is derived from the largest document the provider schema accepts, and two review passes
found that measurement was undercounting:

1. it filled only `observations.sets`, leaving `clears` empty, while claiming to be the schema
   maximum — the provider bounds the two arrays independently, so both full is valid and larger;
2. it selected the **first** member of every closed vocabulary rather than the **longest** —
   `user_stated` over `model_inferred`, `INTRO` over a 15-character phase, one of each discovery
   field rather than the longest repeated. The provider arrays carry no uniqueness constraint, so
   repeating `consultationPreference` is schema-valid.

Corrected measurement:

|                                        |                                                                      |
| -------------------------------------- | -------------------------------------------------------------------- |
| `SINGLE_BYTE_MAX_BYTES`                | 28,241 → 28,491 → **28,699**                                         |
| `DERIVED_COMPLETION_BUDGET_TOKENS`     | **14,848** (`ceil(28699/2) = 14,350`, rounded up to 512 granularity) |
| `RIYA_COMPLETION_BUDGET_COVERED_BYTES` | **29,696**                                                           |

The literal was **not** held at 14,336: that value belonged to a measurement that undercounted what
the provider schema actually accepts. Selection is now by serialized length, with a regression test
proving vocabulary ORDER cannot change the maximum again.

This is a **provider-schema** maximum. The canonical constructor would refuse it — 7 sets plus 7
clears exceeds the combined ceiling and repeats every field — and budgeting to the larger provider
bound is the conservative direction.

Historical S11 and SDH4 receipts keep the budgets they were emitted with. 14,848 is the governed
operational budget for post-repair execution only. The three quantities remain distinct: model
capability ceiling **65,536**, operational Riya request budget **14,848**, V0–V4 probe budget **512**.

No tokenizer was introduced; pathological/tokenizer status remains UNRESOLVED.

---

## 5. HISTORICAL MATRIX IMMUTABILITY

SDH4's `R0`-`R8` semantics are frozen. The historical planner was **not** repurposed: it looks for a
fragment that no longer exists and now fails loudly, and that failure is itself a regression proof
that the rejected composition is gone. A spec asserts it throws.

A **new** vocabulary covers verification instead:

| Step                          | Kind             |
| ----------------------------- | ---------------- |
| `V0_MINIMAL_CONTROL`          | CONTROL          |
| `V1_OBSERVATION_SETS_ARRAY`   | REPAIRED_FEATURE |
| `V2_OBSERVATION_CLEARS_ARRAY` | REPAIRED_FEATURE |
| `V3_EVOLUTION_GROUP`          | GROUP            |
| `V4_EXACT_PROJECTED_RIYA`     | EXACT            |

Run goal `POST_SDH4_SCHEMA_REPAIR_VERIFICATION`, exit code **25**, its own ledger counter, its own
classification vocabulary (`CONTROL_INVALID`, `REPAIRED_EXACT_SCHEMA_ACCEPTED_LOW_CAP`,
`REPAIRED_OBSERVATION_SCHEMA_REJECTED`, `REPAIRED_EVOLUTION_COMPOSITION_REJECTED`,
`MIXED_OR_INCONCLUSIVE`).

Bounds: **1 smoke + 5 probes = 6 requests**, USD 1.00, every probe at `max_completion_tokens=512`,
zero retry, zero fallback, zero safety, zero P10, zero bundle writes, no 120B.

Precedence: a failed control stops the matrix; a repaired-feature or group rejection does **not**;
`V4` accepted decides the summary while every wrapper rejection stays in `rejectedStepIds`.

**This verification has since been executed exactly once.** Its result is recorded immutably in
section 7 below; the plan as described above is unchanged by that execution.

---

## 6. CONTAINMENT FOR THE REPAIR PHASE

```
GROQ_CALLS=0
PROVIDER_CALLS=0
CREDENTIAL_READS=0
LIVE_VERIFICATION_EXECUTED=NO
SDH4_RERUN=NO
S11_RERUN=NO
20B_MODEL_QUALITY_VERDICT=UNRESOLVED
D5_ROOT_CAUSE=NARROWED_TO_OBSERVATION_SCHEMA_REPRESENTATION_PENDING_REPAIR_VERIFICATION
```

Reply schema, citations, reply bounds, grounding, `evolution.version`, `questionPlan`,
`skipProjectDetails`, safety fixtures, evaluator thresholds and migrations are all unchanged.

---

## 7. RUN SRV1 — `POST_SDH4_SCHEMA_REPAIR_VERIFICATION` (IMMUTABLE)

Executed **once** under owner authorization. Process exit `25`. Every probe used
`max_completion_tokens=512`, zero retry, zero fallback.

| Probe                         | Kind             | Result                              |
| ----------------------------- | ---------------- | ----------------------------------- |
| `V0_MINIMAL_CONTROL`          | CONTROL          | HTTP 200                            |
| `V1_OBSERVATION_SETS_ARRAY`   | REPAIRED_FEATURE | HTTP 200                            |
| `V2_OBSERVATION_CLEARS_ARRAY` | REPAIRED_FEATURE | HTTP 200                            |
| **`V3_EVOLUTION_GROUP`**      | GROUP            | **HTTP 400 `JSON_VALIDATE_FAILED`** |
| **`V4_EXACT_PROJECTED_RIYA`** | EXACT            | **HTTP 400 `JSON_VALIDATE_FAILED`** |

Classification: `REPAIRED_EVOLUTION_COMPOSITION_REJECTED`. Inconclusive: none.

| Field                       | Value      |
| --------------------------- | ---------- |
| `totalProviderRequests`     | 6          |
| `smokeRequests`             | 1          |
| `schemaRepairProbeRequests` | 5          |
| `estimatedCostUsd`          | 0.14753415 |
| `safetyEvaluated`           | false      |
| `reviewBundleWritten`       | false      |
| safety / P10 / bundle       | none       |

Repository containment held. `SRV1_RERUN=NO`. `20B_MODEL_QUALITY_VERDICT=UNRESOLVED`.

### What SRV1 settled, and what it did not

It settled the repair's own question: both repaired observation arrays are accepted **independently**
at the low control cap. The `anyOf`-under-`array.items` construction SDH4 isolated is gone, and
nothing that replaced it is refused on its own.

It did not settle the document. `V3` and `V4` are still refused — but with a **materially different
provider code** from the pre-repair rejection: `json_validate_failed` rather than a bare
`invalid_request_error`. That is the provider reporting that it validated the submitted schema and
declined it, which is a different fact from the earlier one and is what makes the next axis worth
measuring rather than the same axis worth re-measuring.

---

## 8. WHY OAD1 — THE OPERATIONAL ACCEPTANCE BRIDGE

Every governed matrix so far — S11's D1-D8, SDH4's R0-R8, SRV1's V0-V4 — has held the completion
budget at the low control value of 512. That was the right choice each time: all three were isolating
a **schema**, and varying two axes at once would have isolated neither.

The consequence is that the **operational envelope has never been measured**. Riya's real requests do
not run at 512. They run at `RIYA_COMPLETION_BUDGET_TOKENS`, and they carry the production message
shape rather than a two-line synthetic pair. Neither has ever been on the wire together with the
repaired schema, so no evidence in this document speaks to whether a real Riya turn would be accepted.

Because `JSON_VALIDATE_FAILED` is a materially different provider code from the pre-repair schema
rejection, and because Groq documents strict GPT-OSS structured output as constrained, the next
controlled axis is the **operational completion budget** and the **representative message shape**.

**The 512 cap is NOT claimed to be the cause of the `V3`/`V4` rejections.** It has not been varied, so
nothing here can support that claim. OAD1 exists to vary it. If OAD1 also rejects, the budget is
excluded rather than implicated, and that is an equally useful result.

### The OAD1 matrix

| Probe                                 | Kind                 | Schema                        | Messages                    |
| ------------------------------------- | -------------------- | ----------------------------- | --------------------------- |
| `O0_MINIMAL_CONTROL_OPERATIONAL`      | CONTROL              | minimal closed object         | synthetic tiny              |
| `O1_EVOLUTION_GROUP_OPERATIONAL`      | GROUP                | real `$.evolution`, wrapped   | synthetic tiny              |
| `O2_EXACT_SYNTHETIC_OPERATIONAL`      | EXACT_SYNTHETIC      | exact projected Riya document | synthetic tiny              |
| `O3_EXACT_REPRESENTATIVE_OPERATIONAL` | EXACT_REPRESENTATIVE | **the same object as `O2`**   | **captured representative** |

Run goal `POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC`, exit code **26**, its own ledger counter
(`operationalAcceptanceProbeRequests`), its own classification vocabulary
(`OPERATIONAL_CONTROL_INVALID`, `OPERATIONAL_EXACT_REPRESENTATIVE_ACCEPTED`,
`OPERATIONAL_REPRESENTATIVE_MESSAGE_SHAPE_REJECTED`, `OPERATIONAL_FULL_SCHEMA_REJECTED`,
`OPERATIONAL_EVOLUTION_GROUP_REJECTED`, `MIXED_OR_INCONCLUSIVE`).

Bounds: **1 smoke + 4 probes = 5 requests**, USD 1.00 — narrower than SRV1's six. Every probe runs at
`RIYA_COMPLETION_BUDGET_TOKENS` against the unchanged model capability ceiling of 65,536; zero retry,
zero fallback, zero safety, zero P10, zero bundle writes, no 120B, strict mode preserved.

One capture, one projection per run. `O1`, `O2` and `O3` are all derived from that single projected
object, so `O2` and `O3` share their schema **by construction** rather than by comparison — which is
the whole evidentiary value of the pair. Provider, model, budget, timeout, retry posture, fallback
posture, strict mode and transport are identical between them. If they disagree, the message shape is
the only thing that could have caused it.

Precedence: a failed control invalidates the run; an `O1` or `O2` rejection does **not** stop it,
because `O3` is the probe the run exists to send. An accepted `O3` decides the summary while every
rejection stays visible in `rejectedStepIds`, each with its own preserved provider error code.

**OAD1 has NOT been executed.** It requires separate owner authorization.

### Containment for this phase

```
GROQ_CALLS=0
PROVIDER_CALLS=0
CREDENTIAL_READS=0
LIVE_OAD1_EXECUTED=NO
SRV1_RERUN=NO
SDH4_RERUN=NO
S11_RERUN=NO
20B_MODEL_QUALITY_VERDICT=UNRESOLVED
D5_ROOT_CAUSE=NARROWED_TO_FULL_DOCUMENT_COMPOSITION_PENDING_OPERATIONAL_ACCEPTANCE
```
