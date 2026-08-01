# ADR-0073 — Authoritative Prompt Binding

**Status:** Accepted — QFJ-S3-I-B (registry bound into the one authoritative model-reply path)
**Deciders:** Owner
**Relates to:** [ADR-0012](./ADR-0012-runtime-contract-validation.md) · [ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md) · [ADR-0052](./ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) · [ADR-0057](./ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) · [ADR-0059](./ADR-0059-qfj-m5-jarvis-runtime-composition.md) · [ADR-0065](./ADR-0065-qfj-s2e-controlled-shadow-runner.md) · [ADR-0070](./ADR-0070-anisha-vendor-journey-behaviour-boundary.md) · [ADR-0072](./ADR-0072-versioned-prompt-registry-foundation.md)

## Context

[ADR-0072](./ADR-0072-versioned-prompt-registry-foundation.md) built `@qf-jarvis/prompt-registry` and
said plainly what it had not done:

> **S3-I-A only.** The runtime still executes the hard-coded `REPLY_PROMPT_CONTRACT`, and the
> identity/content drift is **not yet fixed**.

The drift is in `model-reply-adapter/src/adapter/build-gateway-request.ts`. The system message came
from a module constant; `promptId`/`promptVersion` came from deployer configuration; the two were
assembled independently and never compared. So a request could truthfully name a version whose bytes
it was not sending, and a green evaluation could attest a prompt that never ran.

Nothing about that is hypothetical. `apps/api/src/shadow/shadow-evidence-generator.ts` already carried
its own `SHADOW_EVALUATION_PROMPT_FAMILY = 'qfj.s2e.synthetic.shadow'` alongside
`SHADOW_PROMPT_ID = 'qfj.s2e.synthetic.shadow.v1'` in `shadow-request.ts` — two hand-maintained
identities for one prompt, already disagreeing, with nothing in the type system to notice.

This ADR closes the gap: the bytes that execute, the identity that names them, and the evaluation that
attests them are the same object.

## Decision

### 1. `REPLY_PROMPT_CONTRACT` is deleted, not relocated

There is no hard-coded prompt body left in `model-reply-adapter`, and no default registry anywhere. A
model-backed draft resolves a `PromptDefinition` or it refuses. `buildGatewayRequest` no longer knows
how to produce a system message on its own:

```ts
buildGatewayRequest({ plan, prompt, requestedAt, budgets })
  messages:      [{ role: 'system', content: prompt.systemTemplate }, { role: 'user', … }]
  promptId:      prompt.promptId
  promptVersion: String(prompt.promptVersion)
  promptDigest:  prompt.contentDigest
```

Identity, digest and body now come from one object, so they cannot disagree. As a second line of
defence the function still compares the plan's identity, task class and result mode against the
supplied definition and throws `ModelReplyAdapterError('invalid-request')` on any mismatch — a caller
that resolved the wrong definition fails here rather than reaching a provider.

### 2. `promptDigest` is required on the gateway request and provenance

`ModelRequest.promptDigest` and `ModelRunProvenance.promptDigest` are **required** lowercase 64-hex
fields, validated by the existing `promptDigestSchema` grammar. Required, not optional: an optional
digest is a field that is absent exactly when someone did not bind the content, which is the case that
needed catching. The gateway copies the request's digest into provenance, so the run record says which
bytes ran.

### 3. Resolution happens once, in one place, and fails closed

`model-reply-adapter/src/adapter/resolve-prompt.ts` is the only place the executed prompt is chosen. In
order: registry present (else `model-adapter-unavailable`) → the gateway and registry scope
vocabularies are the same set (else `model-invariant`) → actor mapped to scope → exact
`registry.resolve(...)` (else `model-plan-invalid`) → the evaluation pair agrees (else
`model-plan-invalid`).

No nearest version, no `latest`, no cross-scope or cross-task substitution, no fallback of any kind. A
miss is a refusal, because quietly sending a different prompt is the failure this module exists to
prevent.

