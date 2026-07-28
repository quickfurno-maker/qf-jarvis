# QFJ-S1C — Groq Staging Approval Pack and Deterministic Config Digest

**Slice:** QFJ-S1C
**Date:** 2026-07-28
**Base:** `main` at `c587e952c00ea8c2ce341fb3659ab43e8ac1966a`
**Outcome:** Approval pack recorded; generator implemented and tested. **The smoke was not run.**

---

## 1. What this slice closes

The S1B readiness audit classified the repository `BLOCKED_BY_CODE_OR_CONTRACT` on five non-secret
prerequisites — no approved release, capability reference, evaluation reference, data-controls
attestation, or credential reference existed anywhere in the repository, and the only candidate
values were synthetic test fixtures.

S1C records the owner-approved values as first-class evidence and derives the configuration digest
deterministically from them.

| S1B blocker                                           | Closed by                                                                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QFJ-SMOKE-BLOCK-MISSING-APPROVED-RELEASE`            | [`OWNER_APPROVAL.md`](../approvals/groq-staging-smoke-v1/OWNER_APPROVAL.md), [`release-approval.json`](../approvals/groq-staging-smoke-v1/release-approval.json) |
| `QFJ-SMOKE-BLOCK-MISSING-CAPABILITY-REF`              | [`CAPABILITY_PROFILE.md`](../approvals/groq-staging-smoke-v1/CAPABILITY_PROFILE.md)                                                                              |
| `QFJ-SMOKE-BLOCK-MISSING-EVALUATION-REF`              | [`EVALUATION_SCOPE.md`](../approvals/groq-staging-smoke-v1/EVALUATION_SCOPE.md)                                                                                  |
| `QFJ-SMOKE-BLOCK-MISSING-DATA-CONTROL-ATTESTATION`    | [`DATA_CONTROLS_ATTESTATION.md`](../approvals/groq-staging-smoke-v1/DATA_CONTROLS_ATTESTATION.md)                                                                |
| `QFJ-SMOKE-BLOCK-MISSING-OPAQUE-CREDENTIAL-REFERENCE` | `credentialReference` in the approval records                                                                                                                    |

`QFJ-SMOKE-BLOCK-NON-INTERACTIVE-TTY` is environmental and remains: the run must happen in the
owner's own terminal.

## 2. Approved non-secret values

| Field                            | Value                                                |
| -------------------------------- | ---------------------------------------------------- |
| `providerId`                     | `groq`                                               |
| `modelId`                        | `openai/gpt-oss-20b`                                 |
| `modelVersion`                   | `groq-catalog-snapshot-2026-07-28`                   |
| `releaseId`                      | `rel.groq.qfj.staging.smoke.v1`                      |
| `credentialReference`            | `groq.qfj.staging.smoke.v1`                          |
| `capabilityProfileRef`           | `cap.groq.openai-gpt-oss-20b.strict-json.2026-07-28` |
| `evaluationRef`                  | `eval.qfj.synthetic-connectivity-smoke.v1`           |
| `dataControlsAttestationRef`     | `att.groq.qfj-staging.global-zdr.2026-07-28`         |
| `executionClass`                 | `HOSTED`                                             |
| `dataClass`                      | `HOSTED_ALLOWED`                                     |
| `maxInputTokens`                 | `512`                                                |
| `maxCompletionTokens`            | `256`                                                |
| `timeoutMs`                      | `30000`                                              |
| `supportsStrictJsonSchema`       | `true`                                               |
| `dataControlsAttested`           | `true`                                               |
| `promptFamily` (harness-fixed)   | `qfj.s1a.synthetic.smoke`                            |
| `promptVersion` (harness-fixed)  | `1`                                                  |
| `schemaRevision` (harness-fixed) | `qfj.s1a.synthetic.smoke.schema.v1`                  |

## 3. Deterministic digest

**configDigest**

```
4f97ef1e9e46905db253912bd56dab8aea4f38e4d606dfe93b16fc024f0c2be1
```

**Canonicalisation.** Recursively sort every object key by Unicode **code point** (not UTF-16 code
unit — the comparator is explicit about this); preserve array order; `JSON.stringify` with no
indentation; UTF-8; no BOM; no trailing newline; SHA-256; 64 lowercase hex characters.
`configDigest` is excluded from its own input — supplying it is a hard error.

**Canonical payload** — 709 bytes UTF-8:

```
{"capabilityProfileRef":"cap.groq.openai-gpt-oss-20b.strict-json.2026-07-28","credentialReference":"groq.qfj.staging.smoke.v1","dataClass":"HOSTED_ALLOWED","dataControlsAttestationRef":"att.groq.qfj-staging.global-zdr.2026-07-28","dataControlsAttested":true,"evaluationRef":"eval.qfj.synthetic-connectivity-smoke.v1","maxCompletionTokens":256,"maxInputTokens":512,"promptFamily":"qfj.s1a.synthetic.smoke","promptVersion":1,"release":{"executionClass":"HOSTED","modelId":"openai/gpt-oss-20b","modelVersion":"groq-catalog-snapshot-2026-07-28","providerId":"groq","releaseId":"rel.groq.qfj.staging.smoke.v1"},"schemaRevision":"qfj.s1a.synthetic.smoke.schema.v1","supportsStrictJsonSchema":true,"timeoutMs":30000}
```

The computed value matched the expected value exactly. Nothing was adjusted to force it.

## 4. Generator

`scripts/generate-groq-staging-smoke-config.mjs` — dependency-free Node, importing only
`node:crypto`, `node:fs`, `node:path`, `node:url`.

```
node scripts/generate-groq-staging-smoke-config.mjs
    -> prints the digest, and nothing else

