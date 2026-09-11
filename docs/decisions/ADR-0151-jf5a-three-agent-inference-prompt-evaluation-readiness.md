# ADR-0151 — JF-5A: three-agent inference, prompt and evaluation readiness

- **Status:** Accepted — **code only**. No live provider call, no credential read, no provider
  entitlement discovery, no production activation, no deployment, no QuickFurno integration.
- **Date:** 2026-09-11
- **Baseline:** `origin/main` at `fb1ed2b0c9019f2dce1ea02b3fea06d4d9d07cba` — the merge of PR #201
  (JF-4B/C/D, reviewed at head `64a0caa`). Migrations `0001`–`0014`; **JF-5A adds none.**
- **Governed by:** ADR-0145 (JF-1 scope freeze), ADR-0146/0147 (JF-2 gateway), ADR-0148 (JF-3 RAG),
  ADR-0149 (JF-4A Mastra), ADR-0150 (JF-4B/C/D three-agent runtime, as corrected)
- **Depends on:** ADR-0052 (model evaluation foundation), ADR-0070/0071 (Anisha), ADR-0073 (per-scope
  prompt identity), ADR-0085/0111–0113/0122–0128/0130 (Aarohi AVG-1…AVG-12), MVP-P2A.2-P (Riya prompts)

## Context

JF-4 left all three agents routable, decidable and grounded through one runtime and one governed RAG.
ADR-0150 §41 recorded the honest residue: Aarohi had no MODEL or PROMPT scope, so a model-eligible
acquisition turn reached the draft step and failed closed.

The audit that opened this lane found that gap was one of **three**, and that the third was the worst:

| Vocabulary                | Before                                 | Consequence                                                                                      |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `MODEL_AGENT_SCOPES`      | `CLIENT, VENDOR, COORDINATION, SYSTEM` | an acquisition request could not be made                                                         |
| `PROMPT_AGENT_SCOPES`     | the same four                          | an acquisition prompt could not be defined                                                       |
| `EVALUATION_AGENT_SCOPES` | the same four                          | **Aarohi could never be honestly evaluated, so she could never earn production evidence at all** |

And a fourth finding: **only Riya had a production prompt.** A repository-wide search for
`createPromptDefinition` in production source returned `riya-prompts`, the registry mechanism itself,
and the synthetic SHADOW probe. ADR-0071 had said so about Anisha and left it open; nothing had closed
it. A VENDOR turn reaching the model boundary resolved whatever single identity a deployment had
configured — which for every deployment is Riya's CLIENT prompt, and a CLIENT definition cannot serve a
VENDOR scope. The registry refused it. That refusal was correct, and it was the whole gap.

## Decision

### 1. JF-4 is merged and final

PR #201 merged at `fb1ed2b`, second parent exactly the owner-reviewed `64a0caa`. JF-5A branches from
that commit and redesigns none of it.

### 2. JF-5A is code-only

No Groq call, no Nara call, no `/v1/models`, no credential, no environment key, no provider entitlement
discovery, no activation, no deployment. Every model in this lane is a deterministic fake, and every
figure reported is a measurement of our own code.

### 3. `PROSPECT` joins all three inference/evaluation mirrors, together

```
MODEL_AGENT_SCOPES      = CLIENT, VENDOR, PROSPECT, COORDINATION, SYSTEM
PROMPT_AGENT_SCOPES     = CLIENT, VENDOR, PROSPECT, COORDINATION, SYSTEM
EVALUATION_AGENT_SCOPES = CLIENT, VENDOR, PROSPECT, COORDINATION, SYSTEM
```

One member each, in one lane, in the order `KNOWLEDGE_AGENT_SCOPES` already established in JF-4.
Adding them separately would have left a window in which an agent could be requested but not prompted,
or prompted but not evaluated.

`PROSPECT` and not `AAROHI`: these vocabularies name an authority class, not an agent, exactly as
`CLIENT` names the class Riya serves. `PROSPECT` is also the word the runtime party type and the
governed-knowledge scope already use, and Aarohi's own AVG-1 insists a prospect is **not** a vendor.
`CLIENT`, `VENDOR` and `COORDINATION` were not reused. No `HUMAN` scope was added: a human turn never
reaches a model.

### 4. The RAG scope came from JF-4 and is not redesigned

`RIYA→CLIENT`, `ANISHA→VENDOR`, `AAROHI→PROSPECT` in `AGENT_KNOWLEDGE_BINDINGS`, and the shared
retrieval-only policy, are untouched. JF-5A only proves they still agree with the other three columns.

