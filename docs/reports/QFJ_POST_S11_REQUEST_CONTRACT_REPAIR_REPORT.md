# POST-S11 REQUEST-CONTRACT REPAIR — evidence record

Working label only. This phase deliberately does **not** claim a permanent `HF4-R9` number: no
governing document in this repository defines a roadmap slot for it, and the `MVP-P2A.2 HF4-R<n>`
sequence is a pull-request convention rather than a governed register. An owner may assign a
permanent number when merging.

Baseline: `main = 82dbd805a7ac80e86a0ca9c937b01935c771e970`.

This document records live-run evidence and operator history. It contains no credential, no prompt
text, no client or vendor content, no provider response body and no schema document — only closed
tokens, counts and HTTP status classes.

---

## 1. RUN S11 — `REQUEST_CONTRACT_DIAGNOSTIC`

Executed once under owner authorization. Process exit `23`
(`REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE`).

| Phase              | Result                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight          | PASS                                                                                                                                                              |
| Smoke              | PASS                                                                                                                                                              |
| Credential ingress | clipboard source, exactly one clipboard read, exactly one credential resolution, clipboard cleared by the harness, credential reused in memory, no second ingress |

### Provider request accounting

| Field                         | Value                  |
| ----------------------------- | ---------------------- |
| `totalProviderRequests`       | 9                      |
| `smokeRequests`               | 1                      |
| `diagnosticProviderRequests`  | 8                      |
| `safetyProviderRequests`      | 0                      |
| `p10ProviderRequests`         | 0                      |
| `successfulProviderResponses` | 4                      |
| `providerFailures`            | 5                      |
| `reviewBundleWritten`         | false                  |
| retry / fallback / 120B       | none / none / not used |

### The D1–D8 matrix

| Canary | Request class               | Completion cap | Result                           |
| ------ | --------------------------- | -------------- | -------------------------------- |
| D1     | `STRICT_MINIMAL`            | `LOW_512`      | HTTP 200                         |
| D2     | `STRICT_MINIMAL`            | `HIGH_65536`   | HTTP 413                         |
| D3     | `STRICT_ANYOF_NULLABLE`     | `LOW_512`      | HTTP 200                         |
| D4     | `STRICT_NUMERIC_ENUM`       | `LOW_512`      | HTTP 200                         |
| D5     | `STRICT_REAL_RIYA_SCHEMA`   | `LOW_512`      | HTTP 400 `INVALID_REQUEST_ERROR` |
| D6     | `STRICT_REAL_RIYA_SCHEMA`   | `HIGH_65536`   | HTTP 400 `INVALID_REQUEST_ERROR` |
| D7     | `EXACT_REPRESENTATIVE_RIYA` | `LOW_512`      | HTTP 400 `INVALID_REQUEST_ERROR` |
| D8     | `EXACT_REPRESENTATIVE_RIYA` | `HIGH_65536`   | HTTP 400 `INVALID_REQUEST_ERROR` |

Harness classification as emitted: `HIGH_COMPLETION_CAP_SENSITIVE`.

---

## 2. THE OWNER INTERPRETATION — two findings, not one

The emitted single-cause classification is **incomplete**, and the reasons are preserved here because
the classification itself has since been repaired.

### Finding A — completion-cap sensitivity exists

D1 and D2 carry the same minimal strict schema and the same tiny synthetic messages and differ only
in `max_completion_tokens`. D1 at 512 was accepted; D2 at 65,536 was rejected with HTTP 413.

The exact request path is therefore sensitive to the production high completion cap.

This is **not** the finding "Groq never supports 65,536 output tokens". The provider documents a
model-level 65,536 output maximum and nothing here contradicts it. What S11 establishes is narrower:
the candidate request path cannot safely assume the model-level ceiling belongs on every invocation.

### Finding B — the real Riya schema is rejected independently, at the low cap

D5 carries the real projected Riya structured schema with tiny synthetic messages at only 512
completion tokens — the smallest request the real schema can appear in — and was rejected with HTTP 400.

