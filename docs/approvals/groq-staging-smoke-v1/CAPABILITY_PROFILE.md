# Capability Profile — Groq Staging Smoke v1

**Reference:** `cap.groq.openai-gpt-oss-20b.strict-json.2026-07-28`
**Approval date:** 2026-07-28
**Slice:** QFJ-S1C
**Evidence classification:** **OWNER-APPROVED + REPOSITORY-HARNESS-VALIDATED**

---

## 1. Provider and model identity

| Field            | Value                              |
| ---------------- | ---------------------------------- |
| `providerId`     | `groq`                             |
| `modelId`        | `openai/gpt-oss-20b`               |
| `modelVersion`   | `groq-catalog-snapshot-2026-07-28` |
| `executionClass` | `HOSTED`                           |
| `dataClass`      | `HOSTED_ALLOWED`                   |

`modelId` is the Groq catalogue identity **verbatim**, including the namespace separator. It is sent
as the wire `model` field unchanged. The namespaced form is accepted across the Model Gateway, the
staging smoke configuration, and evaluation bindings (PRs #58 and #59).

## 2. Strict JSON Schema requirement

Strict structured output is **mandatory** on this path and is never downgraded.

- `supportsStrictJsonSchema` must be `true`; the smoke configuration accepts only the literal `true`.
- The request carries `response_format` of type `json_schema` with `strict: true`.
- A schema that is not strict-compatible fails **before** any transport call.
- The returned value is validated locally against the compiled schema; a mismatch is
  `smoke-provider-malformed`.

## 3. Fixed prompt and schema identity

Compiled into the harness and matched exactly by the configuration — not owner-supplied, not
overridable by CLI, configuration, or stdin.

| Field            | Value                               |
| ---------------- | ----------------------------------- |
| `promptFamily`   | `qfj.s1a.synthetic.smoke`           |
| `promptVersion`  | `1`                                 |
| `schemaRevision` | `qfj.s1a.synthetic.smoke.schema.v1` |

## 4. Approved limits

| Bound                 | Approved value |
| --------------------- | -------------- |
| `maxInputTokens`      | `512`          |
| `maxCompletionTokens` | `256`          |
| `timeoutMs`           | `30000`        |

`timeoutMs` sits inside the harness-enforced range of 1,000–120,000 ms and is enforced by the
harness-owned `AbortController` and single timer. `maxCompletionTokens` is sent as
`max_completion_tokens` and is capped by the configuration schema at 4,096.

## 5. Scope

This profile approves **one synthetic connectivity smoke** and nothing more.

**It is NOT a general production capability approval.** It says only that the owner approves this
exact model identity, under these exact bounds, with strict structured output, for a single synthetic
probe. It approves no production traffic, no task class beyond the fixed probe, no concurrency, no
throughput, and no latency guarantee.

## 6. Evidence basis — and its limits

**OWNER-APPROVED:** the model identity, the bounds, and the strict-schema requirement are owner
decisions recorded in [`OWNER_APPROVAL.md`](./OWNER_APPROVAL.md).

**REPOSITORY-HARNESS-VALIDATED:** the repository has proven, against deterministic fakes only, that
the harness binds this identity, enforces strict structured output, sends exactly one request to the
fixed endpoint, performs zero retries, and discards the model output.

**S1C has NOT called Groq and has NOT evaluated live model behaviour.** No request was made, no
credential was read, and no observed capability was measured. Nothing here is evidence about how the
model actually performs — only about what has been approved and what the harness enforces.
