# ADR-0152 — JF-5B: live Groq/Nara three-agent provider certification

- **Status:** Accepted as the CERTIFICATION HARNESS. **Evaluation only.** No production activation, no
  `ACTIVE_MODEL_RELEASE`, no production approval. The live run itself is a separate, owner-operated
  step: it requires an interactive terminal and cannot be performed by CI or by an agent session.
- **Date:** 2026-09-11
- **Baseline:** `origin/main` at `33ed51f4d5ffa6271c9a5669aa180833d818326b` — the merge of PR #202
  (JF-5A, reviewed at head `015430c`). Migrations `0001`–`0014`; **JF-5B adds none.**
- **Governed by:** ADR-0146/0147 (JF-2 gateway, Nara provider, provider modes), ADR-0148 (JF-3 RAG),
  ADR-0149 (JF-4A Mastra), ADR-0150 (three-agent runtime), ADR-0151 (JF-5A scopes and prompts)

## Context

JF-5A left all three agents routable, grounded, prompted and evaluable — against deterministic fakes.
JF-5B is the measurement lane: prove the built architecture works with real providers, and produce
artifacts an owner can seal.

## Decision

### 1. JF-5A is merged and final

PR #202 merged at `33ed51f`, second parent exactly the owner-reviewed `015430c`. Re-proved from merged
main: all four agent-scope vocabularies are `CLIENT, VENDOR, PROSPECT, COORDINATION, SYSTEM`; the three
prompt digests are `d0c2da57…`, `ba7c6ecc…`, `0377569e…`; the production knowledge pack holds 0 records.

### 2. JF-5B is live evaluation only, never activation

No production seal. §24 below is the hard rule.

### 3–5. Synthetic fixtures only; no QuickFurno, no OneDecore

Every fixture is invented for the run and says so. No customer or vendor record, PII, payment, phone,
email, lead, package, credit balance, consent state or production business record is sent to any
provider. The preflight summary states this before the confirmation is typed.

### 6–9. One gateway, one router, retry zero

Provider selection stays entirely inside the QF Model Gateway. `AUTO` / `GROQ_ONLY` / `NARA_ONLY` are
unchanged, `AUTO` remains Groq first then at most one Nara attempt under the existing bounded
cross-provider rule, and same-provider retry remains **0**. Nothing in this lane changes any of them.

A containment spec proves the orchestration lock as a SCAN rather than a promise: no Mastra workflow
file names a provider, holds a credential, constructs a client, or has an external send surface; the
JF-4A one-step closure workflow is reused, adds no model call of its own and carries no retry.

### 10–12. Bounded authenticated Nara discovery — the one thing JF-5B adds

The audit found the repository had a Groq smoke, a masked-TTY secret primitive, a Nara chat transport
with alias refusal, a gateway that owns selection, and an evaluation framework. It had **no
authenticated `/v1/models` call anywhere**. That is the entire production-shaped delta of this lane.

One fixed HTTPS URL in code, Bearer from the redacting key holder, bounded timeout, bounded bytes
(1 MiB), page cap 4, **no retry**, sanitized errors, response stored only outside the repository.

Discovery refuses rather than repairs: a payload that is not a model list selects nothing. Aliases are
filtered by the provider's **own** `isNaraRouterAlias` — reused, not restated — plus a stricter rule
discovery needs (a selection word in ANY path segment) and a `combo/` exclusion. Duplicates, malformed
ids and non-chat models are dropped with a closed reason each.

The shortlist rule is declared before execution and is deterministic: every candidate must STATE a
context length meeting the Jarvis request bound; order by stated context descending, then exact alias;
cap at five. If the authenticated metadata states no capability field, this **stops** with
`metadata-insufficient-for-truthful-shortlist` rather than ranking by brand name — a heuristic over
vendor names is an opinion wearing a rule's clothes.

Selection ranks only models that passed every hard safety/contract gate, by: task quality, then p95
latency, then tokens, then exact alias order. Nothing passing is a stop, not a winner.

### 13. Nara strict-JSON stays `false`

`NARA_SUPPORTS_STRICT_JSON_SCHEMA` is unchanged. A few successful structured replies do not establish
that an endpoint accepts the strict keyword surface; the Groq adapter needed a 437-line projection
table to learn that lesson once. Structured output is validated against the real gateway schema, and a
malformed structure is a certification failure with no retry.

### 14. No ZDR claim

The observed Nara posture is recorded as a reference, truthfully: content is forwarded to the underlying
model provider; Nara states it does not train its own models on it and does not sell it; content may be
retained for a limited period for abuse detection, debugging and legal obligations; request logs and
usage records are retained for defined operational periods; providers and infrastructure may process
data internationally. The preflight prints this and says explicitly that it is **not** zero retention.
Owner acceptance of the posture is a JF-5C step.

### 15–17. Three prompt bodies, six bindings, and AUTO is not a seventh