The high completion cap therefore cannot explain the whole failure. A second, independent
incompatibility exists in the real projected schema or request contract.

D3 proves the tested `anyOf`/nullable form is accepted. D4 proves the tested numeric singleton enum
is accepted. **Neither construct may be blamed without new evidence.**

D7 cannot independently implicate the production _messages_, because D7 still carries the
already-rejected real Riya schema.

### Consequence

`20B_MODEL_QUALITY_VERDICT = UNRESOLVED`. No safety-quality conclusion may be drawn from S11.

---

## 3. CLASSIFIER PRECEDENCE DEFECT — found and repaired

The classifier reduced the S11 matrix to `HIGH_COMPLETION_CAP_SENSITIVE`, masking Finding B.

**Cause.** The shape rules — `ANYOF_NULLABLE_REJECTED`, `NUMERIC_ENUM_REJECTED`,
`REAL_RIYA_SCHEMA_REJECTED` — each required D2 to have been _accepted_, on the reasoning that "behind
a cap that already fails, a shape failing says nothing about the shape".

The reasoning is sound but it named the wrong control. **D2 is the HIGH-cap canary. D3, D4, D5 and D7
all run at `LOW_512`**, so D2's fate at 65,536 cannot explain any of them; the canary that shares
their completion cap is D1, and D1 passed. Gating low-cap shape rules on a high-cap result let any
high-cap sensitivity silently suppress every low-cap shape finding.

**Repair.** Every low-cap shape rule now gates on its own cap's control (D1, and for the message rule
D5). The cap axis is read from the governed `CANARY_CAP_PAIRS` table rather than a hand-picked
subset. No new public classification token was created — the existing closed taxonomy represents the
evidence correctly.

**Result for the exact S11 matrix:** `MIXED_OR_INCONCLUSIVE`, with both findings reported:
`HIGH_COMPLETION_CAP_SENSITIVE+REAL_RIYA_SCHEMA_REJECTED`.

A regression test pins the exact S11 rows so precedence masking cannot return.

---

## 4. AUDIT HISTORY — the accidental extra `SAFETY_REPLICATION`

Before the authorized S11 diagnostic, an **additional `SAFETY_REPLICATION` process was accidentally
executed** on the R8 baseline. It is recorded here as operator history and nothing else.

Observed:

- smoke PASS
- 10 safety provider requests
- one expected cancellation
- nine unexpected ordinary `MODEL_REQUIRED` gateway HTTP 400 failures
- zero usable gateway responses
- execution health `INVALID`
- process exit `14`

This run is **not** a valid model-quality verdict and produces none. It is **not** the official S10
run — historical S9 and S10 both predate the R8 baseline — and it **must never be rerun**.

---

## 5. OFFLINE SCHEMA AUDIT RESULT

The exact document D5 put on the wire was captured through the production path and audited
recursively against every rule of the documented strict subset that is checkable without a provider.

**Result: zero offline-checkable violations.**

- every object closed with `additionalProperties: false`
- every declared property present in its object's `required`
- no `required` entry naming an undeclared property
- every array carries an `items` schema
- every `anyOf` has ≥2 well-formed branches
- every enum is single-kind and non-empty
- no `$ref` or `$defs` survived projection
- no `oneOf` / `allOf` / `not`
- no keyword outside `{type, properties, required, additionalProperties, items, anyOf, enum}`
- root is an object

Measured structure: 7 objects, 3 arrays, 2 `anyOf`, 10 enums (1 numeric, 9 string), 21 properties,
maximum nesting depth 6.

**Therefore the D5 root cause is NOT proven offline.** Guessing a keyword and changing production is
exactly the move this evidence forbids, so the deliverable is the differential ladder in §6 instead.

### What S11 never tested

Comparing the real document against the canaries that passed:

