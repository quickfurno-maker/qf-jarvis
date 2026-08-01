# ADR-0072 — Versioned Prompt Registry Foundation

**Status:** Accepted — QFJ-S3-I-A (registry foundation; runtime binding deferred to S3-I-B)
**Deciders:** Owner
**Relates to:** [ADR-0012](./ADR-0012-runtime-contract-validation.md) · [ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md) · [ADR-0050](./ADR-0050-qfj-p04-02-model-capability-registry.md) · [ADR-0052](./ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) · [ADR-0057](./ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) · [ADR-0067](./ADR-0067-riya-client-sales-behaviour-boundary.md) · [ADR-0070](./ADR-0070-anisha-vendor-journey-behaviour-boundary.md)

## Context

S3-I is an internal engineering slice, **not** a canonical roadmap phase — `S3-I` appears nowhere in
`qf-jarvis-roadmap-v3.md`. The canonical capability it serves is the governance rule in
`agent-model.md:204` and **ADR-0016**: _"A prompt version is a thing a human changed and a reviewer
saw… These contracts record a version; they grant no ability to set one."_

The S3-I Part 0 audit found that the repository cannot currently keep that promise. In
`model-reply-adapter/src/adapter/build-gateway-request.ts` the request is assembled as:

```
messages: [{ role: 'system', content: REPLY_PROMPT_CONTRACT }, …]
promptId: plan.promptFamily,
promptVersion: String(plan.promptVersion),
```

The body is a module constant. The identity comes from deployer configuration. **They are assembled
independently and never compared**, so today it is possible to change the version without changing the
content, change the content without changing the version, use one body under many identities, and —
the one that matters — run a green evaluation against an identity whose text was never the text that
executed.

`@qf-jarvis/contracts` already anticipated this: `promptDigestSchema` exists as a lowercase 64-hex
SHA-256 and is documented as existing so "a later phase can prove that the prompt in the registry today
is byte-for-byte the prompt that ran." S3-I is that phase.

## Decision

### 1. A new leaf package, and only a mechanism

`@qf-jarvis/prompt-registry`, depending on `zod` only:

```
prompt-registry  ->  zod   (+ node:crypto, a Node built-in, internally)
```

Nothing imports it yet. S3-I-B will add `model-reply-adapter -> prompt-registry`. It is a true leaf
with **no** project references: it knows nothing of agents, the runtime, the gateway, providers, Core,
evaluation, WhatsApp, n8n, a database or deployment — which is precisely what will let S3-I-B depend
on it from M4 without inverting anything.

**S3-I-A changes no model request, no system message, no runtime and no evaluation behaviour.**
`REPLY_PROMPT_CONTRACT` is untouched. The identity/content drift above is **not fixed by this PR**;
this PR builds the thing that will fix it.

### 2. The definition binds identity to bytes

```ts
PromptDefinition {
  registryVersion: 1
  promptId          // exact, 1–128, [A-Za-z0-9._:-], no '*', not 'latest'
  promptVersion     // integer 1–1_000_000
  agentScope        // CLIENT | VENDOR | COORDINATION | SYSTEM
  taskClass         // exact identifier, same grammar
  resultMode        // STRUCTURED | TEXT
  systemTemplate    // literal, 1–16_384 chars, no NUL
  contentDigest     // lowercase 64-hex SHA-256 of systemTemplate
}
```

`PromptDefinitionInput` accepts the first six fields **only**. `registryVersion` and `contentDigest`
are stamped by the constructor, so **there is no field in which a wrong digest could be supplied** —
which is what makes the binding real rather than conventional.

`registryVersion` is the schema version. It is not a prompt version, an evaluation version, a provider
version, a rollout mode or business authority.

`promptVersion` is numeric to match `JarvisRuntimeConfig`, `ModelReplyPort`, `ModelReplyAdapterConfig`
and `EvaluationBinding` exactly; the gateway continues to serialize it to a string at its own wire
boundary. There is deliberately no `promptFamily` field alongside `promptId` — one name for one
concept. S3-I-B maps the existing `promptFamily` onto `promptId` without renaming M4's public API in
the same PR.

`agentScope` mirrors the gateway's scopes without importing them, so the package stays a leaf; **S3-I-B
will assert exact compatibility with `MODEL_AGENT_SCOPES`**. There is no `HUMAN` scope, because a human
turn never reaches a model.

