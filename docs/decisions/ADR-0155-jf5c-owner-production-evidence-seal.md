# ADR-0155 — JF-5C owner production-evidence seal

- **Status:** Accepted — implements the seal mechanism only. No production evidence is sealed by this ADR.
- **Date:** 2026-09-19
- **Baseline:** merged `main` at `356f71017652fd666737c386b2f4e99f009deb8e` (PR #211).
- **Depends on:** ADR-0147, ADR-0151, ADR-0152, ADR-0153.
- **Package:** `@qf-jarvis/jarvis-v1-production-seal`.

## Context

JF-5B deliberately ends before production approval. Its live certification manifest carries exactly six
provider × agent bindings — Groq and Nara against Riya, Anisha and Aarohi — because the three production
prompt bodies have distinct reviewed digests. JF-5B also leaves every quality decision
`REVIEW_PENDING` and records no `productionApproval`, activation token or `ACTIVE_MODEL_RELEASE`.

That boundary is correct, but the repository had no JF-5C implementation that could consume the six
bindings, bind blinded human review and owner data-controls acceptance to them, and produce evidence in
the existing model-evaluation vocabulary. The absence must not be filled by collapsing three prompt
approvals into one provider label.

## Decision

JF-5C is a new pure package that consumes four explicit inputs:

1. one validated JF-5B six-binding coverage manifest;
2. exactly six blinded human-review decisions, one for every provider × agent pair;
3. explicit owner acceptance of the recorded Nara data-controls posture;
4. the seal instant.

It returns either a closed refusal token or a deeply frozen production-evidence seal. It reads no
environment variable, file, database, credential or network resource and performs no provider call.

A seal may exist only when all six JF-5B safety entries are `PASS`. `FAIL`, `INCONCLUSIVE` and
`NOT_RUN` all refuse. Every human review must be present exactly once and must be `ACCEPT`. The
review-bundle digest must equal the digest recorded by the corresponding JF-5B entry.

The owner acceptance must explicitly name the exact Nara data-controls reference recorded by JF-5B.
There is no default acceptance and no inference from the existence of a manifest.

## Evidence shape

On success JF-5C emits **six** existing `ApprovalEvidence` records:

- target `ACTIVE_MODEL_RELEASE`;
- `synthetic: false`;
- `productionApproval: true`;
- one exact provider release;
- one exact agent prompt family, version and digest;
- the existing JF-5B capability profile, suite, red-team suite, fixture manifest and evaluator identity;
- the JF-5B case-set and result digests.

The exact Riya, Anisha and Aarohi prompt identities are re-derived from the reviewed prompt packages and
compared with the manifest. Prompt drift therefore refuses rather than inheriting an old approval.

JF-5C also emits two provider coverage seals, one for Groq and one for Nara. Each coverage seal binds the
single exact provider release to exactly three evidence references and exactly three distinct prompt
digests. These provider records are audit summaries; they are not substitutes for the six prompt-scoped
approval evidences.

No wildcard, `latest` alias, router alias or cross-release carry-over is admitted.

## Containment

The JF-5B containment lock is narrowed by exact path to permit only the JF-5C implementation and its
spec to import the JF-5B manifest contract. No serving application, runtime, worker, ingress or provider
path is added to the allowlist.

JF-5C exposes no activation method, model gateway, provider constructor, credential seam, database port,
WhatsApp capability or QuickFurno transport. Importing it has no side effect.

Creating a valid seal still activates nothing. ADR-0147's trusted production composition remains the
separate boundary that may consume production evidence. QuickFurno Core remains the sole business
authority and sole provider/WhatsApp sender.

## Current production state

This ADR does **not** assert that JF-5C can seal today. The latest committed JF-5B history still lacks a
fresh live run whose six provider × agent safety entries are all `PASS`. The required six blinded human
acceptances and explicit owner Nara data-controls acceptance therefore also do not exist as qualifying
seal inputs.

No production approval is fabricated to make this phase appear complete. Production model serving and
QuickFurno Jarvis WhatsApp activation remain disabled.

## Exit and next

The code slice may merge after formatting, lint, typecheck, unit tests, PostgreSQL integration tests,
build and dist-containment all pass at the exact head.

Operational activation remains a separate sequence:

1. owner-operated JF-5B live certification produces all-six `PASS` safety coverage;
2. the six blinded reviews are completed and accepted;
3. the owner explicitly accepts the recorded Nara data-controls posture;
4. JF-5C creates the exact six production evidences and two provider coverage seals;
5. the trusted production composition consumes only matching exact-release evidence;
6. deployed QuickFurno and Jarvis SHAs are verified;
7. a real WhatsApp canary proves Meta → QuickFurno → signed Jarvis → Riya → signed QuickFurno reply →
   governed Meta send/status;
8. only then is the conversational runtime explicitly enabled.

Until that sequence completes, fail-closed remains the required state.