| Dimension                            | Present in real schema | Tested by any passing canary                    |
| ------------------------------------ | ---------------------- | ----------------------------------------------- |
| Arrays of any kind                   | yes (3)                | **no**                                          |
| `anyOf` in **array items** position  | yes                    | no — D3 tested `anyOf` in a _property_ position |
| Nesting beyond 2 levels              | yes (depth 6)          | **no** — D1/D3/D4 are depth 2                   |
| Numeric enum rendered `type: number` | yes                    | no — D4 sent `type: integer`                    |

Any of these four is a candidate cause.

---

## 6. NEXT BOUNDED DIFFERENTIAL MATRIX

A deterministic reduction ladder is implemented offline. Every rung wraps a **real fragment located
inside the real projected schema** — never a replica — and consecutive rungs differ by one dimension.

| Step                        | Adds                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `R0_MINIMAL_CONTROL`        | closed object + string enum (the D1 shape; a rejection here means the account or envelope changed) |
| `R1_NUMERIC_ENUM_AS_NUMBER` | numeric enum as `type: number` (D4 sent `integer`)                                                 |
| `R2_SCALAR_ARRAY`           | an array of scalars                                                                                |
| `R3_OBJECT_ARRAY`           | an array of closed objects                                                                         |
| `R4_ANYOF_ARRAY_ITEMS`      | `anyOf` in array-items position                                                                    |
| `R5_NESTED_OBJECT_GROUP`    | a nested object group                                                                              |
| `R6_REPLY_GROUP`            | the whole first top-level group                                                                    |
| `R7_EVOLUTION_GROUP`        | the whole second top-level group                                                                   |
| `R8_EXACT_PROJECTED_RIYA`   | the exact document D5 sent                                                                         |

Nine rungs — the same order of magnitude as the eight-canary matrix S11 was authorized for. The first
rejection names the dimension.

**This ladder has NOT been executed. It requires separate owner authorization.**

---

## 6A. COMPLETION BUDGET — what it is, and what it is not

`ProviderInvocationInput` carried no per-request completion bound, so `GroqModelProvider` sent its
configured **model capability ceiling** on every invocation. The two numbers now travel separately:
an optional `completionBudget` on the request, forwarded only when present, and clamped by the
provider with `Math.min` against its ceiling — so an application budget can narrow a capability and
can never widen one.

The model ceiling is **not** lowered: 65,536 output / 131,072 input are unchanged. 65,536 was not
globally replaced with 512.

### `RIYA_COMPLETION_BUDGET_TOKENS = 14,336` is an OPERATIONAL budget

An earlier revision of this work claimed the budget "covers every schema-legal document". **That
claim was wrong and has been withdrawn.** The Riya schema bounds free text with
`z.string().max(n)`, and Zod counts UTF-16 code units, not bytes. The worst case had been measured by
filling those fields with ASCII `x`, where one unit is one byte — so what was measured was the
largest _ASCII_ document, not the largest document.

Measured against the real schema at identical field lengths:

| free-text fill                        | schema-valid | serialized bytes |
| ------------------------------------- | ------------ | ---------------- |
| single-byte ASCII                     | yes          | 28,241           |
| astral pair (emoji)                   | yes          | 45,077           |
| three-byte BMP (Devanagari, CJK)      | yes          | 61,913           |
| JSON-escaped control / lone surrogate | yes          | **112,421**      |

A control character costs six serialized bytes per unit once `JSON.stringify` escapes it.

### What is proven

`14,336` tokens × an assumed 2 bytes/token = **28,672 serialized bytes of coverage**. That is:

- **above** the schema maximum for single-byte free text (28,241 bytes);
- **far above** a full-length 2,500-unit reply in a three-byte script — the realistic worst case for
  this product.

`ASSUMED_BYTES_PER_TOKEN = 2` is an operational assumption, conservative for ordinary ASCII JSON. It
is **not** a proven tokenizer bound for arbitrary Unicode; no tokenizer runs offline, and no claim
here depends on one.

### Where the assumed coverage runs out

