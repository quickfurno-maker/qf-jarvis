# ADR-0156 — JF-5D Groq-only production posture and Nara retirement

- **Status:** Accepted by owner direction on 2026-09-21.
- **Baseline:** `main` at `317059dd32b7416400f8af727decfad21cb10eae`.
- **Supersedes for the current release:** the JF-5B/JF-5C requirement to qualify and seal a second hosted Nara provider.
- **Does not supersede:** ADR-0147's exact-release production evidence gate, QuickFurno Core authority, human review, deployment verification, WhatsApp canary, or emergency-disable requirements.

## Context

The dual-hosted-provider design originally targeted Groq primary plus Nara fallback. Repeated owner-operated
JF-5B runs established two things separately:

1. the certification evaluator needed several narrow false-positive repairs, all retained with fail-closed
   regression controls; and
2. the owner-selected Nara candidate `agnes-2.5-flash` ultimately produced a genuine Anisha business-
   authority failure by promising that support could "get your entitlement activated for you."

The owner has now chosen a simpler Production V1 posture: **Groq is the only hosted provider**. Nara is
retired from the current release. A local inference system may be introduced later, but only as a new,
separately identified and certified release.

ADR-0147 already permits this exact migration path: `GROQ_ONLY` requires only Groq's exact production
approval and disables provider fallback. This ADR makes that posture the current QuickFurno/Jarvis release
decision rather than an optional mode.

## Decision

### 1. Current production provider mode is GROQ_ONLY

The current certification and production-evidence lane names exactly one provider: `groq`.

- no Nara credential is requested;
- no Nara model discovery call is made;
- no Nara candidate is accepted from CLI arguments;
- no Nara selection probe is run;
- no Nara certification case is run;
- no AUTO or Nara fallback certification is run;
- the JF-5B live call ledger has `maxNaraCalls = 0`;
- the current live composition exposes no Nara credential or discovery seam.

The generic Model Gateway may retain its historical/provider-neutral Nara implementation. That library
surface is not current release authority. Re-enabling Nara would require a new code/ADR change and fresh
production evidence; no existing Nara artifact can turn it back on.

### 2. JF-5B manifest v2 has exactly three bindings

Historical JF-5B v1 manifests remain readable for audit and reproducibility: Groq + Nara × Riya + Anisha

- Aarohi, six entries.

New certification emits **manifest v2**:

- `manifestVersion: 2`;
- `providerMode: GROQ_ONLY`;
- exactly three entries: Groq × Riya, Groq × Anisha, Groq × Aarohi;
- exactly the Groq data-controls reference;
- no Nara entry and no fallback claim.

Any non-PASS result remains blocking. `FAIL`, `INCONCLUSIVE`, and `NOT_RUN` cannot be rounded up.

### 3. JF-5C seal v2 is Groq-only

JF-5C v2 accepts only a v2 `GROQ_ONLY` JF-5B manifest. A legacy six-binding v1 manifest is explicitly
refused for new production sealing.

A valid seal requires:

- all three Groq safety entries PASS;
- exactly three blinded human `ACCEPT` reviews, one per Groq × agent binding;
- exact review-bundle digests;
- exact reviewed prompt identities and release identity;
- Groq data-controls binding.

On success it produces exactly three prompt-scoped `ACTIVE_MODEL_RELEASE` production approvals and one
Groq provider coverage seal. Creating the seal still activates nothing by itself.

Nara owner data-controls acceptance is no longer a production requirement because Nara is not a provider
in this release.

### 4. Historical Nara code is dormant, not production-authorizing

Nara provider/discovery types and old v1 test helpers may remain in provider-neutral or historical
packages to preserve auditability and avoid destructive history rewrites. They are excluded from the
current live executable and current seal contract.

The distinction is structural:

- historical library capability: may still describe Nara;
- current live certification composition: cannot acquire or call Nara;
- current JF-5B v2 evidence: cannot contain Nara;
- current JF-5C v2 seal: refuses legacy/Nara manifests;
- current production mode: `GROQ_ONLY`, fallback false.

### 5. Future local inference is a new provider decision

A local system is **not** silently substituted for Nara and is not automatically a fallback.

Before local inference may serve customer-facing output it needs, at minimum:

1. an exact local release identity and execution class;
2. capability registration appropriate to its schemas/tasks;
3. live safety/quality certification for Riya, Anisha and Aarohi;
4. human review and production approval bound to that exact release;
5. an explicit routing-policy revision defining when local may serve or fall back;
6. the same QuickFurno Core authority, privacy, takeover, audit and canary gates.

Until those conditions are met, local inference remains inactive.

## Safety invariants retained

This decision does not weaken any agent business-authority rule, prompt digest, structured-output schema,
forbidden-claim corpus, Core authority boundary, retry rule, privacy classification, human-takeover gate,
production evidence verification, signed QuickFurno transport, or WhatsApp send governance.

In particular, the genuine Agnes entitlement-activation failure remains a failure in history. It is not
suppressed merely because Nara is retired.

## Exit criteria for final Groq-only completion

The current release may proceed toward production only after:

1. a fresh exact-head Groq-only JF-5B run completes all three agent corpora with zero FAIL,
   INCONCLUSIVE or NOT_RUN;
2. all three blinded human reviews ACCEPT;
3. JF-5C v2 produces the three exact production approvals and Groq coverage seal;
4. trusted production composition consumes only those exact approvals in `GROQ_ONLY` mode;
5. deployed QuickFurno and Jarvis SHAs are verified;
6. the real governed WhatsApp canary succeeds end to end;
7. the conversational runtime is explicitly enabled by the production operator.

Until then the system remains fail-closed/non-authorizing.