The scope-vocabulary check is where ADR-0072's deliberate duplication is held honest. S3-I-A
duplicated the four scope strings so `prompt-registry` could stay a leaf importing nothing; this is the
first boundary where `MODEL_AGENT_SCOPES` and `PROMPT_AGENT_SCOPES_FROZEN` are both visible, so it is
where a drift between them becomes a refusal instead of confusing provider behaviour.

### 4. The evaluation reference must say which bytes it covers

`EvaluationBinding.promptDigest` is **required**, and it participates in `bindingsMatch` and in the
`suiteResultDigest` material. A binding that names a prompt family and version but not its content is
the exact gap this ADR closes.

M4 enforces the pairing per turn: `evaluationRef` and `evaluationPromptDigest` are both absent (fine —
an unevaluated prompt is a separate governance question) or both present and matching the resolved
definition. A half-supplied pair is refused rather than half-trusted.

### 5. One runtime serves every agent: per-scope prompt bindings

A `PromptDefinition` is scope-bound and `(promptId, promptVersion)` is globally unique. That makes the
legacy single `promptFamily` able to serve exactly **one** agent scope — a runtime configured for Riya
would refuse every Anisha turn.

The alternative on offer was one runtime instance per scope. That was **rejected**: it duplicates the
composition root and, worse, moves "which agent is this?" outside M1, where ADR-0055 says assignment
happens exactly once.

Instead M2 reuses the assignment it has already made and asks the one port which prompt is configured
for that actor:

```ts
// agent-runtime/src/orchestration/model-reply-port.ts
selectPromptIdentity?(request: { assignedActor: RuntimeActor; taskClass: string }):
  { promptFamily: string; promptVersion: number; evaluationRef?: string } | undefined
```

This is **not a second router**. `assignAgent` decided the actor; nothing in the selector can change
it, and the selector cannot see the party type, the envelope or the conversation. It is a
configuration lookup keyed by a decision already made.

`orchestrateInbound` calls `selectModelPromptIdentity` exactly once per turn, before
`createReplyPlan`. `undefined` emits a content-free `model-invocation-skipped` and refuses with
`orchestration-model-unavailable` — refusing beats borrowing another agent's prompt. The selected
identity is what `requireEvaluationRef` now gates on, so one scope may be evaluated while another is
not, which the port-wide field could never express.

M4 exposes the selector only in per-scope mode, from `ModelReplyPromptBindings` (`CLIENT`, `VENDOR`,
`COORDINATION`, `SYSTEM` — no `HUMAN`, because a human turn never reaches a model).

### 6. Exactly one configuration shape, never a merge

A config declares the legacy single identity **or** per-scope bindings. Supplying both is refused, at
`assertMandatoryDependencies` in the composition root and again at the M4 boundary. Merging would have
to pick a winner for any scope named in both, and every possible answer silently sends some agent a
prompt its deployer did not choose. An empty bindings object is likewise refused: it configures no
agent at all, which is a wiring error rather than a policy.

The legacy shape is **not retired**. Every existing deployment uses it, and it keeps working
unchanged.

### 7. The invariants that did not move

One `createJarvisRuntime` → one `composeAndProcess` → one `createOrchestrator` → one `runAgentTurn` →
one `orchestrateInbound`. One agent assignment, in M1. One model call per turn, with no adapter-owned
retry, fallback or provider selection. One proposal. One Core decision, with Core still the only
authority. Both state gates still run. Prompt resolution adds no authoritative-state read and no
network call.

Observability carries the prompt **digest**, never the template. An event carrying the prompt body
would make the log the one place system instructions leak.

### 8. The `apps/api` shadow exception

Making `EvaluationBinding.promptDigest` required forces a change in
`apps/api/src/shadow/shadow-evidence-generator.ts`, which is production source backing the
`qfj-generate-shadow-evidence` bin. This was reported before it was written, and a narrow exception was
authorised for exactly four files.