### 5. Scope parity is exact, and proved where every column is visible

`apps/api` already depends on the gateway, the registry, the evaluation framework, the runtime and
governed-knowledge, so the parity lock lives there and introduces no package cycle. It asserts all four
vocabularies equal **including order** — order is contractual here, and two lists holding the same
members in a different sequence is not parity — plus the full five-column row per agent.

`resolveAuthoritativePrompt` keeps its own runtime gateway/registry check. This is the wider version of
the same rule, not a replacement for it.

### 6. Riya's prompt is preserved byte-for-byte

`riya.client-sales` v1, CLIENT, STRUCTURED, three task-class variants over ONE reviewed body, digest
`d0c2da57f53c2541274e090b8dec997c885f65f60c6bd8467e98d0be684b71fb`, 8381 template bytes — identical
before and after. No file under `packages/riya-prompts` was modified.

Riya was deliberately NOT pushed through a new generic abstraction. Her three variants are bound to her
three DEDICATED task classes, which her RWC-P4B/P7 capability resolves; the generic
`RESPONSE_GENERATION` path is a different path, and binding her production prompt to it would claim a
binding her runtime does not make.

### 7. Anisha's prompt audit: ABSENT. Added.

`@qf-jarvis/anisha-prompts`, one definition: `anisha.vendor-journey` v1, VENDOR, STRUCTURED,
`RESPONSE_GENERATION`, digest `ba7c6eccc66b042bf0291899991ca08ae121bee7d102f7d17fa89b1f1dc1cd14`.

Every behavioural rule in it is read off the already-built domain — the fixed `ANISHA`/`VENDOR` role
boundary, the five ADR-0070 dispositions and which of them permit a model draft, the four
vendor-journey context fields — and none of it is invented. No price, package, credit, entitlement,
lead, city, service or promotion appears in the body, and a spec scans for each.

### 8. Aarohi's prompt audit: ABSENT. Added.

`@qf-jarvis/aarohi-prompts`, one definition: `aarohi.acquisition` v1, PROSPECT, STRUCTURED,
`RESPONSE_GENERATION`, digest `0377569eb3dea1caf8371f45f6402897af0af2f30771a66390846c1f323de8d6`.

Every prohibition in it is read off the AVG domain: a prospect is not a Core vendor identity;
registration, payment, ACTIVE, consent, recipient identity, package, price, credits and entitlement are
Core or external authority; `completeCoreActiveHandoff` is the only route into Anisha ownership and no
text can perform it; and every AVG-7 sales-ethics prohibition — commitment, commercial claim, price,
discount, lead-volume/revenue/conversion guarantee, invented urgency, invented scarcity, unsupported
social proof, hidden material limitation — is stated as an instruction.

**Defining a prompt does not make a strategy model-eligible.** That mapping stays in
`evaluateAarohiSalesTurn` and the Aarohi behaviour adapter, and the prompt package depends on the
registry constructor and nothing else — proved by its dependency set, not by prose.

### 9. The prompt registry stays mechanism-only

No agent content was added to `@qf-jarvis/prompt-registry`. It gained one scope member and nothing else.

### 10. Prompt content is agent-owned

Two new leaf packages, each following `riya-prompts` exactly: one canonical copy of the bytes, the
digest computed by the real `createPromptDefinition`, a frozen production set, an assembled registry,
and no provider, network, database, environment, credential or business data. Neither depends on its
own agent's domain package — a prompt that could import business logic is a prompt that could change it.

### 11. Prompt selection is deterministic and actor-bound — and the mechanism already existed

The audit's most useful finding: ADR-0073's `ModelReplyPromptBindings` **is** the code-closed
actor→prompt policy. A deployment supplies an identity per scope; which scope a turn resolves under is
decided by `scopeKeyFor(assignedActor)` from the actor `assignAgent` chose. No caller, message or model
can name another agent's prompt.

So JF-5A added no router and no abstraction. It added one `PROSPECT` entry to the bindings and one
`AAROHI` case to each of the three actor→scope switches (`scopeKeyFor`, `scopeFor`, `agentScopeFor`).

Riya's dedicated `riyaConversationEvolutionPromptBinding` and RWC-P7 grounded bindings keep their
existing precedence, untouched.

### 12. No cross-agent prompt fallback