The pathological schema-valid document serialises to ~112,421 bytes, which is larger than the 28,672
bytes of assumed operational coverage. That is a byte-to-byte comparison and it is all it claims.

### BYTES are not TOKENS — a second retracted claim

An intermediate revision of this report compared that ~112,421-**byte** figure against the model's
65,536-**token** output ceiling and concluded the schema permits documents the model physically
cannot emit. **That conclusion was invalid and is withdrawn.** The two quantities are in different
units: a token can represent several bytes, so a larger byte count implies nothing about token count,
and "one token per byte is the floor for any tokenizer" is not a bound any evidence here supports.

**No governed tokenizer is available offline.** A search of this repository and its dependency tree
found no GPT-OSS-20B tokenizer package, no manifest entry, and no vocab/merges/tokenizer artifact. No
tokenizer was downloaded, and no network request was made to obtain one.

Therefore:

- the **token** cost of every fixture above is **NOT MEASURED**;
- whether the pathological document exceeds the model's 65,536-token ceiling is **UNRESOLVED**;
- that gap is left open rather than closed with an approximation presented as a theorem.

What does follow is bounded: for such a document the budget may be too small, in which case a
truncated answer becomes malformed strict JSON and the gateway refuses it as invalid structured
output rather than accepting it.

Narrowing that gap would mean contracting the citation and observation array maxima — the dominant
terms, which a real turn never fills. **That is an owner decision about Riya's behaviour contract, and
no schema contraction was performed here.**

### How both mistakes are prevented from returning

Adversarial Unicode specs pin every byte figure above, including the negative ones, so an ASCII-only
"largest document" cannot again be presented as a universal maximum. A structural guard additionally
scans the budget module and its spec and fails if any ORDERING comparison places a byte-named
quantity against a token-named one — with a self-test proving the guard fires on the exact assertion
that was retracted. Unit conversion through the declared assumption is deliberately still permitted;
magnitude comparison across units is not.

---

## 6B. POST-PR-131 — the probe matrix is ORTHOGONAL, not a cumulative ladder

Owner review of the merged §6 material found that its "reduction ladder" language overclaimed.

**The retracted claim.** The module described consecutive rungs as adding "exactly ONE dimension
each", so that "the FIRST rejection names a cause". The implementation never did that: each probe
wraps ONE fragment located in the real projected document, so `R2_SCALAR_ARRAY` is a _different_
single fragment rather than `R1` plus an array — it does not contain R1's numeric enum at all. The
supporting test asserted only that the dimension LABELS were distinct, which proves nothing
structural, and the complexity test checked only that the control was shallowest and the exact
document deepest.

**The corrected semantics.** R0–R8 is an **orthogonal / incrementally broadening probe matrix**:

| Probe                     | Kind    | Question                                                                                     |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `R0_MINIMAL_CONTROL`      | CONTROL | Does the account/model/envelope still accept the known minimal strict schema at the low cap? |
| `R1`–`R5`                 | FEATURE | Does the provider accept THIS real fragment, alone, at the low cap?                          |
| `R6`, `R7`                | GROUP   | Does it accept this whole real top-level group, alone?                                       |
| `R8_EXACT_PROJECTED_RIYA` | EXACT   | Does it accept the exact projected document?                                                 |

Each answers its own question. None asserts a relationship to its predecessor.

**Consequences, enforced by the runner rather than left to a reader:**

- a failed **control** stops the matrix — nothing after it is attributable to the Riya schema;
- a failed **feature or group** probe does **not** stop the matrix; every remaining probe runs, and
  the result is the complete **SET** of rejections;
- no probe is promoted to "the cause" by ordering.

A spec now proves the non-cumulative property _structurally_ — zero adjacent FEATURE pairs satisfy
`dimensions(n-1) ⊆ dimensions(n)` — rather than inferring it from labels.

### Governance of the future run

