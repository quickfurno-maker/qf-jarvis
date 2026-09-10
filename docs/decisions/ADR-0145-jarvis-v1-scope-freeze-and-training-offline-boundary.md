# ADR-0145 — JF-1: Jarvis Production V1 scope freeze and the training-offline boundary

- **Status:** Accepted — records decisions and adds one containment test. **Activates nothing.** No
  provider is implemented, no provider is contacted, no composition is activated, no runtime behaviour
  changes, no dataset moves.
- **Date:** 2026-09-10
- **Baseline:** `origin/main` at `f4a963bb4f9e5fd40e9a7278a225a57c2d7310ce` (PR #195). Migrations
  `0001`–`0013`. **JF-1 adds none.**
- **Depends on:** ADR-0045/0048 (provider selection, hybrid routing and bounded failover), ADR-0051
  (governed knowledge), ADR-0053 (no-op RAG provisioning), ADR-0062/0063 (production composition and
  evaluation evidence), ADR-0097 (private Riya web ingress), ADR-0107 (dataset foundation and leakage
  firewall), ADR-0108 (Human Gold authoring), ADR-0114–0121 (Jarvis Autonomy Operations / Mastra),
  ADR-0143/0144 (AI-synthetic training lane and external intake provenance)
- **Supersedes:** nothing. Every ADR listed above remains historical truth and is not rewritten.

## Context

The roadmap had grown a tail. Native models, local GPU inference, fine-tuning, distillation, a provider
marketplace and a long list of specialist agents all sat between the repository and a launched product,
and none of them is required to answer a customer's first message.

At the same time the repository is further along than the prose suggested. The model gateway already
owns provider selection, bounded failover, a circuit breaker and an attempt ledger. The Groq adapter is
complete. The Riya conversation path exists end to end. The private web ingress exists, authenticated
and replay-protected. Four separate evaluation authorities exist. What is missing for a launch is
narrow and nameable.

This ADR does two things and no more: it writes down what Production V1 **is**, and it turns one
property the repository currently has by luck into a property it has by construction.

### The failure this ADR is written against

The obvious way to "finish Jarvis" is to keep building toward the roadmap's end state and launch when it
is done. That end state includes training a model on customer conversations. The distance between "the
runtime can read the corpus" and "the corpus is fed by the runtime" is a single dependency edge, and
nothing in the repository currently prevents it — the isolation holds because nobody has needed it yet.
A boundary that exists only as an intention is not a boundary, and the day it fails is the day live
customer chat becomes training data without anybody deciding that it should.

## Decision

### 1. Jarvis Production V1 architecture

```
Jarvis trusted runtime
  → Mastra orchestration boundary
    → governed RAG / context assembly
      → thin QF Model Gateway
        → Groq            PRIMARY
        → NaraRouter      automatic fallback / manual alternative
```

**Provider selection is owned by the QF Model Gateway and by nothing else.** Groq is the intended
primary for normal production inference; NaraRouter is the intended secondary and automatic fallback.
The target provider-mode surface is `AUTO` / `GROQ_ONLY` / `NARA_ONLY`, with `AUTO` trying Groq first
and failing over to Nara only for normalized provider or infrastructure failures under a bounded policy.

The existing provider-neutral contracts remain the sole inference-routing authority. Mastra, Riya,
Anisha, Aarohi, QuickFurno and every other consumer contain no provider-specific routing logic, hold no
provider credential, and import no provider adapter. This is already true and stays true.

**JF-1 implements none of this.** Nara does not exist after this ADR; `ProviderMode` does not exist
after this ADR; routing order is unchanged.

### 2. Mastra is inside the V1 customer runtime boundary — as a boundary, not a brain

Mastra **is** part of Production V1's customer runtime. It is a bounded orchestration and delegation
layer above the trusted kernel, and it is subject to these limits:

- it must not perform an extra model reasoning call on every turn;
- deterministic and simple turns may pass through a thin orchestration seam without extra autonomous
  work — Mastra becomes active only where orchestration or delegation is actually needed;
- it must not duplicate Riya's state, memory, prompt ownership, RAG or extraction;
- it must not become a provider router, hold a provider credential, or select a model;
- it must not become a second Jarvis, a second Riya, a duplicate state machine or a duplicate
  RAG/memory;
- it must not hold business execution authority, and it must not bypass conversation pause or human
  takeover;
- all inference continues through the QF Model Gateway.

Today Mastra sits in `apps/worker` under the Jarvis Autonomy Operations lane (ADR-0114–0121), oriented
at founder-facing operations in shadow mode, and it is not on the Riya customer path. **JF-4 implements
and certifies the customer-path composition. JF-1 records the decision and changes nothing.**

### 3. Production gateway activation requires its own evidence-gated slice

The production composition (`@qf-jarvis/model-gateway-composition`, ADR-0062/0063) is deliberately
**OFF-only**: it refuses a mode other than `OFF`, refuses `allowFallback: true`, refuses a non-zero
default retry budget, and reports `activatable: false` with no method that could make it true.

That behaviour was correct for the slice that produced it and **remains valid history**. It is no longer
the intended final state of Production V1, which targets governed activation with Groq primary and Nara
fallback.

Lifting the OFF-only, fallback-disabled and retry-budget-zero restrictions **requires its own
owner-authorized, evidence-gated ADR and slice.** It is not done here, and it is not a side effect of
adding a provider. No test and no gate may be weakened in order to make activation possible; if a gate
stands in the way, the gate is the thing that gets an ADR, not a deletion.

### 4. Training is off for V1, and every asset is preserved

For Production V1: training is OFF, fine-tuning is OFF, LoRA/SFT is OFF. Native-model work and
local/self-hosted inference are **postponed, not removed**. There is no automatic self-training, no
automatic promotion of live customer conversations into a training corpus, no raw-chat training and no
chain-of-thought training data.

**No dataset, benchmark, Human Gold, synthetic, correction, evaluation, training-candidate,
local-pilot or historical model-development asset is deleted, archived or moved by this ADR.** They
remain versioned and auditable, and they remain available **offline** for later evaluation, regression,
fine-tuning, distillation, preference optimization and local/self-hosted model work.

**RAG is not training.** RAG is the Production V1 business-knowledge mechanism. Volatile QuickFurno
business truth — lead status, vendor credits, payment and package state, assignment outcome, consent and
suppression, identity, entitlements — remains authoritative through Core and tools, never through RAG
and never through model memory. Governed knowledge, conversational state and offline training data stay
four separate authorities.

### 5. QuickFurno handshake stays deferred

No QuickFurno or OneDecore code is touched before the Jarvis handshake contract is frozen at JF-7.

## The boundary this ADR makes structural

The rule, in full:

> **production runtime → no training/dataset-generation dependency**
> **offline evaluation → may consume approved datasets under existing governance**

`packages/contracts/src/tests/training-offline-containment.test.ts` enforces it. It reads `package.json` and
source; it executes nothing it names, reads no dataset content and opens no socket.

**Protected production runtime packages (9):** `api`, `worker`, `jarvis-runtime`, `agent-runtime`,
`riya-agent`, `riya-web-conversation-service`, `model-gateway`, `model-gateway-composition`,
`model-reply-adapter`.

**Offline-only training packages (3):** `riya-intelligence-dataset`, `riya-ai-synthetic-generation`,
`riya-ai-synthetic-provider-adapters`.

The suite proves eight things: that every classified name still resolves to a real package; that any new
package whose name looks like training or dataset work must be classified before it can land; that no
protected package reaches a training package through `dependencies`; that none reaches one through
`devDependencies` at any depth either; that no protected source file imports one; that no training
package reaches anything able to cause a side effect; that the training lane's reachable set equals an
exact pinned list; and that its own detector fires on a synthetic two-hop violation.

The offline **evaluation** lane — `model-evaluation`, `riya-quality-evaluation`, `riya-model-benchmark`,
`riya-model-benchmark-harness`, `riya-candidate-evaluation-runner`, `riya-candidate-evidence-live` — is
deliberately unconstrained, and a positive control asserts it stays that way. A containment test that
obstructed legitimate evaluation would be deleted within a quarter, and a deleted test protects nothing.

### One thing the boundary does NOT refuse, deliberately

The training packages **do** reach `riya-agent` and `agent-runtime`, through
`riya-conversation-continuity`. That is correct rather than tolerated. `riya-agent` is behaviour only —
it exports no runtime, no router, no state machine and no port — and `agent-runtime` supplies the closed
vocabularies and turn constructors a corpus is validated against. A dataset that reused neither would
restate the phase vocabulary and the annotation rules in a second place, and the copy would drift from
the runtime it claims to describe, which is the leakage ADR-0107's firewall exists to prevent.

**Reaching a vocabulary is not holding authority.** The distinction is load-bearing, so it is pinned
from both sides: a blocklist refuses the packages that can cause a side effect, and an allowlist pins
the training lane's reachable set exactly, so any new edge fails the suite whether or not somebody
anticipated it.

## Consequences

Positive:

- Production V1 has a written definition, so "is Jarvis done?" is answerable.
- The runtime cannot acquire a training dependency without a test failing and a human deciding.
- Every historical asset survives, and the post-V1 options that depend on them survive with them.
- Activation is a decision with a name and an owner rather than a configuration change.

Negative, and accepted:

- The two classification sets are declared rather than derived from a manifest the repository does not
  have. The name-pattern guard and the pinned closure bound the staleness; they do not eliminate it. If
  a package classification manifest is ever introduced, this test should consume it.
- Recording that Mastra is in the customer runtime boundary without implementing it leaves a documented
  gap between this ADR and the code until JF-4.

## What this ADR does not do

No provider implemented. No provider contacted. No `ProviderMode`. No routing change. No activation, no
fallback enablement, no retry-budget change. No RAG retrieval and no knowledge seeded. No Riya behaviour
change. No Mastra placement on the customer path. No ingress change and no server binding. No
deployment. No managed-database access and no migration. No QuickFurno and no OneDecore. No training,
and no dataset deleted, archived or moved.

## Next

**JF-2A** — NaraRouter `HOSTED` provider and the `ProviderMode` foundation over the existing routing
policy. **JF-2B** — the separate owner-authorized production gateway activation and fallback-enablement
slice.