A CLIENT turn cannot resolve a VENDOR or PROSPECT prompt; a VENDOR turn cannot resolve CLIENT or
PROSPECT; a PROSPECT turn cannot resolve CLIENT or VENDOR. Each is measured by composing a runtime whose
registry holds only the OTHER agents' prompts: the turn REFUSES, with zero gateway calls. No `latest`,
no wildcard, no dynamic discovery.

### 13. Aarohi's model eligibility still comes only from the AVG domain

Unchanged: `PREPARE_NONCOMMERCIAL_REPLY_BRIEF` and `PREPARE_CLARIFYING_REPLY_BRIEF` permit a draft;
`REQUEST_CORE_COMMERCIAL_CONTEXT` and `REQUEST_CORE_PROCESS_CONTEXT` remain `NO_ACTION` with no model;
both review strategies remain escalations with no model.

### 14–15. One gateway call, and zero where zero is correct

Measured as EXACT figures against a counting fake gateway, over artifacts built by the AVG-5/AVG-7
constructors themselves:

| Turn                                              | Gateway calls                 |
| ------------------------------------------------- | ----------------------------- |
| Aarohi, model-eligible reply strategy             | **1**                         |
| Aarohi, clarifying reply strategy                 | **1**                         |
| Aarohi, Core commercial/process context           | **0**                         |
| Aarohi, escalation                                | **0**                         |
| Aarohi, human takeover / AI paused / `HUMAN_ONLY` | **0** (and zero domain reads) |
| Aarohi, malformed artifacts                       | **0**                         |
| Anisha, each model-eligible disposition           | **1**                         |
| Anisha, escalation / refusal / out-of-scope       | **0**                         |
| Riya, ordinary client turn                        | **1** (unchanged)             |

No retry was added anywhere.

### 16. One generic model-evaluation system

`@qf-jarvis/model-evaluation` gained one scope member. No `aarohi-evaluation-framework`, no
`anisha-evaluation-framework`, no second `ApprovalEvidence`, no second release identity, no second
evidence digest.

`RED_TEAM_CASE_KINDS` was deliberately **not** widened. Every kind in it is mandatory for every suite
(`DEFAULT_MANDATORY_RED_TEAM_KINDS` is the whole list), so an Aarohi-labelled kind would retroactively
make every existing suite incomplete and invalidate evidence that was honestly earned. The existing
generic kinds express every property Aarohi's scenarios need; a label is not a safety property.

### 17. No production approval evidence was fabricated

JF-5A creates no `ApprovalEvidence`, sets no `productionApproval`, and mints no `ACTIVE_MODEL_RELEASE`.
There is no observation of a real model anywhere in this lane, so there is nothing evidence could
honestly be about. JF-2B's activation rules are unchanged.

### 18. The production knowledge pack remains empty

`PRODUCTION_KNOWLEDGE_RECORDS` is still 0 and the pack revision is unchanged. Grounding is exercised
with synthetic, test-only records that say so in their own content.

### 19. JF-5B owns the real provider work

Real Groq and Nara calls, credential reads under an explicit execute gate, entitled-model discovery and
locking, GROQ_ONLY / NARA_ONLY / AUTO-with-failover certification, and the real multilingual quality
runs. Nara stays `providerId: nara`, HOSTED, exact injected model, fixed endpoint, aliases refused, and
strict-JSON capability `false` until observed. **No production Nara model is chosen in code here.**

### 20. JF-5B cannot proceed until this PR is merged

## Consequences

Positive: JF-5B needs no new prompt architecture, no new agent scope, no new evaluation framework and
no new runtime architecture. All three agents are now representable end to end — routed, grounded,
prompted, invoked and evaluable — under one gateway, one registry mechanism and one evaluation system.

Negative, and accepted:

- **Three more closed vocabularies grew**, each by one member, and two exact-set locks moved. Every
  change is narrowed-with-a-note rather than relaxed.
- **Two new packages exist.** The repository-wide package lock records both as authorised additions.
  Each is a leaf holding one reviewed prompt body.
- **`jarvis-runtime` gained three `devDependencies`** — the prompt packages, for one spec. They are
  test-only and reach no production source; the emitting build excludes `src/tests`.
- **Anisha's and Aarohi's prompts have never been run against a real model.** They are reviewed bytes
  with a pinned digest, and nothing in this lane claims more than that.

## Next

**JF-5B** — live Groq + Nara certification for all three agents, and the first honest production
evidence.