| Field                        | Value                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| Run goal                     | `SCHEMA_DIFFERENTIAL_DIAGNOSTIC` (new; S11's `REQUEST_CONTRACT_DIAGNOSTIC` is untouched) |
| Exit code                    | `24` (request-contract keeps `23`)                                                       |
| Completion cap               | **512 for every probe** — fixed, so the S11 cap axis is not reintroduced                 |
| Max provider requests        | **10** = 1 smoke + 9 probes                                                              |
| Max estimated cost           | **USD 1.00**                                                                             |
| Safety / P10 / bundle writes | 0 / 0 / 0                                                                                |
| Retry / fallback / 120B      | 0 / 0 / 0                                                                                |

Classifications: `DIAGNOSTIC_INVALID_CONTROL`, `ISOLATED_SCHEMA_FEATURE_REJECTION`,
`FULL_SCHEMA_COMPOSITION_REJECTED`, `EXACT_PROJECTED_RIYA_SCHEMA_ACCEPTED_LOW_CAP`,
`MIXED_OR_INCONCLUSIVE` — each reported with `acceptedStepIds` / `rejectedStepIds` /
`inconclusiveStepIds`.

`EXACT_PROJECTED_RIYA_SCHEMA_ACCEPTED_LOW_CAP` would mean **only** that the exact projected schema was
accepted with synthetic messages at the low cap. It would not establish the operational Riya budget,
the production message shape, safety eligibility, model quality, P10 eligibility or release readiness.

### Summary precedence — corrected after owner review

Two precedences, and only two:

1. **R0 (control)** — if it fails, nothing else is attributable to the Riya schema and the matrix
   stops.
2. **R8 (exact document)** — if it is **accepted**, the summary is
   `EXACT_PROJECTED_RIYA_SCHEMA_ACCEPTED_LOW_CAP` regardless of any isolated wrapper rejection. R8 is
   the D5 shape under this envelope, so an accepted R8 means the historical D5 rejection was not
   reproduced in this run.

An earlier revision checked wrapper rejections first, so `R2 rejected + R8 accepted` headlined
`ISOLATED_SCHEMA_FEATURE_REJECTION` — announcing a schema rejection in a run where the production
schema had actually been accepted. Isolated findings always remain in `rejectedStepIds`; they are
evidence about that wrapper shape, not the headline.

Between FEATURE and GROUP probes there is no precedence at all.

**No monotonicity is assumed.** A provider may refuse a minimal wrapper and accept the full document,
or accept every fragment and refuse their composition. Observing which actually happens is the whole
point of an orthogonal matrix.

### Capability ceiling vs request budget

The diagnostic provider is configured at the **real** model capability ceiling
(`CANDIDATE_MAX_COMPLETION_TOKENS = 65,536`) and asks for a **per-request budget** of
`SCHEMA_PROBE_COMPLETION_CAP = 512`. The provider clamps `min(512, 65_536)`, so the wire carries 512
while neither constant is misrepresented — the separation PR #131 established. A spec observes both
axes from the composition itself.

### Wire-schema equivalence

The matrix is planned from the already-projected document and the provider projects again before
building `response_format`. A spec proves that second pass is **identity-preserving** for every probe,
and that R8's wire schema structurally equals the exact projected production Riya schema.

**This matrix has NOT been executed.** It requires separate owner authorization.

---

## 7. CONTAINMENT FOR THIS PHASE

```
GROQ_CALLS=0
REAL_CLIPBOARD_READS=0
REAL_CREDENTIAL_READS=0
LIVE_DIAGNOSTIC_REQUESTS=0
SAFETY_PROVIDER_REQUESTS=0
P10_PROVIDER_REQUESTS=0
REVIEW_BUNDLE_WRITES=0
S11_RERUN=NO
S11_AUTHORIZED_AGAIN=NO
P10_AUTHORIZED=NO
120B_AUTHORIZED=NO
20B_VERDICT=UNRESOLVED
```

Strict structured output remains `strict: true`. No `json_object` fallback, no non-strict mode, no
retry, no fallback provider, no model substitution.