`taskClass` is an exact identifier and deliberately **not** a new closed vocabulary. The runtime
exposes `taskClass?: string` with `RESPONSE_GENERATION` as today's default, and the repository has
never governed a finite global list. Inventing one here would lock a vocabulary this phase has no
authority over.

### 3. The digest is content, and only content

SHA-256 over the UTF-8 bytes of `systemTemplate`, lowercase hex. The template is hashed **exactly as
supplied** — no trimming, whitespace collapsing, line-ending normalization or Unicode normalization.
A reviewer approved specific bytes; tidying them would mean the digest attests to text nobody read.

**`systemTemplate` must be a well-formed Unicode scalar-value sequence.** Unpaired UTF-16 surrogates
are rejected; valid surrogate pairs and supplementary code points (emoji, CJK, accented text) are
accepted unchanged.

This rule is what makes the byte-exact claim truthful. Node's UTF-8 encoder replaces **every**
unpaired surrogate with U+FFFD before hashing, so `\uD800`, `\uD801` and `\uDC00` all encode to the
same three bytes `ef bf bd` and therefore share one digest — three distinct JavaScript strings, one
digest, and not because SHA-256 failed. Without the guard the package would promise exact content
binding while the encoder quietly collapsed the input.

Ill-formed templates are **refused, never repaired**. `toWellFormed()` or any other substitution would
hash text the reviewer never wrote, which is the same defect wearing a different hat. The check runs
**before** the digest is computed, so no lossy encoding can occur, and it applies equally in
`createPromptRegistry`, where a forged materialized definition carrying the lossy digest is rejected
rather than accepted on a matching-but-meaningless comparison.

After this validation, SHA-256 over UTF-8 is a truthful byte-level content binding for every accepted
template.

The digest covers **the template alone** — no id, version, scope, task, result mode, salt or JSON
wrapper. That is the point: it answers "what system-template bytes were reviewed and executed?", and
hashing a metadata wrapper would make an id rename look like a content change, destroying the very
signal the digest exists to give. Identity is bound separately, by the definition record.

### 4. Why `node:crypto`, and why it stays internal

The FNV-1a helpers elsewhere (M3 idempotency, ADR-0069 proposal ids) are deliberately
non-cryptographic: they answer "is this the same tuple?", where a collision is a nuisance. This digest
answers "is this the exact text a human reviewed?", where a collision would let unreviewed
instructions execute under a reviewed identity. It must also satisfy the already-governed
`promptDigestSchema` (`^[a-f0-9]{64}$`), which a 32-hex FNV value cannot.

`node:crypto` is a deterministic local CPU primitive — no network, provider, environment, randomness
or clock. The ADR-0012 restriction on Node built-ins applies to `@qf-jarvis/contracts` performing I/O
and does not apply here. No crypto npm dependency was added.

`promptContentDigest` is **internal and unexported**: a caller who could compute a digest could also
supply one, and a supplied digest is exactly the forgery this package makes impossible.

### 5. The registry is immutable and exact

`createPromptRegistry(definitions)` re-validates every supplied materialized definition rather than
trusting the type: exact own-key set, `registryVersion === 1`, every scalar re-checked, and — the
decisive step — the supplied `contentDigest` must equal the SHA-256 of the supplied template. A
definition whose digest does not match its own bytes is **refused, not recomputed**. Each is rebuilt
through the constructor, so the registry holds canonical frozen objects and never the caller's.

`(promptId, promptVersion)` is a **global** identity. Two definitions sharing it are rejected even
when byte-identical, and regardless of scope, task or result mode: a version identifies one exact
definition or it identifies nothing, and letting a version mean different things in different scopes
would reintroduce the drift one level down.

Order is canonical — `promptId` ascending, then `promptVersion` numerically ascending — never caller
order. The registry, its definitions array and every definition are frozen, and it exposes no
`register`/`add`/`remove`/`update`/`activate`/`retire`/`reload`/`refresh`/`fetch`/`save`/`persist`
method. A prompt set that can change while the process runs is a prompt set nobody approved.

**An empty registry is allowed.** A zero-definition registry is a coherent not-yet-activated
foundation, and refusing it would force this phase to invent the production content it is explicitly
not authorized to add.

### 6. Resolution is exact, with no fallback

`resolve(request)` matches `promptId` + `promptVersion` exactly, then requires `agentScope`,
`taskClass` and `resultMode` to match as well. No `latest`, no nearest/lower/higher version, no
cross-scope or cross-task substitution, no result-mode coercion.