`SHADOW_SYSTEM_PROMPT`'s text is **unchanged**. It is now wrapped in a real `createPromptDefinition`,
so its digest is genuinely SHA-256 of the bytes that are sent — no placeholder, no invented value. The
evidence generator's divergent `SHADOW_EVALUATION_PROMPT_FAMILY`/`_VERSION` constants are deleted and
the binding now reads `SHADOW_PROMPT_DEFINITION.promptId`/`.promptVersion`/`.contentDigest`. That
corrects the pre-existing drift described in Context rather than preserving it.

## Rejected alternatives

- **Relocating `REPLY_PROMPT_CONTRACT` into the registry as a "default production prompt."** A default
  prompt is a production prompt nobody chose. Explicitly out of scope for this phase.
- **Making `EvaluationBinding.promptDigest` optional.** Optional exactly where it matters least: it
  would be absent precisely when someone forgot to bind content.
- **A placeholder digest for the shadow prompt.** A fake digest is worse than no digest — it looks like
  a proof.
- **Deferring evaluation binding to S3-I-C.** Would ship a phase whose stated purpose is "the
  evaluation attests the bytes that ran" without the evaluation attesting the bytes that ran.
- **One runtime instance per agent scope.** Duplicates the composition and moves agent selection
  outside M1. See §5.
- **Party-type-based prompt selection inside M4.** A second router, disagreeing with M1 by
  construction.
- **Merging legacy and per-scope config.** See §6.
- **A `latest` or nearest-version fallback on resolution miss.** The defect, wearing a hat.

## Consequences

The executed system prompt, the identity reported to the provider, the digest recorded in provenance
and the digest an evaluation attests are now the same bytes, enforced by construction rather than by
convention. One runtime can serve Riya and Anisha with different prompts. A missing registry, an
unresolvable version, a wrong scope, a mismatched evaluation digest or a half-supplied evaluation pair
each refuse before any provider is reached.

Every package-root runtime API count is unchanged: contracts 369, model-evaluation 33, model-gateway
71, model-gateway-composition 2, groq-staging-smoke 24, event-backbone 39, agent-runtime 45,
model-reply-adapter 8, core-decision-adapter 18, jarvis-runtime 6, riya-agent 16, anisha-agent 14,
prompt-registry 7, apps/api 0. The new M2 and M4 modules are internal and exported from neither root.

Known follow-up: `packages/prompt-registry/src/index.ts` still carries an S3-I-A doc comment saying
`REPLY_PROMPT_CONTRACT` "is untouched, and S3-I-B is where it is replaced." That sentence is now stale.
`prompt-registry` is a forbidden production path for this phase, so it was left alone rather than
edited outside scope.

## Phase status

**S3-I-B.** No production prompt is registered, no rollout is activated, and no provider is reached.
The synthetic SHADOW prompt is the only definition constructed in production source, it is
`SYSTEM`-scoped and clearly synthetic, and it is unchanged in content.

**NO_MIGRATION_REQUIRED**: migrations remain exactly `0001`–`0007`, no `0008`. The registry is
in-memory only — no prompt database, no remote prompt-management API, no dashboard editor, no
environment prompt body. **Production rollout remains OFF.**

## Non-goals

No production QuickFurno prompt · no prompt lifecycle or ACTIVE state · no template engine or variable
interpolation · no persistence, database, Supabase or migration · no network, provider or live model
call · no credential or environment read · no deployment or activation · no CANARY/ACTIVE/FALLBACK ·
no RAG · no WhatsApp · no n8n · no memory · no send, execute or persist.

## Change-control rule

The system message is built from a resolved `PromptDefinition` and from nothing else. Reintroducing a
module-constant prompt body, a default registry, a `latest` or nearest-version fallback, a cross-scope
or cross-task substitution, an optional `promptDigest` on the request, provenance or evaluation
binding, or a merge of the two configuration shapes each require an ADR amendment.
`selectPromptIdentity` stays a lookup keyed by the actor M1 assigned — giving it the envelope, the
party type or the conversation would make it a router, and requires an ADR amendment. Prompt
definition never becomes approval, evaluation, rollout or business authority.
