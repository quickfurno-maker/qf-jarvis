# Data Controls Attestation — Groq Staging Smoke v1

**Reference:** `att.groq.qfj-staging.global-zdr.2026-07-28`
**Attestation date:** 2026-07-28
**Slice:** QFJ-S1C
**Status:** **OWNER-ATTESTED / NOT API-VERIFIED**

---

## 1. Project

| Field        | Value                        |
| ------------ | ---------------------------- |
| Groq project | `qf-jarvis-staging`          |
| Environment  | Staging — **not** production |

## 2. Owner-attested data controls

Recorded exactly as the owner reported them:

- **Global Zero Data Retention (ZDR) is enabled** for the project.
- **API-specific settings are overridden** by the global ZDR setting.
- Project model permission is **restricted to `openai/gpt-oss-20b`**.
- A project-scoped API key exists under the label **`qf-jarvis-staging-smoke-v1`**.

## 3. Key label only — no key material

Only the key's **label** is recorded above. This document, and this repository, contain **no** key
value, prefix, suffix, hash, fingerprint, length, bearer token, `Authorization` header, account
identifier, organisation identifier, or console user identifier.

The owner reported that the key value was not shared in chat or in this repository.

## 4. Verification status — read this before relying on it

**OWNER-ATTESTED / NOT API-VERIFIED.**

This repository has made **no** call to the Groq console, the Groq API, or any provider endpoint.
Every statement in sections 1–3 is the owner's report, recorded verbatim. None of it has been
independently confirmed here, and this document must not be read as though it had been.

What the repository _does_ enforce is the consequence: `dataControlsAttested` must be the literal
`true` for a bind to proceed, and `GroqModelProvider.health()` reports unavailable without it. The
gateway fabricates no ZDR, privacy, billing, or production approval — it fails closed when the
attestation is absent.

## 5. Scope

This attestation covers **the staging connectivity smoke only**.

It does not cover production traffic, real client or vendor data, production activation, rollout
promotion, or any other project. It is bound to the exact release
`rel.groq.qfj.staging.smoke.v1` / `openai/gpt-oss-20b` recorded in
[`OWNER_APPROVAL.md`](./OWNER_APPROVAL.md).

## 6. Future production approval

A production data-controls approval is **separate evidence requiring separate authorization**. It
would need, at minimum:

- an attestation bound to the production project and release, not this staging one;
- independent verification rather than an owner report alone;
- confirmation of retention, logging, and sub-processor terms for production traffic;
- a distinct attestation reference, recorded under its own approval.

Until that exists, no production activation or rollout promotion is approved by this document.