A **well-formed miss returns `undefined`**; only a structurally **malformed** request throws
`invalid-resolution`. That distinction is deliberate: it lets S3-I-B normalize a genuine miss through
the existing M4 fail-closed boundary rather than inventing a second error path.

### 7. No lifecycle, no template engine, no production prompt

There is no `DRAFT`/`APPROVED`/`ACTIVE`/`RETIRED`/`DISABLED`/`CANARY` state, no `status` and no
`approvalStatus` — the audit found no governed prompt lifecycle, and inventing one here would create
an approval concept nobody ratified. A definition existing is **not** production approval.

**Prompt definition ≠ evaluation evidence ≠ provider rollout approval ≠ production selection ≠
business authority.** Those five stay five.

No variables, placeholders, interpolation, `render()`, or template library. `systemTemplate` is
literal text; the normalized conversation remains a separate user message in M4 and knowledge remains
separate citations. A future need for variables gets its own reviewed contract, not an ambiguity about
whether the digest covers source or rendered text.

**No production QuickFurno prompt definition is added.** Every string in this package's tests is
clearly synthetic, and no copy of `REPLY_PROMPT_CONTRACT` exists here.

### 8. What S3-I-A deliberately does not touch

Riya's and Anisha's behaviour `promptRef` keep their current semantics exactly: bounded opaque
behaviour-layer traceability, validated and carried on the decision, **not** the executed model-prompt
identity, not mapped into `ModelRequest`, `structuredIntent` or provenance. `packages/riya-agent` and
`packages/anisha-agent` are unchanged.

`JarvisProvenanceRefs.promptRef` keeps its current semantics: optional, caller/deployment supplied,
opaque, provenance-only. It is **not** derived from this registry, and `jarvis-runtime` is unchanged.

`model-evaluation` is unchanged. S3-I-B is expected to add an additive exact `promptDigest` binding
once runtime resolution exists.

## Rejected alternatives

- **Registry inside `model-reply-adapter`.** Makes M4 the prompt-content owner and blocks evaluation
  reuse without an M4 dependency.
- **Registry inside `jarvis-runtime`.** Puts prompt content in the composition root, unreachable from
  evaluation.
- **Extending `@qf-jarvis/contracts`.** Would break its 369-symbol lock, and ADR-0012 forbids it
  computing a digest.
- **Keeping the hard-coded constant.** The defect itself.
- **Hashing a canonical-JSON wrapper.** Would make a metadata edit look like a content edit.
- **FNV-1a for consistency with M3/ADR-0069.** Not collision-resistant, and cannot produce 64 hex.
- **A lifecycle state now.** Ungoverned, and it would smuggle in an approval concept.

## Consequences

A prompt can now be defined at an exact version with its content bound by a cryptographic digest, and
a registry of such definitions is immutable and exactly resolvable. Every existing API lock is
unchanged; the new package is locked at 7 root runtime symbols.

## Phase status

**S3-I-A only.** The runtime still executes the hard-coded `REPLY_PROMPT_CONTRACT`, and the
identity/content drift is **not yet fixed**. **S3-I-B** will remove that constant, resolve the exact
definition, build the system message from resolved content, bind the request identity and digest to
that content, enforce scope/task compatibility, and align evaluation and provenance — with the
one-model-call, one-proposal and Core-authority invariants unchanged.

**NO_MIGRATION_REQUIRED**: migrations remain exactly `0001`–`0007`, no `0008`. The registry is
in-memory only — no prompt database, no remote prompt-management API, no dashboard editor, no
environment prompt body. **Production rollout remains OFF.**

## Non-goals

No runtime binding · no production prompt · no lifecycle or ACTIVE state · no template engine · no
persistence, database, Supabase or migration · no network, provider or live model call · no credential
or environment read · no deployment or activation · no CANARY/ACTIVE/FALLBACK · no RAG · no WhatsApp ·
no n8n · no memory · no send, execute or persist.

## Change-control rule

The digest is computed here and never supplied. `(promptId, promptVersion)` stays a global identity.
Resolution stays exact — adding a fallback, a `latest`, a nearest-version rule or a cross-scope
substitution requires an ADR amendment. The registry stays immutable after construction, `systemTemplate`
stays literal, and prompt definition never becomes approval, evaluation, rollout or business authority.
