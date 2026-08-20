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

The token in the Result column above is the provider error **TYPE**. For completeness, both observed
fields for `R4`, `R7` and `R8` were:

- `providerErrorType=INVALID_REQUEST_ERROR`
- `providerErrorCode=OTHER_OR_ABSENT`

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
classification vocabulary — the closed set is `CONTROL_INVALID`,
`REPAIRED_EXACT_SCHEMA_ACCEPTED_LOW_CAP`, `REPAIRED_OBSERVATION_SCHEMA_REJECTED`,
`REPAIRED_EVOLUTION_GROUP_REJECTED`, `REPAIRED_FULL_SCHEMA_COMPOSITION_REJECTED` and
`MIXED_OR_INCONCLUSIVE`, six members in all.

The run emitted `REPAIRED_EVOLUTION_GROUP_REJECTED`; that immutable result is recorded in section 7
and is unchanged.

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

Classification: `REPAIRED_EVOLUTION_GROUP_REJECTED`. Inconclusive: none.

The token in the Result column above is the provider error **CODE**. Both observed fields for `V3`
and `V4` were:

- `providerErrorType=INVALID_REQUEST_ERROR`
- `providerErrorCode=JSON_VALIDATE_FAILED`

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

It did not settle the document. `V3` and `V4` are still refused.

**The error TYPE did not change; the recognized error CODE did.** SDH4 and SRV1 both reported
`providerErrorType=INVALID_REQUEST_ERROR`. In SDH4 the provider error-code bucket was
`OTHER_OR_ABSENT`; in SRV1 `V3`/`V4` the provider returned the recognized literal code
`json_validate_failed`, mapped to `JSON_VALIDATE_FAILED`.

`JSON_VALIDATE_FAILED` is preserved without interpreting its undocumented internal cause. What is
established is that `HTTP 400 + JSON_VALIDATE_FAILED` can be distinguished from `HTTP 400 +
OTHER_OR_ABSENT`. Nothing more — in particular, no claim is made here about what Groq did internally
to produce it.

That the CODE bucket changed across the repair, while the TYPE stayed constant, is itself the
observation that makes a further axis worth measuring rather than the same axis worth re-measuring.

---

## 8. WHY OAD1 — THE OPERATIONAL ACCEPTANCE BRIDGE

Every governed matrix so far — S11's D1-D8, SDH4's R0-R8, SRV1's V0-V4 — has held the completion
budget at the low control value of 512. That was the right choice each time: all three were isolating
a **schema**, and varying two axes at once would have isolated neither.

The consequence is that the **operational envelope has never been measured**. Riya's real requests do
not run at 512. They run at `RIYA_COMPLETION_BUDGET_TOKENS`, and they carry the production message
shape rather than a two-line synthetic pair. Neither has ever been on the wire together with the
repaired schema, so no evidence in this document speaks to whether a real Riya turn would be accepted.

Because the recognized provider error CODE moved from `OTHER_OR_ABSENT` to `JSON_VALIDATE_FAILED`
across the repair — at an unchanged `providerErrorType=INVALID_REQUEST_ERROR` — and because Groq
documents strict GPT-OSS structured output as constrained, the next axis worth varying is the
**operational completion budget** and the **representative message shape**.

**The 512 cap is NOT claimed to be the cause of the `V3`/`V4` rejections.** It has not been varied, so
nothing here can support that claim. OAD1 exists to vary it.

If the rejection is reproduced at 14,848, then raising the cap from 512 to the governed operational
budget did not produce a healthy acceptance in that run; the 512 cap is not supported as a sufficient
or sole explanation. That is a bounded and useful result, and it is **not** the same as excluding the
budget as a factor.

If `O1` or `O2` is instead accepted at 14,848 after SRV1 rejected at 512, the finding is that **the
prior low-cap rejection was not reproduced at the operational budget** — not that the budget caused or
fixed anything.

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
`OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED`, `OPERATIONAL_FULL_SCHEMA_REJECTED`,
`OPERATIONAL_EVOLUTION_GROUP_REJECTED`, `MIXED_OR_INCONCLUSIVE`).