An `ApprovalEvidence` carries one `EvaluationBinding`, which carries one prompt digest. There are three
distinct production prompt bodies. So two providers need **SIX** bindings — Groq and Nara, each against
Riya, Anisha and Aarohi — and the manifest schema enforces exactly six entries, exactly one per pair,
with **distinct prompt digests per provider**. A manifest whose three entries for one provider shared a
digest is refused: that is the "one prompt stands in for three" shortcut wearing the shape of coverage.

AUTO failover is a routing and reliability result. It is not a prompt approval and replaces none of the
six.

### 18–19. Historical evidence is immutable; the Riya operator is not rewritten

The earlier Riya Groq candidate release and its receipts are left exactly as they are — editing them so
this lane looks current would rewrite what an earlier run measured. JF-5B pins its own release
identities with its own dated catalogue observation label. `@qf-jarvis/riya-candidate-evidence-live` is
reused unchanged; it is not destructively generalized.

The catalogue label is an OBSERVATION, not a weight hash: neither provider publishes an immutable
identifier for the weights behind an alias, so claiming one would be a fabricated identity.

### 20. Raw artifacts live outside the repository

The output directory must be absolute and must resolve outside the repository root — checked on the
resolved path, so a symlink, junction or `..` walk cannot land inside by a route the string did not
show. Raw output and the blinded review bundle are never committed; only content-free receipts and
digests are reported.

### 21–23. No live calls in CI; double opt-in; bounded calls and cost

A live run needs BOTH `--execute-live` AND the phrase `EXECUTE_JF5B_LIVE` typed at a TTY after the
preflight summary. The phrase is **refused** if it appears in argv — two gates with the same key is one
gate. A containment spec proves no workflow, script, spec or package carries the flag.

Ceilings: 120 Groq calls, 120 Nara calls, 200 total, **USD 10** maximum, with the spend ceiling capped
at 10 by the schema rather than by convention. The ledger refuses the next reservation when a bound is
reached and a refused reservation does not advance it. The operator never retries; a person may start a
NEW run after reading a failure.

### 24. No `productionApproval=true` in JF-5B

The coverage manifest has no production-approval field, no provider-level approved boolean and no
activation token, and its schema is strict so one cannot be added as a passenger. A dimension nobody has
reviewed says `REVIEW_PENDING`; it never says `PASS`.

### 25. JF-5C owns the seal and the coverage closure

JF-5C ingests the blinded human reviews, records owner acceptance of the Nara data-controls posture,
closes provider-level prompt coverage honestly across all six bindings, and only then seals.

## WHAT WAS ACTUALLY MISSING

One production file changed. Everything else added is an evaluation-only leaf or a spec.

**`packages/model-gateway/src/index.ts`** — exported `isNaraRouterAlias` and
`NARA_REFUSED_ROUTER_ALIASES`.

- _Existing component reused:_ the guard itself, unchanged, and every behaviour around it.
- _Exact missing seam:_ the guard was module-internal, reachable only by `createNaraProviderConfig` and
  by specs inside the gateway package. Authenticated discovery adds a caller that can be neither: an
  operator outside the package must refuse a router alias returned by `/v1/models` **before** it can
  build a config to be refused by, and `createNaraProviderConfig` needs a key and a transport it does
  not have at that point.
- _Why existing code could not satisfy it:_ the only alternative was a second alias list in the
  operator — a second answer to "may Jarvis pin this", which would drift from the first the moment
  either changed.
- _Smallest change:_ two additive exports of a pure predicate and its frozen list. No key, no transport,
  no configuration, no behaviour change. The error normalizer and the strict-schema declaration stay
  internal, exactly as before.
- _No competing implementation:_ a spec asserts discovery calls the gateway's guard and holds no list
  of its own.

## REUSED WITHOUT MODIFICATION

Jarvis trusted runtime · Mastra orchestration boundary and the JF-4A one-step workflow · Riya, Anisha
and Aarohi behaviour and domains · the Aarohi→Anisha Core-ACTIVE handoff · actor/party routing · durable
conversation state · continuity and idempotency · pause and takeover · Core authority · the QF Model
Gateway and all provider selection · the Groq and Nara provider adapters · `ProviderMode` and the
Groq→Nara fallback policy · retry=0 · the prompt registry · all three production prompts · the
model-evaluation framework and its evidence verifier · governed RAG and the JF-3 provisioner · the
production knowledge pack mechanism · `@qf-jarvis/groq-staging-smoke` · `@qf-jarvis/riya-candidate-
evidence-live` · `@qf-jarvis/riya-candidate-evaluation-runner`.

## Consequences

Positive: the certification harness is complete, fully tested with zero network calls, and the live run
is reduced to one owner-operated command whose every gate, bound and refusal is already proved.

Negative, and accepted:

- **The live run has not happened.** By design: both gates require an interactive terminal. Until it
  does, the six bindings have no live results and JF-5C cannot seal.
- **One production export was added.** Additive, pure, and the alternative was worse.
- **A new evaluation-only package exists.** It is off the serving path, and a spec proves no production
  package or app imports it.

## Next

**JF-5B live execution**, by the owner, at a terminal. Then **JF-5C** — owner production evidence seal.
