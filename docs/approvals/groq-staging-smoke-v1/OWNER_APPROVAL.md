# Owner Approval — Groq Staging Smoke v1

**Approval date:** 2026-07-28
**Slice:** QFJ-S1C
**Approver:** Owner
**Scope:** ONE synthetic staging connectivity smoke. Nothing else.

---

## 1. Approved non-secret values

These are the exact values a staging smoke run must use. Every one is an identifier, a bound, or a
boolean. **None is a secret**, and none may be substituted at run time.

| Field                        | Approved value                                       |
| ---------------------------- | ---------------------------------------------------- |
| `providerId`                 | `groq`                                               |
| `modelId`                    | `openai/gpt-oss-20b`                                 |
| `modelVersion`               | `groq-catalog-snapshot-2026-07-28`                   |
| `releaseId`                  | `rel.groq.qfj.staging.smoke.v1`                      |
| `credentialReference`        | `groq.qfj.staging.smoke.v1`                          |
| `capabilityProfileRef`       | `cap.groq.openai-gpt-oss-20b.strict-json.2026-07-28` |
| `evaluationRef`              | `eval.qfj.synthetic-connectivity-smoke.v1`           |
| `dataControlsAttestationRef` | `att.groq.qfj-staging.global-zdr.2026-07-28`         |
| `executionClass`             | `HOSTED`                                             |
| `dataClass`                  | `HOSTED_ALLOWED`                                     |
| `maxInputTokens`             | `512`                                                |
| `maxCompletionTokens`        | `256`                                                |
| `timeoutMs`                  | `30000`                                              |
| `supportsStrictJsonSchema`   | `true`                                               |
| `dataControlsAttested`       | `true`                                               |

`credentialReference` is a secret **name/version identifier**. It is not the key and cannot be used
to derive the key.

### Fixed harness values (not owner inputs)

Compiled into `@qf-jarvis/groq-staging-smoke` and matched exactly by the configuration schema:

| Field            | Value                               |
| ---------------- | ----------------------------------- |
| `promptFamily`   | `qfj.s1a.synthetic.smoke`           |
| `promptVersion`  | `1`                                 |
| `schemaRevision` | `qfj.s1a.synthetic.smoke.schema.v1` |

### Derived value

| Field                  | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `release.configDigest` | `4f97ef1e9e46905db253912bd56dab8aea4f38e4d606dfe93b16fc024f0c2be1` |

Deterministically computed from the approved values by
`scripts/generate-groq-staging-smoke-config.mjs`. It is derived, never typed in — change any approved
value and the digest changes.

---

## 2. Owner scope statement (verbatim)

> “The evaluation reference approves only the synthetic staging connectivity smoke. It does not
> approve production quality, production activation, rollout, real customer data, WhatsApp, n8n,
> QuickFurno Core access, database access, or deployment.”

---

## 3. Owner console attestations

**OWNER-ATTESTED / NOT INDEPENDENTLY API-VERIFIED.**

The following are recorded exactly as the owner reported them. This repository has made **no** call to
the Groq console or API, so none of it has been independently verified here. Nothing below is treated
as evidence produced by this repository.

- Groq project selected/created: **`qf-jarvis-staging`**
- **Global Zero Data Retention enabled**; API-specific settings overridden
- Project model permission restricted to **`openai/gpt-oss-20b`**
- Project-scoped API key created under label **`qf-jarvis-staging-smoke-v1`**
- The API key **value was not shared** in chat or in this repository

Only the key's **label** is recorded. No key value, prefix, suffix, hash, length, or fingerprint
appears anywhere in this repository.

---

## 4. What S1C does NOT authorize

**S1C does not authorize running the smoke.** This slice records approval evidence and adds a
deterministic, secret-free configuration generator. It performs no credential read and no outbound
request.

Specifically, S1C does not authorize: reading, requesting, validating, displaying, storing, or using
the Groq API key; invoking the masked credential resolver; any Groq/API/network request; database,
Supabase, Docker, or migration commands; deployment, provider activation, or production rollout; or
any access to QuickFurno Core, WhatsApp, n8n, or real client/vendor data.

---

## 5. The API key must never appear anywhere

The staging API key value must **never** appear in:

- this repository (source, configuration, fixtures, tests, documentation, or history);
- the smoke configuration file;
- a command line or shell argument;
- an environment variable;
- logs, reports, events, or terminal output;
- screenshots;
- ChatGPT;
- Claude.

The only approved ingress is the masked interactive terminal prompt in
`@qf-jarvis/groq-staging-smoke`, which requires a TTY, disables echo, reads once, and hands the value
straight to the redacting key holder. Typing it anywhere else means treating it as exposed and
rotating it.

---

## 6. The one-time smoke authorization remains UNCONSUMED

The owner's one-time authorization for a single synthetic non-production Groq smoke request is
**still unspent** after S1C.

Authorization is consumed only when the masked credential is read. S1C reads no credential, resolves
no secret, constructs no resolver, and issues no request — so nothing was consumed. The same recorded
authorization remains available for the first attempt, once the approval pack is merged and the
external configuration has been generated.

---

## 7. Related records

- [`release-approval.json`](./release-approval.json) — machine-readable approved values + digest
- [`CAPABILITY_PROFILE.md`](./CAPABILITY_PROFILE.md) — `capabilityProfileRef` evidence
- [`EVALUATION_SCOPE.md`](./EVALUATION_SCOPE.md) — `evaluationRef` scope
- [`DATA_CONTROLS_ATTESTATION.md`](./DATA_CONTROLS_ATTESTATION.md) — `dataControlsAttestationRef` evidence
- [ADR-0060](../../decisions/ADR-0060-qfj-s1-groq-staging-provider-binding.md) — the staging binding
- [ADR-0061](../../decisions/ADR-0061-qfj-s1a-groq-staging-smoke-activation-enablement.md) — the one-shot harness