### What each outcome may be read as

| Outcome                                                        | Bounded reading                                                                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPERATIONAL_EXACT_REPRESENTATIVE_ACCEPTED`                    | The representative operational request contract was accepted **once**. Sufficient to move to bounded safety replication. **Not** a quality verdict.                                               |
| `OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED` | The representative request was rejected after the synthetic exact request was accepted, in this run. Message shape is a plausible differentiator; run-to-run and model variability is unexcluded. |
| `OPERATIONAL_FULL_SCHEMA_REJECTED`                             | The evolution group was taken and the full document was not, in this run.                                                                                                                         |
| `OPERATIONAL_EVOLUTION_GROUP_REJECTED`                         | The evolution/full rejection is reproduced at the operational budget in this run. The budget is **not** excluded.                                                                                 |
| `OPERATIONAL_CONTROL_INVALID`                                  | The envelope itself was refused, so nothing after it is interpretable.                                                                                                                            |
| `MIXED_OR_INCONCLUSIVE`                                        | The matrix did not settle completely.                                                                                                                                                             |

Bounds: **1 smoke + 4 probes = 5 requests**, USD 1.00 — narrower than SRV1's six. Every probe runs at
`RIYA_COMPLETION_BUDGET_TOKENS` against the unchanged model capability ceiling of 65,536; zero retry,
zero fallback, zero safety, zero P10, zero bundle writes, no 120B, strict mode preserved.

One capture, one projection per run. `O1`, `O2` and `O3` are all derived from that single projected
object, so `O2` and `O3` share their schema **by construction** rather than by comparison. Provider,
model, budget, timeout, retry posture, fallback posture, strict mode and transport are identical
between them.

**The pair is descriptive, not causal.** The production Groq request body carries no `temperature`,
no `top_p` and no `seed`, and Groq documents temperature as defaulting to 1, so `O2` and `O3` are two
independent generation draws however carefully their authored fields are matched. A disagreement
between them says _the representative request was refused in the same run the synthetic one was
taken_. The message shape is a plausible differentiator; run-to-run and model variability is
**unexcluded**.

Controlling that draw is deliberately not the fix. Adding a diagnostic-only `temperature`, `seed` or
retry would make the harness deterministic while making it measure a request posture production does
not send.

Precedence: a failed control invalidates the run; an `O1` or `O2` rejection does **not** stop it,
because `O3` is the probe the run exists to send. An accepted `O3` decides the summary while every
rejection stays visible in `rejectedStepIds`, each with its own preserved literal provider error code.

No repeated live probes are added. A rerun to average out the generation draw would cost further live
authorizations for a result this phase has not been granted the budget to establish.

**OAD1 and OAD2 have since been executed, once each.** Their results are recorded immutably in
sections 9 and 10 below. The plan as described above is unchanged by those executions, except that the
operational budget it inherits moved 14,848 -> 4,096 for the reason section 11 gives.

### Containment for this phase — HISTORICAL SNAPSHOT

> **Historical snapshot at the end of the pre-OAD phase.** The values below were correct when this
> section was written and are kept unchanged. The status line here is **superseded by section 11**,
> which is the current source: `REQUEST_CONTRACT_STATUS=UNRESOLVED_PENDING_OAD3`.

```
GROQ_CALLS=0
PROVIDER_CALLS=0
CREDENTIAL_READS=0
LIVE_OAD1_EXECUTED=NO
SRV1_RERUN=NO
SDH4_RERUN=NO
S11_RERUN=NO
20B_MODEL_QUALITY_VERDICT=UNRESOLVED
REQUEST_CONTRACT_STATUS=UNRESOLVED_PENDING_OPERATIONAL_ACCEPTANCE
```

---

## 9. RUN OAD1 — CREDENTIAL INGRESS FAILURE (IMMUTABLE)

The authorized process launched exactly once. TTY credential ingress returned **rejected-empty** at
the smoke prompt.

| Fact                | Value                                         |
| ------------------- | --------------------------------------------- |
| Run goal            | `POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC` |
| Credential ingress  | tty                                           |
| Smoke credential    | rejected-empty                                |
| Request constructed | absent                                        |
| Provider invoke     | absent                                        |
| Network fetch       | absent                                        |
| Exit                | `12`                                          |

No request was constructed, invoked or fetched. There is **no provider or network evidence of any
kind** from this run.

```
OAD1_CONSUMED=YES
OAD1_RERUN=NO
OAD1_DIAGNOSTIC_RESULT=NO_EVIDENCE
```

---

## 10. RUN OAD2 — `POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC` (IMMUTABLE)

Executed **once** under owner authorization on certified main
`bcf2fcaf102479382898a0a76c8a18cf31da6650`. Preflight PASS. Smoke PASS.

| Probe                                 | Budget                  | Messages         | Result                               |
| ------------------------------------- | ----------------------- | ---------------- | ------------------------------------ |
| **`O0_MINIMAL_CONTROL_OPERATIONAL`**  | `14848` (`OPERATIONAL`) | `SYNTHETIC_TINY` | **HTTP 413 `PAYLOAD_TOO_LARGE_413`** |
| `O1_EVOLUTION_GROUP_OPERATIONAL`      | —                       | —                | not run (stop rule)                  |
| `O2_EXACT_SYNTHETIC_OPERATIONAL`      | —                       | —                | not run (stop rule)                  |
| `O3_EXACT_REPRESENTATIVE_OPERATIONAL` | —                       | —                | not run (stop rule)                  |

O0 observed fields:

- `providerTransportStarted=true`
- `providerHttpStatus=413`
- `providerHttpClass=PAYLOAD_TOO_LARGE_413`
- `providerErrorType=OTHER_OR_ABSENT`
- `providerErrorCode=OTHER_OR_ABSENT`
- `providerCompleted=false`

Classification: **`OPERATIONAL_CONTROL_INVALID`**. The stop rule correctly prevented O1-O3.

| Field                                | Value      |
| ------------------------------------ | ---------- |
| `totalProviderRequests`              | 2          |
| `smokeRequests`                      | 1          |
| `operationalAcceptanceProbeRequests` | 1          |
| `safetyProviderRequests`             | 0          |
| `p10ProviderRequests`                | 0          |
| `successfulProviderResponses`        | 1          |
| `providerFailures`                   | 1          |
| `estimatedCostUsd`                   | 0.02956815 |
| `usageBoundViolated`                 | false      |
| `safetyEvaluated`                    | false      |
| `reviewBundleWritten`                | false      |

Exit `26`. Repository containment held: `main` and `origin/main` remained
`bcf2fcaf102479382898a0a76c8a18cf31da6650`, divergence `0 0`, only the protected untracked pathnames
present.

```
OAD2_CONSUMED=YES
OAD2_RERUN=NO
```

### What OAD2 proves — and what it does not

The failure occurred on `O0_MINIMAL_CONTROL_OPERATIONAL`. That probe carries the known-good minimal
strict control schema, not Riya's. **The repaired Riya schema did not participate in this failure and
never reached the wire.**

OAD2 establishes exactly one thing:

> The current candidate request path rejected the known-good minimal strict control at
> `max_completion_tokens=14,848` with HTTP 413.

It is consistent with the historical S11 evidence, which varied the same axis against the same
minimal control:

| S11 canary          | Budget       | Result   |
| ------------------- | ------------ | -------- |
| `D1` STRICT_MINIMAL | `LOW_512`    | HTTP 200 |
| `D2` STRICT_MINIMAL | `HIGH_65536` | HTTP 413 |

It does **not** establish a universal Groq output-token limit. Groq currently advertises GPT-OSS-20B
with a 131,072-token context window and 65,536 max output tokens. The constrained quantity is the
**application request budget on this candidate path**, not the model capability constant.

Accordingly: the Riya schema is unchanged, the observation repair is not implicated, safety is not
authorized, model quality is not interpreted, O1-O3 are not run under the failed envelope, and OAD2 is
not rerun.

---

## 11. THE OPERATIONAL BUDGET IS DECOUPLED FROM SCHEMA SIZING

### The policy defect

`packages/riya-model-interaction/src/internal/output-budget.ts` derived the governed operational
completion budget from the largest document the schema would accept:

```
maxRiyaStructuredOutputBytesSingleByte()  /  ASSUMED_BYTES_PER_TOKEN  , rounded up to 512
=> RIYA_COMPLETION_BUDGET_TOKENS = 14,848
```

The module already admitted the bytes-per-token value is an operational assumption rather than a
tokenizer result, that the largest schema-legal document is not the typical output, and that the
token cost was never measured. OAD2 supplied the missing live fact: **14,848 is not an accepted
operational request envelope on this path, even for the minimal control.**

Sizing a request envelope to a validator's tolerance was the design error.

### The repair

| Constant                          | Before           | After                              |
| --------------------------------- | ---------------- | ---------------------------------- |
| `RIYA_COMPLETION_BUDGET_TOKENS`   | 14,848 (derived) | **4,096 (owner-selected literal)** |
| `CANDIDATE_MAX_COMPLETION_TOKENS` | 65,536           | 65,536 (unchanged)                 |

4,096 is an **owner-selected operational launch budget**. It is not a tokenizer theorem, not the
schema maximum, not the model maximum, not a new model capability, and not a guarantee that every
schema-valid document fits.

The product path is a concise WhatsApp sales agent, not a document generator. The schema's ceilings —
a 2,500-character reply body, 64 citations, seven SET and seven CLEAR observations with 2,048
character values — are **validation** bounds, not a target response size.

It is not claimed to be globally optimal. Later quality or load evidence may justify moving it in
either direction, and the next separately-authorized acceptance run tests this exact production budget
empirically before safety.

### What is preserved

The maximum-document measurement helpers are kept and reclassified as **DIAGNOSTIC / CAPACITY
ANALYSIS**: `RIYA_FREE_TEXT_FILLS`, `riyaStructuredOutputAtFill`, `maxRiyaStructuredOutputBytesAtFill`,
`maxRiyaStructuredOutputBytesSingleByte`, `maxRiyaStructuredOutputBytesAnyFill`,
`ASSUMED_BYTES_PER_TOKEN` and `deriveSingleByteRiyaCompletionBudgetTokens`. Their measured values are
unchanged. They no longer define the request budget.

The invariant `RIYA_COMPLETION_BUDGET_TOKENS === deriveSingleByteRiyaCompletionBudgetTokens()` is
removed and replaced by explicit ones: the budget is exactly 4,096, it is a numeric literal rather
than a computation, and it is not equal to the derivation. A regression guard reads the declaration
and fails if the two are ever reconnected.

### One consequence worth stating plainly

Under `ASSUMED_BYTES_PER_TOKEN`, 4,096 tokens corresponds to **8,192 serialized bytes** — which is
**below** every schema maximum measured in that module, the single-byte one at 28,699 bytes included.
A maximal 2,500-unit reply body in a three-byte script is 7,500 bytes of that on its own.

That is the decoupling working as intended, not an oversight. 4,096 does not guarantee every
schema-valid document can be completed.

The required invariant is **fail-closed**, and only that: if the budget is insufficient for a valid
structured answer, the provider/gateway path must fail closed, and no incomplete, malformed or
schema-invalid partial result may be accepted as a valid Riya answer.

Which mechanism produces that failure is **not** asserted. The provider may refuse the request or the
completion, return an incomplete result, return content the gateway cannot parse or validate, or fail
in some other way before a valid structured result exists. No claim is made that truncation must
occur, that the gateway must be the component that refuses, or that Groq must return any particular
status or error code.

Whether real Riya turns approach that limit is an empirical question for the next acceptance run, not
one this document can settle.

### Unchanged by this repair

The Riya structured schema, the observation split, `MAX_RIYA_REPLY_BODY_CHARS`, `MAX_CITATIONS`,
`MAX_OBSERVATION_VALUE_CHARS`, the observation array bounds, `questionFields`, the reply schema, the
evolution schema, the provider projection, the prompt bytes and digest, canonical observation
validation, the candidate model, the provider, sampling posture, reasoning posture, retry, fallback,
safety and P10.

The merged `POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC` run goal is unchanged and inherits the
repaired constant automatically; no new run goal is created. Its stop and classification semantics are
untouched, and no historical receipt is rewritten.

### Containment for this phase — SNAPSHOT AT THE POST-OAD2 REPAIR

```
GROQ_CALLS=0
PROVIDER_CALLS=0
CREDENTIAL_READS=0
LIVE_OAD3_EXECUTED=NO
OAD2_RERUN=NO
OAD1_RERUN=NO
SRV1_RERUN=NO
SDH4_RERUN=NO
S11_RERUN=NO
20B_MODEL_QUALITY_VERDICT=UNRESOLVED
REQUEST_CONTRACT_STATUS=UNRESOLVED_PENDING_OAD3
```

> Superseded by section 13. OAD3 has since run; the current status is
> `REQUEST_CONTRACT_STATUS=UNRESOLVED_PENDING_REPRESENTATIVE_ACCEPTANCE`. The values above are kept
> unchanged as the record of this phase.

**Bounded conclusion.** OAD2 rejected the 14,848-token operational envelope at the minimal control
before the repaired Riya schema participated. The schema remains untested at the operational budget.
The governed launch budget is therefore decoupled from maximum-schema sizing and lowered to 4,096 for
the next separately authorized acceptance run.

---

## 12. RUN OAD3 — `POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC` (IMMUTABLE)

Executed **once** under owner authorization on certified main
`d69e4399e424910d86e85c6632d077736b2d8060`. Preflight PASS. Smoke PASS. Operational budget **4,096**;
model capability ceiling **65,536**.

| Probe                                 | Budget | Messages                  | Status  | Class              | Completed |
| ------------------------------------- | ------ | ------------------------- | ------- | ------------------ | --------- |
| `O0_MINIMAL_CONTROL_OPERATIONAL`      | 4096   | `SYNTHETIC_TINY`          | **200** | `SUCCESS_2XX`      | true      |
| `O1_EVOLUTION_GROUP_OPERATIONAL`      | 4096   | `SYNTHETIC_TINY`          | **429** | `RATE_LIMITED_429` | false     |
| `O2_EXACT_SYNTHETIC_OPERATIONAL`      | 4096   | `SYNTHETIC_TINY`          | **200** | `SUCCESS_2XX`      | true      |
| `O3_EXACT_REPRESENTATIVE_OPERATIONAL` | 4096   | `CAPTURED_REPRESENTATIVE` | **429** | `RATE_LIMITED_429` | false     |

`O0` and `O2` carried `providerErrorType=NONE`, `providerErrorCode=NONE`. `O1` and `O3` carried
`providerErrorType=OTHER_OR_ABSENT`, `providerErrorCode=OTHER_OR_ABSENT`.

**Classifier emitted by the merged harness, recorded verbatim and never rewritten:**

```
OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED
acceptedStepIds = O0_MINIMAL_CONTROL_OPERATIONAL + O2_EXACT_SYNTHETIC_OPERATIONAL
rejectedStepIds = O1_EVOLUTION_GROUP_OPERATIONAL + O3_EXACT_REPRESENTATIVE_OPERATIONAL
```

| Field                                | Value      |
| ------------------------------------ | ---------- |
| `totalProviderRequests`              | 5          |
| `smokeRequests`                      | 1          |
| `operationalAcceptanceProbeRequests` | 4          |
| `safetyProviderRequests`             | 0          |
| `p10ProviderRequests`                | 0          |
| `successfulProviderResponses`        | 3          |
| `providerFailures`                   | 2          |
| `inputTokensTotal`                   | 524,482    |
| `outputTokensTotal`                  | 262,245    |
| `estimatedCostUsd`                   | 0.11800965 |
| `costIsEstimated`                    | true       |
| `usageBoundViolated`                 | false      |
| `safetyEvaluated`                    | false      |
| `reviewBundleWritten`                | false      |

Final: `POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC_COMPLETE`, exit `26`.

Repository containment held: `main` and `origin/main` remained
`d69e4399e424910d86e85c6632d077736b2d8060`, divergence `0 0`, only the protected untracked pathnames
present.

```
OAD3_CONSUMED=YES
OAD3_RERUN=NO
```

---

## 13. OWNER INTERPRETATION OF OAD3 — SEPARATE FROM THE EMITTED RECORD

The section above is the receipt. This section is the reading of it, and the two are deliberately kept
apart.

**Emitted classifier:** `OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED`

**Owner interpretation:** `REPRESENTATIVE_ACCEPTANCE_UNRESOLVED_RATE_LIMIT_INTERRUPTED`

The emitted token must **not** be read as evidence that the representative messages caused a
request-contract rejection.

The harness of the day grouped every non-2xx response that carried a status into one rejection bucket.
`O3` returned **HTTP 429** with `providerCompleted=false`. A 429 means the provider **declined to
process** because a rate limit was reached — it is not a verdict on the schema, the messages or the
budget. `O1` received the same 429 in the same run, while `O2` had already shown that the exact full
current Riya schema at 4,096 can receive HTTP 200.

So the token names a message-shape sequence on evidence that cannot support one.

```
OAD3_OPERATIONAL_BUDGET_CONTROL=ACCEPTED
OAD3_EXACT_SYNTHETIC_SCHEMA=ACCEPTED
OAD3_REPRESENTATIVE_ACCEPTANCE=UNRESOLVED_RATE_LIMIT_INTERRUPTED
```

No claim is made that the representative messages were rejected semantically, that the Riya schema
failed, that 4,096 failed, that model quality failed, that safety failed, or that any particular Groq
quota produced the 429. The exact rate-limit dimension is not known from this receipt.

### What OAD3 positively PROVED

**A. The 4,096 operational envelope is accepted.** OAD2 sent the minimal strict control at 14,848 and
received HTTP 413; OAD3 sent the same control at 4,096 and received HTTP 200. The current candidate
path accepts the minimal strict control at the repaired application budget. This does not make 4,096
universally optimal.

**B. The exact production Riya schema is accepted at 4,096 with synthetic messages.** `O2` sent the
exact current projected production schema at 4,096 and received HTTP 200 with
`providerCompleted=true`. That closes the schema-composition uncertainty for that tested request — the
observation split, the schema composition, the 4,096 budget, the prompt digest and the provider/model
are not to be reopened without new contradictory evidence.

**C. Representative acceptance is the only remaining request-contract gap** before safety.

### Current status

```
REQUEST_CONTRACT_STATUS=UNRESOLVED_PENDING_REPRESENTATIVE_ACCEPTANCE
20B_MODEL_QUALITY_VERDICT=UNRESOLVED
SAFETY_AUTHORIZED=NO
```

This supersedes the section 11 status line, which remains as its own labelled snapshot.

---

## 14. THE ANALYSIS REPAIR AND THE REPRESENTATIVE-ONLY GATE

### Future analysis distinguishes infrastructure from a verdict

The OAD matrix classifier counted every non-2xx response carrying a status as rejection evidence. That
is adequate for "did the provider take this" and wrong for "is this request contract valid", because
the two differ exactly where the provider never got as far as judging the request.

A new module assigns a reviewed role to **every** governed transport class, in a map that is total by
type — a class added to the vocabulary does not compile until somebody decides its role, so nothing
can inherit a role by falling through.

Contract-rejection evidence is an explicit **allowlist of three**:

| Class                   | Why it is contract evidence                                       |
| ----------------------- | ----------------------------------------------------------------- |
| `BAD_REQUEST_400`       | the provider validated the request and refused it                 |
| `PAYLOAD_TOO_LARGE_413` | the envelope was refused as too large — how OAD2 read its own 413 |
| `UNPROCESSABLE_422`     | the provider reports the request as unprocessable                 |

For all three the literal error type and code travel onward **uninterpreted**: a 400 says a refusal
happened, not which part of the request caused it.

Everything else establishes **nothing** about the request contract: `UNAUTHORIZED_401`,
`FORBIDDEN_403`, `NOT_FOUND_404`, `RATE_LIMITED_429`, `CAPACITY_498`, `CANCELLED_499`, `SERVER_5XX`,
`TRANSPORT_THROW`, `NOT_REACHED`, `NONE` and `OTHER_HTTP`.

That list matters as much as the allowlist. A first attempt at this repair excluded the infrastructure
classes and treated the leftovers as rejections, which quietly swept in 401, 403, 404 and
`OTHER_HTTP` — so a mistyped **second** candidate credential, entered after smoke had already passed
on the first, would have been filed as evidence about Riya's schema. The safest default for any future
or unknown class is inconclusive, never rejection.

The precedence and the token list are unchanged; only which evidence reaches which token moved. A
future matrix identical to OAD3's would now read **`MIXED_OR_INCONCLUSIVE`**, and a spec replays
OAD3's exact rows to prove it. No new token was introduced.

**The historical OAD3 receipt in section 12 is not rewritten.** It records what the harness emitted.

### The representative-only gate

A new run goal, `POST_OAD3_REPRESENTATIVE_ACCEPTANCE` (future live label **RA1**), exit code **27**,
answers only the unresolved question.

| Bound                                           | Value                     |
| ----------------------------------------------- | ------------------------- |
| Maximum provider requests                       | **2** (1 smoke + 1 probe) |
| Maximum spend                                   | USD 1.00                  |
| Wire completion budget                          | 4,096                     |
| Model capability ceiling                        | 65,536                    |
| Retry / fallback / safety / P10 / 120B / bundle | 0                         |

It does **not** repeat `O0`, `O1` or `O2` — those already produced the evidence this phase needs. It
reuses OAD3's own plan, capture and projection and SELECTS
`O3_EXACT_REPRESENTATIVE_OPERATIONAL` out of them, rather than rebuilding an equivalent probe, so what
goes on the wire is the same object OAD3 sent.

Its vocabulary is five tokens, and the split between them is the OAD3 lesson:

| Outcome                            | Meaning                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `REPRESENTATIVE_ACCEPTED`          | HTTP 2xx and completed. The contract was accepted **once**. Sufficient to move to bounded safety replication; **not** a quality verdict. |
| `REPRESENTATIVE_PROVIDER_REJECTED` | The provider judged the request and refused it on contract grounds — 400, 413 or 422 only. Literal codes preserved, uninterpreted.       |
| `REPRESENTATIVE_RATE_LIMITED`      | HTTP 429. The provider declined to process. **Not a verdict.**                                                                           |
| `REPRESENTATIVE_INFRA_INTERRUPTED` | The request failed to EXECUTE: transport, capacity, cancellation, 5xx.                                                                   |
| `REPRESENTATIVE_INCONCLUSIVE`      | Did not run, or a credential / permission / configuration / ungoverned class — 401, 403, 404, `OTHER_HTTP`.                              |

### Pacing is operational, not code

RA1 remains **one attempt**. No retry is added to production or to the diagnostic, and no cooldown is
compiled into the runtime. The owner authorization for RA1 controls pacing operationally: no other
Groq staging calls for at least 90 seconds before launch, and at least 90 seconds after smoke PASS
before the second hidden credential is entered.

No rate-limit header plumbing is added. If RA1 is rate-limited again after a clean cooldown, that
becomes the next question.

### Containment for this phase

```
GROQ_CALLS=0
PROVIDER_CALLS=0
CREDENTIAL_READS=0
LIVE_RA1_EXECUTED=NO
LIVE_RA1_AUTHORIZED=NO
OAD3_RERUN=NO
OAD2_RERUN=NO
OAD1_RERUN=NO
SRV1_RERUN=NO
SDH4_RERUN=NO
S11_RERUN=NO
REQUEST_CONTRACT_STATUS=UNRESOLVED_PENDING_REPRESENTATIVE_ACCEPTANCE
20B_MODEL_QUALITY_VERDICT=UNRESOLVED
SAFETY_AUTHORIZED=NO
```