node scripts/generate-groq-staging-smoke-config.mjs --emit-config <PATH_OUTSIDE_REPO> [--force]
    -> atomically writes the secret-free configuration
    -> success output is exactly two lines: outputPath=… and configDigest=…
```

It refuses a repository-internal output path, refuses to overwrite without `--force`, rejects
unrecognised arguments, reads no environment variable, reads no standard input, prompts for nothing,
accepts no secret, and makes no network call. The secret-field guard is **allow-list first**, so
`maxCompletionTokens` and `credentialReference` are not falsely rejected while `apiKey`, `secret`,
`token`, `bearer`, `authorization`, `password`, and `credentialValue` are.

**The external configuration was NOT generated in S1C.** Only the generator and its tests exist.

## 5. Evidence status — read this honestly

The console statements in `DATA_CONTROLS_ATTESTATION.md` and `OWNER_APPROVAL.md` are labelled
**OWNER-ATTESTED / NOT INDEPENDENTLY API-VERIFIED**. This repository made no call to the Groq
console or API. The capability profile is **OWNER-APPROVED + REPOSITORY-HARNESS-VALIDATED**: the
harness behaviour is proven against deterministic fakes; the model's live behaviour is not, because
nothing was invoked.

## 6. Verification

33 targeted tests in
`packages/groq-staging-smoke/src/tests/groq-staging-smoke-config-generator.test.ts` cover all 24
mandated proofs, including that the generated configuration passes the **real merged**
`parseSmokeConfig`, that the tracked approval JSON agrees with the generator field for field, and
that no synthetic fixture value appears in any approval record.

Full gate: `format:check`, `lint --max-warnings=0`, `typecheck`, `test:unit` (**125 files / 3760
tests**), `build`, `check:dist-containment` — all green.

Invariants held: migrations `0001`–`0007` byte-identical, no `0008`; model-evaluation root API 33;
event-backbone root API 39; model-ID semantics aligned across gateway, evaluation, and smoke.

## 7. Boundaries

No credential read, requested, validated, displayed, or stored. No Groq or network request. No smoke
execution. No credential-resolver invocation. No database, Supabase, Docker, or migration command.
No deployment, provider activation, or rollout. No QuickFurno Core, WhatsApp, n8n, or real data. The
protected reconciliation directory was never opened, read, hashed, staged, or modified.

**The one-time smoke authorization remains UNCONSUMED**, because S1C reads no credential and issues
no request.

## 8. Next

1. Owner review and merge of this approval pack.
2. Generate the external configuration outside the repository:
   `node scripts/generate-groq-staging-smoke-config.mjs --emit-config <path outside repo>`
3. The separately-authorized one-shot synthetic smoke, run by the owner in a real interactive
   terminal, per
   [`05-owner-authorized-live-run-checklist-and-rollback.md`](./qfj-s1a-groq-smoke-activation-enablement/05-owner-authorized-live-run-checklist-and-rollback.md).
