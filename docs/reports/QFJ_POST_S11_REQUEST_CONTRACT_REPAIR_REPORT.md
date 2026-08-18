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
